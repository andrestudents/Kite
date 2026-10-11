// T017 — both entry paths with a MOCKED adapter (FR-016): the pinned
// credential re-enters the SAME account with one ceremony (no re-onboarding,
// no duplicate account); a fresh device starts onboarding; the session proof
// is established exactly once per ceremony.
import { describe, expect, it } from "bun:test";
import {
  buildSessionMessage,
  isSessionUsable,
  loadSessionBlob,
  type SessionBlob,
  type StorageLike,
  saveSessionBlob,
} from "../auth/session.js";
import type {
  AccountSession,
  AuthAdapter,
  CredentialRef,
  IntentSignature,
  RpConfig,
  UserIdentity,
} from "../auth/types.js";
import {
  CREDENTIAL_KEY,
  clearPinnedCredential,
  enterApp,
  establishSession,
  loadPinnedCredential,
  savePinnedCredential,
  signInExisting,
} from "./entry.js";

const RP_ID = "kite.example";
const NOW = 1_800_000_000;
const ADDRESS = "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD" as const;

/** {StorageLike, MemoryStorage-like} — local to keep session.test.ts self-contained. */
class Mem implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Mocked adapter (FR-016 test seam): records which ceremony ran. */
function mockAdapter(opts: { signInFails?: boolean } = {}): AuthAdapter & {
  created: number;
  signedIn: Array<CredentialRef | undefined>;
} {
  const self = {
    created: 0,
    signedIn: [] as Array<CredentialRef | undefined>,
    async createAccount(_rp: RpConfig, _user: UserIdentity) {
      self.created += 1;
      const session = fakeSession();
      return {
        session,
        credential: { credentialId: "cred-new", transports: ["internal"] },
      };
    },
    async signIn(_rpId: string, credential?: CredentialRef) {
      self.signedIn.push(credential);
      if (opts.signInFails) {
        throw new Error("PRF_UNAVAILABLE (simulated)");
      }
      return fakeSession();
    },
  };
  return self;
}

let signCalls = 0;
function fakeSession(): AccountSession {
  return {
    address: ADDRESS,
    async signIntent(message: string): Promise<IntentSignature> {
      signCalls += 1;
      expect(message.startsWith("Sign in to Kite\n")).toBe(true);
      return {
        v: 27,
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
      };
    },
    end(): void {
      /* mock */
    },
  };
}

function blobFor(storage: StorageLike): SessionBlob | null {
  return loadSessionBlob(storage);
}

describe("enterApp — the two entry paths (T017)", () => {
  it("existing passkey (pinned credential) → ONE signIn ceremony → Home, same account, no createAccount", async () => {
    signCalls = 0; // module-global counter — reset per scenario
    const storage = new Mem();
    savePinnedCredential(storage, { credentialId: "cred-1", transports: ["internal"] });
    const adapter = mockAdapter();
    const result = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result.route).toBe("home");
    if (result.route !== "home") throw new Error("unreachable");
    expect(result.wallet).toBe(ADDRESS);
    expect(adapter.created).toBe(0); // no duplicate account, ever
    expect(adapter.signedIn).toEqual([{ credentialId: "cred-1", transports: ["internal"] }]);
    // The ceremony established a fresh, usable session proof.
    const blob = blobFor(storage);
    expect(isSessionUsable(blob, NOW)).toBe(true);
    expect(blob?.wallet).toBe(ADDRESS);
    expect(signCalls).toBe(1);
  });

  it("fresh device (nothing pinned) → onboarding entry, NO ceremony of any kind", async () => {
    signCalls = 0;
    const storage = new Mem();
    const adapter = mockAdapter();
    const result = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result).toEqual({ route: "signup", reason: "fresh" });
    expect(adapter.created).toBe(0);
    expect(adapter.signedIn).toHaveLength(0);
    expect(signCalls).toBe(0);
    expect(blobFor(storage)).toBeNull();
  });

  it("usable session blob → Home with NO ceremony at all (FR-008 refresh path)", async () => {
    signCalls = 0;
    const storage = new Mem();
    saveSessionBlob(storage, {
      wallet: ADDRESS,
      until: NOW + 600,
      sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
    });
    const adapter = mockAdapter();
    const result = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result.route).toBe("home");
    expect(adapter.created).toBe(0);
    expect(adapter.signedIn).toHaveLength(0);
    expect(signCalls).toBe(0);
  });

  it("pinned but sign-in fails (wiped passkey) → honest fallback to onboarding", async () => {
    signCalls = 0;
    const storage = new Mem();
    savePinnedCredential(storage, { credentialId: "cred-gone" });
    const adapter = mockAdapter({ signInFails: true });
    const result = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result).toEqual({ route: "signup", reason: "signin-failed" });
    expect(blobFor(storage)).toBeNull();
  });

  it("T021: expired blob + refresh → NO silent ceremony wait: fast path re-runs ONE ceremony on the SAME pin", async () => {
    signCalls = 0;
    const storage = new Mem();
    savePinnedCredential(storage, { credentialId: "cred-keep" });
    // A blob that HAS expired — the client-side pre-check routes around it.
    saveSessionBlob(storage, {
      wallet: ADDRESS,
      until: NOW - 10,
      sig: { v: 27, r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}` },
    });
    const adapter = mockAdapter();
    const result = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result.route).toBe("home");
    expect(adapter.signedIn).toEqual([{ credentialId: "cred-keep", transports: undefined }]);
    expect(isSessionUsable(blobFor(storage), NOW)).toBe(true); // fresh proof replaced it
    expect(signCalls).toBe(1);
  });

  it("T021: sign-out (blob cleared, pin kept) → sign-in round-trips with ONE ceremony, SAME account", async () => {
    signCalls = 0;
    const storage = new Mem();
    savePinnedCredential(storage, { credentialId: "cred-same" });
    const adapter = mockAdapter();
    // First visit: fast path in, then the app "signs out" — the App wipes the
    // blob and ends the in-memory session but leaves the pin (FR-009).
    await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    const liveSession = blobFor(storage);
    if (!liveSession) throw new Error("expected a session after sign-in");
    const pin = loadPinnedCredential(storage);
    if (!pin) throw new Error("expected a pinned credential before sign-out");
    savePinnedCredential(storage, pin); // pin survives
    storage.removeItem("kite.session.v1"); // the App's signOut: clearSessionBlob
    expect(blobFor(storage)).toBeNull();
    expect(loadPinnedCredential(storage)).toEqual({ credentialId: "cred-same" });
    // Second visit: one ceremony, the same account.
    const again = await enterApp({ storage, adapter, rpId: RP_ID, nowSec: NOW + 60 });
    expect(again.route).toBe("home");
    if (again.route !== "home") throw new Error("unreachable");
    expect(again.wallet).toBe(ADDRESS);
    expect(adapter.created).toBe(0); // never a duplicate account
    expect(signCalls).toBe(2); // exactly one ceremony each visit
  });
});

describe("credential pinning store (T017, data-model §2.2)", () => {
  it("save/load round-trip; strict parse rejects junk; clear removes", () => {
    const storage = new Mem();
    expect(loadPinnedCredential(storage)).toBeNull();
    savePinnedCredential(storage, { credentialId: "cred-9", transports: ["hybrid"] });
    expect(loadPinnedCredential(storage)).toEqual({
      credentialId: "cred-9",
      transports: ["hybrid"],
    });
    storage.setItem(CREDENTIAL_KEY, "{not json");
    expect(loadPinnedCredential(storage)).toBeNull();
    storage.setItem(CREDENTIAL_KEY, JSON.stringify({ credentialId: 42 }));
    expect(loadPinnedCredential(storage)).toBeNull();
    savePinnedCredential(storage, { credentialId: "cred-9" });
    clearPinnedCredential(storage);
    expect(loadPinnedCredential(storage)).toBeNull();
  });
});

describe("establishSession (T021 seam)", () => {
  it("signs the frozen message once and stores a usable blob at the 7d cap", async () => {
    const storage = new Mem();
    const before = signCalls;
    await establishSession(storage, fakeSession(), NOW);
    expect(signCalls).toBe(before + 1);
    const blob = loadSessionBlob(storage);
    expect(blob?.until).toBe(NOW + 7 * 24 * 60 * 60);
    expect(buildSessionMessage(blob?.wallet ?? "", blob?.until ?? 0)).toContain(
      String(blob?.until),
    );
  });
});

describe("signInExisting — the manual Masuk path (demo-prepped / wiped-pin devices)", () => {
  it("ONE ceremony, no account creation, usable proof, the ceremony's address", async () => {
    signCalls = 0;
    const storage = new Mem();
    const adapter = mockAdapter();
    const result = await signInExisting({ storage, adapter, rpId: RP_ID, nowSec: NOW });
    expect(result.route).toBe("home");
    expect(result.wallet).toBe(ADDRESS);
    expect(adapter.created).toBe(0); // never a duplicate account
    expect(adapter.signedIn).toEqual([undefined]); // unpinned — picker / vault ceremony
    expect(isSessionUsable(loadSessionBlob(storage), NOW)).toBe(true);
    expect(signCalls).toBe(1); // exactly one proof signature
  });

  it("a failed ceremony propagates and stores NOTHING", async () => {
    signCalls = 0;
    const storage = new Mem();
    const adapter = mockAdapter({ signInFails: true });
    expect(signInExisting({ storage, adapter, rpId: RP_ID, nowSec: NOW })).rejects.toThrow(
      /PRF_UNAVAILABLE/,
    );
    expect(loadSessionBlob(storage)).toBeNull();
    expect(signCalls).toBe(0);
  });
});

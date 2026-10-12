// T023 — headless coverage of the demo adapter. The REAL unwrap (passkey PRF
// → vault decrypt → persona session) needs a device passkey, so its end-to-end
// proof is the on-device gate (tasks T005/T025). What CAN be proven here: the
// untrusted-JSON boundary rejects junk before any crypto, unknown personas are
// refused, a wrong wrapped secret can never produce a session for a persona
// address, and fresh-device delegation keeps account creation on the pure
// Mera path.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { makeMemoryKv } from "../lib/idb-kv.js";
import { manifestIsSane, PERSONAS } from "../lib/persona.js";
import {
  DEMO_MODE_NOTICE,
  DEMO_VAULT_KEY,
  type DemoVaultRecord,
  makeAdapterForDevice,
  makeDemoAdapter,
  sessionForWrappedSecret,
} from "./demo-adapter.js";
import type {
  AccountSession,
  AuthAdapter,
  CredentialRef,
  RpConfig,
  UserIdentity,
} from "./types.js";

const RP_ID = "kite.example";
const BUDI = PERSONAS.budi;
const PAKHAJI = PERSONAS.pakhaji;

/** A primary that records whether a fresh account was ever requested, and
 *  which pinned credentials the demo adapter forwards to it. */
function primarySpy(): AuthAdapter & { created: number; pinned: Array<CredentialRef | undefined> } {
  const self = {
    created: 0,
    pinned: [] as Array<CredentialRef | undefined>,
    async createAccount(_rp: RpConfig, _user: UserIdentity) {
      self.created += 1;
      const session: AccountSession = {
        address: BUDI.address,
        async signIntent(): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
          throw new Error("unused");
        },
        async signDigest(): Promise<{ compact: Uint8Array; recovery: number }> {
          throw new Error("unused");
        },
        end(): void {},
      };
      return { session, credential: { credentialId: "cred-primary" } };
    },
    async signIn(_rpId: string, credential?: CredentialRef): Promise<AccountSession> {
      // The unpinned ceremony belongs to the vault alone — if the demo
      // adapter forwards it here, that is the bug this spy exists to catch.
      if (credential === undefined) {
        throw new Error("primary must never serve the unpinned demo ceremony");
      }
      self.pinned.push(credential);
      const session: AccountSession = {
        address: BUDI.address,
        async signIntent(): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
          throw new Error("unused");
        },
        async signDigest(): Promise<{ compact: Uint8Array; recovery: number }> {
          throw new Error("unused");
        },
        end(): void {},
      };
      return session;
    },
  };
  return self;
}

function storeRecord(record: DemoVaultRecord | string | null, kv = makeMemoryKv()): void {
  if (record === null) return;
  void kv.set(DEMO_VAULT_KEY, typeof record === "string" ? record : JSON.stringify(record));
}

describe("demo adapter boundary (T023)", () => {
  it("createAccount delegates to the primary — fresh signups are real Mera accounts", async () => {
    const primary = primarySpy();
    const adapter = makeDemoAdapter(primary, makeMemoryKv());
    const result = await adapter.createAccount(
      { id: RP_ID, name: "Kite" },
      { name: "kite-user", displayName: "Kite" },
    );
    expect(primary.created).toBe(1);
    expect(result.credential.credentialId).toBe("cred-primary");
  });

  it("signIn with nothing stored refuses before any crypto", async () => {
    const primary = primarySpy();
    const adapter = makeDemoAdapter(primary, makeMemoryKv());
    expect(adapter.signIn(RP_ID)).rejects.toThrow(/no demo persona/);
    expect(primary.pinned).toHaveLength(0); // the vault path, never the primary
  });

  it("a PINNED credential rides the primary path — a fresh signup on a demo-prepped device stays reachable", async () => {
    const kv = makeMemoryKv();
    storeRecord({ persona: "budi", displayName: BUDI.displayName, vault: { nope: 1 } }, kv);
    const primary = primarySpy();
    const adapter = makeDemoAdapter(primary, kv);
    const pin: CredentialRef = { credentialId: "cred-fresh", transports: ["internal"] };
    const session = await adapter.signIn(RP_ID, pin);
    expect(primary.pinned).toEqual([pin]); // the pin, forwarded verbatim
    expect(session.address).toBe(BUDI.address);
  });

  it("signIn with corrupt JSON refuses at the parse boundary", async () => {
    const kv = makeMemoryKv();
    storeRecord("{not json", kv);
    const adapter = makeDemoAdapter(primarySpy(), kv);
    expect(adapter.signIn(RP_ID)).rejects.toThrow(/corrupt/);
  });

  it("signIn with an unknown persona refuses (manifest is the only id source)", async () => {
    const kv = makeMemoryKv();
    // The store is untrusted bytes — a hostile/unknown persona id is modeled
    // with a cast, exactly what a tampered record would look like.
    storeRecord(
      {
        persona: "siti",
        displayName: "Siti",
        vault: { anything: true },
      } as unknown as DemoVaultRecord,
      kv,
    );
    const adapter = makeDemoAdapter(primarySpy(), kv);
    expect(adapter.signIn(RP_ID)).rejects.toThrow(/unknown/);
  });

  it("a stored record whose vault is not a Mera vault fails validation BEFORE decryption", async () => {
    const kv = makeMemoryKv();
    storeRecord({ persona: "budi", displayName: BUDI.displayName, vault: { nope: 1 } }, kv);
    const adapter = makeDemoAdapter(primarySpy(), kv);
    // parseSecretVault throws its own validation error — the point is that
    // nothing past that boundary (WebAuthn, decrypt) is ever reached.
    expect(adapter.signIn(RP_ID)).rejects.toThrow();
  });

  it("a 32-byte secret that is NOT the persona key can never become that session", () => {
    const wrong = randomBytes(32);
    expect(() => sessionForWrappedSecret(wrong, BUDI)).toThrow(/does not match/);
  });

  it("a secret of the wrong length is refused before any session exists", () => {
    expect(() => sessionForWrappedSecret(randomBytes(16), BUDI)).toThrow(/32 bytes/);
  });
});

describe("persona manifest (T023 — published identities)", () => {
  it("matches contracts/script/DEMO-ACCOUNTS.md exactly", () => {
    expect(BUDI.address.toLowerCase()).toBe("0xdbac9a1f342a1b5fb2956e58e6528ca0f8c44aad");
    expect(PAKHAJI.address.toLowerCase()).toBe("0x127bd57ea26e6f5eee15efe8b5b495ae539d82ea");
  });

  it("every persona passes the sanity check", () => {
    expect(manifestIsSane(BUDI)).toBe(true);
    expect(manifestIsSane(PAKHAJI)).toBe(true);
  });
});

describe("device-local store (data-model §2.3)", () => {
  it("KvStore round-trips the wrapped record; absence is null", async () => {
    const kv = makeMemoryKv();
    expect(await kv.get(DEMO_VAULT_KEY)).toBeNull();
    const record: DemoVaultRecord = {
      persona: "pakhaji",
      displayName: PAKHAJI.displayName,
      vault: {
        version: 1,
        credential: { credentialId: "cred-x" },
        prfSalt: "aa",
        nonce: "bb",
        ciphertext: "cc",
      },
    };
    await kv.set(DEMO_VAULT_KEY, JSON.stringify(record));
    const raw = await kv.get(DEMO_VAULT_KEY);
    const parsed = JSON.parse(raw ?? "null") as DemoVaultRecord;
    expect(parsed.persona).toBe("pakhaji");
    expect(parsed.vault).toEqual(record.vault);
    await kv.remove(DEMO_VAULT_KEY);
    expect(await kv.get(DEMO_VAULT_KEY)).toBeNull();
  });

  it("the code-level demo label exists (FR-011, place 3)", () => {
    expect(DEMO_MODE_NOTICE.startsWith("Demo Tool")).toBe(true);
  });

  it("device resolution survives a missing IndexedDB (headless bun) — falls back to Mera", async () => {
    const adapter = await makeAdapterForDevice();
    expect(typeof adapter.signIn).toBe("function");
    expect(typeof adapter.createAccount).toBe("function");
  });
});

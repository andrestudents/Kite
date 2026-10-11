// T006 — frozen-format + header + blob tests. The lockstep test proves the
// client's construction matches the server's recovery algorithm (contract
// §1.1: viem hashMessage → sign; server recoverMessageAddress over the SAME
// message) — both sides delegate to viem, so this round-trip is the pin.
import { describe, expect, it } from "bun:test";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildSessionMessage,
  clearSessionBlob,
  defaultUntil,
  headerFromBlob,
  isSessionUsable,
  loadSessionBlob,
  parseSessionHeader,
  SESSION_TTL_SEC,
  type SessionBlob,
  type StorageLike,
  saveSessionBlob,
  serializeSessionHeader,
} from "./session.js";

const WALLET = "0xA11ce00000000000000000000000000000000001"; // EIP-55-ish shape
const UNTIL = 1_730_000_000;

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
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

/** A real 65-byte {v,r,s} over the frozen message from a throwaway account. */
async function signedBlob(): Promise<{ blob: SessionBlob; key: `0x${string}` }> {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const wallet = account.address;
  const until = defaultUntil(Math.floor(Date.now() / 1000));
  const message = buildSessionMessage(wallet, until);
  const hex = await account.signMessage({ message }); // EIP-191 personal_sign
  const blob: SessionBlob = {
    wallet,
    until,
    sig: {
      v: parseInt(hex.slice(130), 16),
      r: hex.slice(0, 66), // "0x" + 64 hex
      s: `0x${hex.slice(66, 130)}`, // slice alone drops the 0x
    },
  };
  return { blob, key };
}

describe("frozen message format (contract §1)", () => {
  it("produces EXACTLY the three frozen lines", () => {
    expect(buildSessionMessage(WALLET, UNTIL)).toBe(`Sign in to Kite\n${WALLET}\nuntil ${UNTIL}`);
  });

  it("locks the TTL cap at 7 days", () => {
    expect(SESSION_TTL_SEC).toBe(604_800);
    expect(defaultUntil(1_000)).toBe(1_000 + 604_800);
  });
});

describe("header serialization + parse (contract §2)", () => {
  it("round-trips a signed session through serialize → parse", async () => {
    const { blob } = await signedBlob();
    const header = headerFromBlob(blob);
    const parsed = parseSessionHeader(header);
    expect(parsed).not.toBeNull();
    expect(parsed?.wallet).toBe(blob.wallet);
    expect(parsed?.until).toBe(blob.until);
    expect(parsed?.v).toBe(blob.sig.v);
    expect(parsed?.r).toBe(blob.sig.r);
    expect(parsed?.s).toBe(blob.sig.s);
    // And the SERVER can recover the signer from the same parts:
    const recovered = await recoverMessageAddress({
      message: buildSessionMessage(blob.wallet, blob.until),
      signature: `0x${blob.sig.r.slice(2)}${blob.sig.s.slice(2)}${blob.sig.v.toString(16).padStart(2, "0")}`,
    });
    expect(recovered.toLowerCase()).toBe(blob.wallet.toLowerCase());
  });

  it("rejects malformed headers", () => {
    const R = `0x${"aa".repeat(32)}`;
    const S = `0x${"bb".repeat(32)}`;
    const good = serializeSessionHeader(WALLET, UNTIL, { v: 27, r: R, s: S });
    expect(parseSessionHeader(good)).not.toBeNull();
    // Hand-built parts — the parser is the unit under test, not the serializer.
    const join = (...parts: (string | number)[]) => parts.join("|");
    expect(parseSessionHeader(null)).toBeNull();
    expect(parseSessionHeader("")).toBeNull();
    expect(parseSessionHeader("no pipes at all")).toBeNull();
    expect(parseSessionHeader(join(WALLET, UNTIL, "26", R, S))).toBeNull(); // v range
    expect(parseSessionHeader(join(WALLET, UNTIL, "0x1b", R, S))).toBeNull(); // v not decimal
    expect(parseSessionHeader(join(WALLET.slice(2), UNTIL, "27", R, S))).toBeNull(); // short addr
    expect(parseSessionHeader(join(WALLET, UNTIL, "27", R.slice(2), S))).toBeNull(); // r no 0x
    expect(parseSessionHeader(join(WALLET, UNTIL, "27", `0x${"aa".repeat(31)}`, S))).toBeNull(); // short r
    expect(parseSessionHeader(join(WALLET, UNTIL, "27", R, "bbbb"))).toBeNull(); // short s
    expect(parseSessionHeader(join(WALLET, "17.3", "27", R, S))).toBeNull(); // float until
    expect(parseSessionHeader(join("", UNTIL, "27", R, S))).toBeNull(); // empty wallet
    expect(parseSessionHeader(join(WALLET, UNTIL, "27", R, S, "extra"))).toBeNull(); // 6 parts
    expect(parseSessionHeader(` ${good}`)).toBeNull(); // leading space wallet
  });
});

describe("SessionBlob lifecycle (data-model §2.2)", () => {
  it("saves, loads, and clears — and survives a fresh storage read", async () => {
    const { blob } = await signedBlob();
    const storage = new MemoryStorage();
    expect(loadSessionBlob(storage)).toBeNull();
    saveSessionBlob(storage, blob);
    const loaded = loadSessionBlob(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.wallet).toBe(blob.wallet);
    expect(loaded?.until).toBe(blob.until);
    expect(loaded?.sig.v).toBe(blob.sig.v);
    clearSessionBlob(storage);
    expect(loadSessionBlob(storage)).toBeNull();
  });

  it("treats corrupt or wrong-shaped storage as absent, never as a crash", () => {
    const storage = new MemoryStorage();
    storage.setItem("kite.session.v1", "{not json");
    expect(loadSessionBlob(storage)).toBeNull();
    storage.setItem("kite.session.v1", JSON.stringify({ wallet: 42 }));
    expect(loadSessionBlob(storage)).toBeNull();
    storage.setItem(
      "kite.session.v1",
      JSON.stringify({ wallet: WALLET, until: UNTIL, sig: { v: 99, r: "x", s: "y" } }),
    );
    expect(loadSessionBlob(storage)).toBeNull();
  });

  it("usability follows the clock only — the blob never carries the key", async () => {
    const { blob } = await signedBlob();
    expect(isSessionUsable(blob, blob.until - 1)).toBe(true);
    expect(isSessionUsable(blob, blob.until)).toBe(false);
    expect(isSessionUsable(null, 0)).toBe(false);
    expect(JSON.stringify(blob)).not.toMatch(/privateKey|key/i);
  });
});

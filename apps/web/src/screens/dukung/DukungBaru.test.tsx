// T016 — the Dukung seam's proof: the permit binds owner/spender/value over
// the EXACT AUSD domain (recovered against a real signer), the wire carries
// decimal strings, FR-008's check reads the chain live in all three
// verdicts, the read-back poll settles on the contract's Active, the derived
// label never fabricates a name, and the backed store round-trips. Fixture
// numbers are TEST INPUTS (FR-022).

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { type Hex, recoverTypedDataAddress, toBytes, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { StorageLike } from "../../auth/session.js";
import type { AccountSession } from "../../auth/types.js";
import {
  type BackedRecord,
  derivedLabel,
  loadBackedRecords,
  saveBackedRecord,
} from "../../data/backed.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { ChainReader } from "../../data/draft.js";
import {
  buildActivationWire,
  checkDraftable,
  DEFAULTS,
  makeDefaultPermitSigner,
  PERMIT_TYPES,
  type PermitDomain,
  type PermitMessage,
  permitDigest,
  permitDomain,
  pollActive,
  splitSig65,
} from "../../data/dukung.js";
import { id } from "../../locales/id.js";
import { DukungBaru } from "./DukungBaru.js";

const BACKER = privateKeyToAccount(generatePrivateKey());
const SEEKER = privateKeyToAccount(generatePrivateKey()).address;
const PRINCIPAL = 480_000_000n;

// ── the permit over the AUSD domain ────────────────────────────────────────
describe("the ERC-2612 permit (T016)", () => {
  const domain: PermitDomain = permitDomain(DEFAULTS.ausd, DEFAULTS.chainId);
  const message: PermitMessage = {
    owner: BACKER.address,
    spender: DEFAULTS.core,
    value: PRINCIPAL,
    nonce: 3n,
    deadline: 1_900_000_000n,
  };

  it("the domain is exactly (AUSD, 1, 10143, ausd)", () => {
    expect(domain).toEqual({
      name: "AUSD",
      version: "1",
      chainId: DEFAULTS.chainId,
      verifyingContract: DEFAULTS.ausd,
    });
    expect(PERMIT_TYPES.Permit.map((f) => `${f.name}:${f.type}`).join(",")).toBe(
      "owner:address,spender:address,value:uint256,nonce:uint256,deadline:uint256",
    );
  });

  it("a real signature over the digest recovers the backer — value included", async () => {
    const session = sessionFor(generatePrivateKey());
    const signer = makeDefaultPermitSigner(session, DEFAULTS.chainId);
    const sig = await signer.sign(domain, message);
    expect([27, 28]).toContain(sig.v);
    const hex65 =
      `0x${sig.r.slice(2)}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}` as Hex;
    const recovered = await recoverTypedDataAddress({
      domain,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message,
      signature: hex65,
    });
    expect(recovered.toLowerCase()).toBe(session.address.toLowerCase());
  });

  it("splitSig65 carves (v, r, s) out of the 65-byte signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const sig = await account.sign({ hash: toHex(permitDigest(domain, message)) });
    const parts = splitSig65(sig);
    expect(parts.r).toHaveLength(66);
    expect(parts.s).toHaveLength(66);
    expect([27, 28]).toContain(parts.v);
  });

  it("the wire shape carries DECIMAL STRINGS for the uint256 fields", () => {
    const wire = buildActivationWire(9, 1_900_000_000n, {
      v: 27,
      r: `0x${"aa".repeat(32)}`,
      s: `0x${"bb".repeat(32)}`,
    });
    expect(wire).toEqual({
      kind: "activate_with_permit",
      isaId: "9",
      deadline: "1900000000",
      v: 27,
      r: `0x${"aa".repeat(32)}`,
      s: `0x${"bb".repeat(32)}`,
    });
  });
});

// ── FR-008's live check ─────────────────────────────────────────────────────
function makeReader(parts: { status: number; offer?: bigint }): ChainReader & { reads: number } {
  const state: { reads: number } = { reads: 0 };
  const reader: ChainReader & { reads: number } = {
    get reads() {
      return state.reads;
    },
    async isaOf(isaId) {
      state.reads += 1;
      return {
        isaId,
        principal: PRINCIPAL,
        shareBps: 1536,
        capMult: 130,
        termEnd: 1_900_000_000n,
        channelId: 1n,
        seeker: SEEKER,
        backer: `0x${"00".repeat(20)}`,
        remaining: 0n,
        activatedAt: 0n,
        lastEventAt: 0n,
        eventCount: 0n,
        status: parts.status as 0 | 1 | 2 | 3 | 4 | 5,
      };
    },
    async offerOf() {
      state.reads += 1;
      return parts.offer ?? PRINCIPAL;
    },
    async profileOf() {
      throw new Error("not used");
    },
    async balanceAusd() {
      throw new Error("not used");
    },
    async scoreOf() {
      throw new Error("not used");
    },
    async channelOf() {
      throw new Error("not used");
    },
    async ausdNonces() {
      return 3n;
    },
  };
  return reader;
}

describe("checkDraftable (T016, FR-008)", () => {
  it("ok when Drafted and the live offer covers the principal", async () => {
    const result = await checkDraftable(makeReader({ status: 1, offer: PRINCIPAL }), 9, PRINCIPAL);
    expect(result.state).toBe("ok");
    expect(result.offerAusd).toBe(PRINCIPAL);
  });

  it("over-limit carries the live offer for the inline copy", async () => {
    const result = await checkDraftable(
      makeReader({ status: 1, offer: PRINCIPAL - 1n }),
      9,
      PRINCIPAL,
    );
    expect(result.state).toBe("over-limit");
    expect(result.offerAusd).toBe(PRINCIPAL - 1n);
  });

  it("not-draftable when the deal left Drafted — before any offer read", async () => {
    const reader = makeReader({ status: 2 });
    const result = await checkDraftable(reader, 9, PRINCIPAL);
    expect(result.state).toBe("not-draftable");
    expect(reader.reads).toBe(1); // the isaOf read decided it
  });
});

describe("the read-back poll (T016)", () => {
  it("settles on the contract's Active; times out honestly otherwise", async () => {
    let calls = 0;
    const flipping = makeReader({ status: 1 });
    const orig = flipping.isaOf.bind(flipping);
    flipping.isaOf = async (isaId: bigint) => {
      calls += 1;
      const isa = await orig(isaId);
      return calls >= 2 ? { ...isa, status: 2 as const } : isa;
    };
    const t = 0;
    expect(await pollActive(flipping, 9, 60_000, () => t + calls, 0)).toBe(true);

    const stuck = makeReader({ status: 1 });
    let tick = 0;
    expect(await pollActive(stuck, 9, 2, () => (tick += 1), 0)).toBe(false);
  });
});

// ── the backed store + derived label (FR-017) ──────────────────────────────
class MemStorage implements StorageLike {
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

describe("the backed list store (T016/T017)", () => {
  it("round-trips and replaces by isaId; labels stay optional", () => {
    const storage = new MemStorage();
    saveBackedRecord(storage, { seeker: SEEKER, isaId: 9, purpose: "bibit", activatedAt: 1 });
    saveBackedRecord(storage, { seeker: SEEKER, isaId: 9, purpose: "pupuk", activatedAt: 2 });
    saveBackedRecord(storage, { seeker: SEEKER, isaId: 11, nickname: "Pak Budi", activatedAt: 3 });
    const rows: BackedRecord[] = loadBackedRecords(storage);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.isaId === 9)?.purpose).toBe("pupuk");
    expect(rows.find((r) => r.isaId === 9)?.nickname).toBeUndefined();
    expect(rows.find((r) => r.isaId === 11)?.nickname).toBe("Pak Budi");
  });

  it("the derived label is the purpose — or Petani · short id, never a name", () => {
    // A FIXED checksummed fixture: the random-session address made this
    // assertion flaky (the label lowercases; raw slice keeps EIP-55 case).
    const fixed = "0x46B2E9AbCd1234567890AbCdEf1234567890aBcD";
    expect(derivedLabel(fixed, "bibit padi")).toBe("bibit padi");
    expect(derivedLabel(fixed, "  ")).toBe("Petani · 46b2e9");
    expect(derivedLabel(SEEKER, "x".repeat(60))).toHaveLength(40);
  });
});

// ── the fake in-session signer (mirrors tx.test.ts's sessionFor) ───────────
function sessionFor(pk: `0x${string}`): AccountSession {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address,
    async signDigest(digest: Uint8Array) {
      const sig = await account.sign({ hash: toHex(digest) });
      const bytes = toBytes(sig);
      return { compact: bytes.slice(0, 64), recovery: (bytes[64] ?? 27) - 27 };
    },
    end() {},
  } as unknown as AccountSession;
}

describe("the Dukung Baru screen (T016)", () => {
  it("first paint is step 1 — the catalog's who-question, no wire calls", () => {
    const html = renderToString(
      <DukungBaru
        locale={id}
        session={sessionFor(generatePrivateKey())}
        api={{} as unknown as ApiClient}
        storage={new MemStorage()}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("Siapa yang ingin didukung?");
  });
});

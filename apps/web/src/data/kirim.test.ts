// T031 tests — the Kirim seam: the EIP-3009 typed-data (six fields, real
// signature recovery over the AUSD domain), the recipient parser, the
// INLINE sufficiency check that precedes any signature (the FR-016 order —
// an over-balance attempt never reaches the signer), the decimal-string
// wire, and the balance read-back that alone says Lunas. Fixture numbers
// are TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import { type Hex, recoverTypedDataAddress, toBytes, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { TransferJobBody } from "../api/client.js";
import type { StorageLike } from "../auth/session.js";
import type { AccountSession } from "../auth/types.js";
import type { ChainReader, HexAddress } from "../chain/client.js";
import type { ApiClient } from "./bootstrap.js";
import { type PermitDomain, permitDomain } from "./dukung.js";
import type { KirimDeps, TransferSigner } from "./kirim.js";
import {
  buildTransferWire,
  checkSufficient,
  freshNonce,
  makeDefaultTransferSigner,
  parseRecipient,
  pollBalanceDropped,
  resolveRecipient,
  sendKirim,
  TRANSFER_TYPES,
  transferDigest,
} from "./kirim.js";
import { loadSentRecords } from "./records.js";

const FROM = privateKeyToAccount(generatePrivateKey()).address as HexAddress;
const TO = privateKeyToAccount(generatePrivateKey()).address as HexAddress;
const AUSD = privateKeyToAccount(generatePrivateKey()).address as HexAddress;
const DOMAIN: PermitDomain = permitDomain(AUSD, 10143);
const NOW = 1_760_000_000;

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

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("the EIP-3009 typed-data (T031)", () => {
  it("carries exactly the contract's six fields, in the contract's order", () => {
    expect(
      TRANSFER_TYPES.TransferWithAuthorization.map((f) => `${f.name}:${f.type}`).join(","),
    ).toBe(
      "from:address,to:address,value:uint256,validAfter:uint256,validBefore:uint256,nonce:bytes32",
    );
  });

  it("a real signature over the digest recovers the sender — value included", async () => {
    const pk = generatePrivateKey();
    const session = sessionFor(pk);
    const sender = privateKeyToAccount(pk).address as HexAddress;
    const message = {
      from: sender,
      to: TO,
      value: 250_000n,
      validAfter: BigInt(NOW),
      validBefore: BigInt(NOW + 3_600),
      nonce: freshNonce(),
    };
    const signer = makeDefaultTransferSigner(session, 10143);
    const sig = await signer.sign(DOMAIN, message);
    expect([27, 28]).toContain(sig.v);
    const hex65 =
      `0x${sig.r.slice(2)}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}` as Hex;
    const recovered = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: TRANSFER_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
      signature: hex65,
    });
    expect(recovered.toLowerCase()).toBe(sender.toLowerCase());
  });

  it("the digest moves when the value moves — no cross-send replay", () => {
    const base = {
      from: FROM,
      to: TO,
      validAfter: 1n,
      validBefore: 2n,
      nonce: `0x${"11".repeat(32)}` as `0x${string}`,
    };
    expect(toHex(transferDigest(DOMAIN, { ...base, value: 1n }))).not.toBe(
      toHex(transferDigest(DOMAIN, { ...base, value: 2n })),
    );
  });
});

describe("freshNonce (T031)", () => {
  it("is 32 bytes of hex and never repeats", () => {
    let seed = 0;
    const rng = {
      getRandomValues(b: Uint8Array) {
        seed += 1;
        b.fill(seed);
        return b;
      },
    };
    const a = freshNonce(rng);
    const b = freshNonce(rng);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseRecipient / resolveRecipient (T031)", () => {
  it("accepts a bare address and a receive-code profile URL; rejects noise", () => {
    expect(parseRecipient(TO)).toEqual({ kind: "address", address: TO });
    expect(parseRecipient(`https://app.kite.example/p/identity123?src=qr`)).toEqual({
      kind: "profile",
      id: "identity123",
    });
    expect(parseRecipient("not an address")).toBe(null);
    expect(parseRecipient("0x123")).toBe(null);
  });

  it("a profile code resolves through the keyless public surface", async () => {
    const api = {
      profile: async () => ({ wallet: TO }),
    } as unknown as ApiClient;
    expect(await resolveRecipient(api, { kind: "profile", id: "x" })).toBe(TO);
    expect(await resolveRecipient(api, { kind: "address", address: FROM })).toBe(FROM);
    const broken = {
      profile: async () => {
        throw new Error("down");
      },
    } as unknown as ApiClient;
    expect(await resolveRecipient(broken, { kind: "profile", id: "x" })).toBe(null);
  });
});

describe("checkSufficient — the INLINE gate (T031)", () => {
  const reader = (balance: bigint) =>
    ({ balanceAusd: async () => balance }) as unknown as ChainReader;
  it("enough balance is ok", async () => {
    expect(await checkSufficient(reader(1_000_000n), FROM, 250_000n)).toEqual({
      state: "ok",
      balanceAusd: 1_000_000n,
    });
  });
  it("short balance is insufficient — with the live number for the copy", async () => {
    expect(await checkSufficient(reader(100n), FROM, 250_000n)).toEqual({
      state: "insufficient",
      balanceAusd: 100n,
    });
  });
});

describe("buildTransferWire (T031)", () => {
  it("carries DECIMAL STRINGS and the one-hour window", () => {
    const wire = buildTransferWire(
      FROM,
      TO,
      250_000n,
      NOW,
      {
        v: 27,
        r: `0x${"aa".repeat(32)}`,
        s: `0x${"bb".repeat(32)}`,
      },
      `0x${"cc".repeat(32)}`,
    );
    expect(wire.kind).toBe("transfer_with_authorization");
    expect(wire.valueAusd).toBe("250000");
    expect(wire.validAfter).toBe("1760000000");
    expect(wire.validBefore).toBe("1760003600");
    expect(wire.nonce).toHaveLength(66);
    expect(wire.v).toBe(27);
  });
});

describe("pollBalanceDropped — the read-back (T031)", () => {
  it("true the moment the delta shows", async () => {
    const balances = [1_000_000n, 750_000n];
    const reader = {
      balanceAusd: async () => balances.shift() ?? 750_000n,
    } as unknown as ChainReader;
    expect(await pollBalanceDropped(reader, FROM, 1_000_000n, 250_000n, 5_000, () => 0, 0)).toBe(
      true,
    );
  });

  it("a simultaneous income landing cannot fake a pass — delta or nothing", async () => {
    const balances = [1_000_000n, 900_000n]; // panen landed (+150k) but net is still up 100k
    const reader = {
      balanceAusd: async () => balances.shift() ?? 900_000n,
    } as unknown as ChainReader;
    let nowMs = 0;
    expect(
      await pollBalanceDropped(reader, FROM, 1_000_000n, 250_000n, 10, () => (nowMs += 100), 0),
    ).toBe(false);
  });

  it("times out honestly when nothing moves", async () => {
    const reader = { balanceAusd: async () => 1_000_000n } as unknown as ChainReader;
    let nowMs = 0;
    expect(
      await pollBalanceDropped(reader, FROM, 1_000_000n, 250_000n, 10, () => (nowMs += 100), 0),
    ).toBe(false);
  });
});

describe("sendKirim — the FR-016 order (T031)", () => {
  const domain = DOMAIN;

  function deps(over: { reader?: ChainReader; api?: ApiClient; storage?: StorageLike }) {
    const posted: TransferJobBody[] = [];
    const signed: number[] = [];
    const signer: TransferSigner = {
      sign: async () => {
        signed.push(signed.length + 1);
        return { v: 27, r: `0x${"aa".repeat(32)}`, s: `0x${"bb".repeat(32)}` };
      },
    };
    const base: KirimDeps = {
      api:
        over.api ??
        ({
          postJob: async (body: TransferJobBody) => {
            posted.push(body);
            return { jobId: "1", clientRef: "c" };
          },
        } as unknown as ApiClient),
      reader:
        over.reader ??
        ({
          balanceAusd: async () => 1_000_000n,
        } as unknown as ChainReader),
      signer,
      storage: over.storage ?? memStorage(),
      from: FROM,
      nowSec: () => NOW,
      nonce: () => `0x${"cc".repeat(32)}`,
      timeoutMs: 1,
    };
    return { posted, signed, deps: base };
  }

  it("an over-balance attempt is rejected INLINE — the signer is never touched", async () => {
    const reader = { balanceAusd: async () => 100n } as unknown as ChainReader;
    const d = deps({ reader });
    const outcome = await sendKirim(d.deps, domain, TO, "0.25");
    expect(outcome).toEqual({ ok: false, reason: "insufficient", balanceAusd: 100n });
    expect(d.signed).toHaveLength(0);
    expect(d.posted).toHaveLength(0);
  });

  it("an unparseable recipient fails before anything signs or posts", async () => {
    const d = deps({});
    expect(await sendKirim(d.deps, domain, "garbage", "0.25")).toEqual({
      ok: false,
      reason: "invalid-recipient",
    });
    expect(d.signed).toHaveLength(0);
  });

  it("the happy path: sign once, post decimal strings, record on confirmation", async () => {
    const storage = memStorage();
    const balances = [1_000_000n, 750_000n];
    const reader = {
      balanceAusd: async () => balances.shift() ?? 750_000n,
    } as unknown as ChainReader;
    const d = deps({ reader, storage });
    const outcome = await sendKirim(d.deps, domain, TO, "0.25");
    expect(outcome.ok).toBe(true);
    expect(d.signed).toHaveLength(1);
    expect(d.posted).toHaveLength(1);
    const wire = d.posted[0];
    expect(wire !== undefined ? wire.valueAusd : "").toBe("250000");
    expect(wire !== undefined ? wire.from : "").toBe(FROM);
    expect(loadSentRecords(storage)).toHaveLength(1);
  });

  it("no read-back delta means NO Lunas and NO record — submitted ≠ done", async () => {
    const storage = memStorage();
    const reader = { balanceAusd: async () => 1_000_000n } as unknown as ChainReader;
    const d = deps({ reader, storage });
    const outcome = await sendKirim(d.deps, domain, TO, "0.25");
    expect(outcome).toEqual({ ok: false, reason: "unconfirmed" });
    expect(loadSentRecords(storage)).toHaveLength(0);
  });
});

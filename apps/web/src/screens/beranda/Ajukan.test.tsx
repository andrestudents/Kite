// T014 — the Ajukan flow's proof: guidance is the CONTRACT'S rule (never
// invented), money parsing stays integer, the deep link + WhatsApp share
// carry the purpose, drip exhaustion is detected BEFORE any signature and
// again at the OOG receipt, and the drafted id comes from the receipt's own
// ISADrafted log. Fixture numbers are TEST INPUTS (FR-022).

import { describe, expect, it } from "bun:test";
import { abis, KITE_DEPLOYMENT } from "@kite/contracts";
import { renderToString } from "react-dom/server";
import {
  type AbiEvent,
  type AbiParameter,
  decodeFunctionData,
  encodeAbiParameters,
  getAbiItem,
  type Hex,
  toEventSelector,
  toEventSignature,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, pad } from "viem/utils";
import type { StorageLike } from "../../auth/session.js";
import type { AccountSession } from "../../auth/types.js";
import type { ApiClient } from "../../data/bootstrap.js";
import {
  amountOk,
  broadcastDraft,
  type ChainReader,
  capOf,
  type DraftBroadcaster,
  type DraftReceipt,
  draftCalldata,
  guidanceFrom,
  isaIdFromLogs,
  isDripExhausted,
  liveGuidance,
  parseAusdInput,
  parseBackerInput,
  purposeDeepLink,
  waShareLink,
} from "../../data/draft.js";
import { loadPurposeRecords, savePurposeRecord } from "../../data/records.js";
import { id } from "../../locales/id.js";
import { Ajukan, pctLabel } from "./Ajukan.js";

const SEEKER = privateKeyToAccount(generatePrivateKey()).address;
const BACKER = privateKeyToAccount(generatePrivateKey()).address;
const OFFER = 600_000_000n;
const AMOUNT = 480_000_000n;

// ── the guidance rule (PLAN §6.3, live inputs) ─────────────────────────────
describe("guidance (T014)", () => {
  it("share is 2000 − 8×score bps; cap mult is the 1.3× rule", () => {
    expect(guidanceFrom(0, OFFER)).toEqual({
      score: 0,
      offerAusd: OFFER,
      shareBps: 2000,
      capMult: 130,
    });
    expect(guidanceFrom(58, OFFER).shareBps).toBe(1536);
    expect(guidanceFrom(100, OFFER).shareBps).toBe(1200);
  });

  it("liveGuidance reads score + offer through the reader", async () => {
    const g = await liveGuidance(makeReader(), SEEKER);
    expect(g.score).toBe(58);
    expect(g.offerAusd).toBe(OFFER);
    expect(g.shareBps).toBe(1536);
  });

  it("cap = 1.3×amount in integer base units; the offer bounds the amount", () => {
    expect(capOf(AMOUNT)).toBe(624_000_000n);
    expect(capOf(1n)).toBe(1n); // floor, never rounds up
    expect(amountOk(AMOUNT, OFFER)).toBe(true);
    expect(amountOk(OFFER, OFFER)).toBe(true);
    expect(amountOk(OFFER + 1n, OFFER)).toBe(false);
    expect(amountOk(0n, OFFER)).toBe(false);
  });

  it("the percent label renders integer math with locale separators", () => {
    expect(pctLabel(1536, "id")).toBe("15,36%");
    expect(pctLabel(1536, "ms")).toBe("15,36%");
    expect(pctLabel(1536, "en")).toBe("15.36%");
    expect(pctLabel(2000, "id")).toBe("20,00%");
  });
});

// ── input parsing ───────────────────────────────────────────────────────────
describe("parsing (T014)", () => {
  it("amounts: comma or dot, ≤2 decimals, integer base units out", () => {
    expect(parseAusdInput("480")).toBe(480_000_000n);
    expect(parseAusdInput("12.5")).toBe(12_500_000n);
    expect(parseAusdInput("12,5")).toBe(12_500_000n);
    expect(parseAusdInput(" 1230 ")).toBe(1_230_000_000n);
    expect(parseAusdInput("1.230")).toBeNull(); // three decimals — refused
    expect(parseAusdInput("")).toBeNull();
    expect(parseAusdInput("-1")).toBeNull();
    expect(parseAusdInput("0.123")).toBeNull();
    expect(parseAusdInput("abc")).toBeNull();
  });

  it("backer input: a raw address or a profile link with one inside", () => {
    const checksummed = getAddress(BACKER);
    expect(parseBackerInput(BACKER)).toBe(checksummed);
    const lower = BACKER.toLowerCase();
    expect(parseBackerInput(lower)).toBe(checksummed); // checksummed back
    expect(parseBackerInput(`https://kite.example/p/${BACKER}?ajukan=bibit%20padi`)).toBe(
      checksummed,
    );
    expect(parseBackerInput("not an address")).toBeNull();
    expect(parseBackerInput("0x1234")).toBeNull();
  });
});

// ── the share action (FR-006) ───────────────────────────────────────────────
describe("share links (T014)", () => {
  it("the deep link points at the profile and carries the encoded purpose", () => {
    expect(purposeDeepLink("https://app.example/", BACKER, "bibit padi")).toBe(
      `https://app.example/p/${BACKER}?ajukan=bibit%20padi`,
    );
    expect(purposeDeepLink("https://app.example", BACKER, "  ")).toBe(
      `https://app.example/p/${BACKER}`,
    );
  });

  it("the WhatsApp link wraps the whole invitation", () => {
    const link = purposeDeepLink("https://app.example", BACKER, "bibit padi");
    const wa = waShareLink(link, "bibit padi");
    expect(wa.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(wa.slice("https://wa.me/?text=".length));
    expect(text).toBe(`bibit padi ${link}`);
  });
});

// ── the broadcast classification (research D3 §4) ──────────────────────────
const ISA_DRAFTED = getAbiItem({ abi: abis.kitecore, name: "ISADrafted" }) as AbiEvent;

/** ISADrafted(uint256 indexed isaId, address indexed seeker, address indexed
 *  backer, Terms terms) — topics carry the indexed trio, data the tuple. */
function draftedLog(isaId: bigint): { data: Hex; topics: Hex[] } {
  const termsParam = (ISA_DRAFTED as unknown as { inputs: AbiParameter[] })
    .inputs[3] as AbiParameter;
  return {
    topics: [
      toEventSelector(toEventSignature(ISA_DRAFTED)),
      toHex(isaId, { size: 32 }),
      pad(SEEKER, { size: 32, dir: "left" }),
      pad(BACKER, { size: 32, dir: "left" }),
    ],
    data: encodeAbiParameters([termsParam], [[AMOUNT, 1536, 130, 1_900_000_000n, 1n]]),
  };
}

const LIMIT = 345_000n;

function receipt(over: Partial<DraftReceipt>): DraftReceipt {
  return { status: "success", gasUsed: 210_000n, logs: [], ...over };
}

function fakeBroadcaster(parts: {
  balance?: bigint;
  sendHash?: Hex;
  throwOnSend?: Error;
  receipt?: DraftReceipt;
}): DraftBroadcaster & { sends: number; lastLimit?: bigint; lastTo?: string } {
  const state: { sends: number; lastLimit?: bigint; lastTo?: string } = { sends: 0 };
  const b: DraftBroadcaster & { sends: number; lastLimit?: bigint; lastTo?: string } = {
    get sends() {
      return state.sends;
    },
    get lastLimit() {
      return state.lastLimit;
    },
    get lastTo() {
      return state.lastTo;
    },
    async feeBalance() {
      return parts.balance ?? 10n ** 18n;
    },
    async nextNonce() {
      return 4;
    },
    async feePerUnit() {
      return 50n;
    },
    async send(tx) {
      state.sends += 1;
      state.lastLimit = tx.limit;
      state.lastTo = tx.to;
      if (parts.throwOnSend) throw parts.throwOnSend;
      return parts.sendHash ?? `0x${"ab".repeat(32)}`;
    },
    async receiptOf() {
      if (!parts.receipt) throw new Error("no receipt");
      return parts.receipt;
    },
  };
  return b;
}

describe("the draft broadcast (T014)", () => {
  it("calldata round-trips as createISADraft with the exact terms", () => {
    const data = draftCalldata({
      backer: BACKER,
      amountAusd: AMOUNT,
      guidance: guidanceFrom(58, OFFER),
      termEnd: 1_900_000_000n,
      channelId: 1n,
    });
    const decoded = decodeFunctionData({ abi: abis.kitecore, data });
    expect(decoded.functionName).toBe("createISADraft");
    const [terms, backer] = decoded.args as unknown as [
      { principal: bigint; shareBps: number; capMult: number },
      string,
    ];
    expect(terms.principal).toBe(AMOUNT);
    expect(terms.shareBps).toBe(1536);
    expect(terms.capMult).toBe(130);
    expect(backer).toBe(BACKER);
  });

  it("the OOG signature is drip exhaustion; an in-contract revert is not", () => {
    expect(isDripExhausted(receipt({ status: "reverted", gasUsed: LIMIT }), LIMIT)).toBe(true);
    expect(isDripExhausted(receipt({ status: "reverted", gasUsed: LIMIT + 1n }), LIMIT)).toBe(true);
    expect(isDripExhausted(receipt({ status: "reverted", gasUsed: 120_000n }), LIMIT)).toBe(false);
    expect(isDripExhausted(receipt({ status: "success", gasUsed: LIMIT }), LIMIT)).toBe(false);
  });

  it("the drafted id comes from the receipt's own log — or nowhere", () => {
    expect(isaIdFromLogs([draftedLog(9n)])).toBe(9);
    expect(isaIdFromLogs([{ data: "0xdeadbeef", topics: [`0x${"ff".repeat(32)}`] }])).toBeNull();
    expect(isaIdFromLogs([])).toBeNull();
  });

  const REQ = {
    backer: BACKER,
    amountAusd: AMOUNT,
    guidance: guidanceFrom(58, OFFER),
    termEnd: 1_900_000_000n,
    channelId: 1n,
  };

  it("an unfunded fee pot refuses BEFORE any signature — nothing is sent", async () => {
    const b = fakeBroadcaster({ balance: LIMIT * 50n - 1n });
    const outcome = await broadcastDraft(b, REQ);
    expect(outcome).toEqual({ kind: "drip-exhausted" });
    expect(b.sends).toBe(0);
  });

  it("a mined draft rides the PUBLISHED limit to the core and yields the log's id", async () => {
    const b = fakeBroadcaster({ receipt: receipt({ logs: [draftedLog(9n)] }) });
    const outcome = await broadcastDraft(b, REQ);
    expect(outcome).toEqual({ kind: "mined", isaId: 9, txHash: `0x${"ab".repeat(32)}` });
    expect(b.sends).toBe(1);
    expect(b.lastLimit).toBe(LIMIT);
    expect(b.lastTo?.toLowerCase()).toBe(KITE_DEPLOYMENT.kiteCore.toLowerCase());
  });

  it("OOG at the receipt maps to drip exhaustion (the belt to the pre-check)", async () => {
    const b = fakeBroadcaster({ receipt: receipt({ status: "reverted", gasUsed: LIMIT }) });
    expect(await broadcastDraft(b, REQ)).toEqual({ kind: "drip-exhausted" });
  });

  it("an in-contract revert is the generic retryable failure", async () => {
    const b = fakeBroadcaster({ receipt: receipt({ status: "reverted", gasUsed: 120_000n }) });
    const outcome = await broadcastDraft(b, REQ);
    expect(outcome.kind).toBe("failed");
  });

  it("a refused broadcast never reaches the receipt", async () => {
    const b = fakeBroadcaster({ throwOnSend: new Error("refused") });
    const outcome = await broadcastDraft(b, REQ);
    expect(outcome.kind).toBe("failed");
  });
});

// ── the purpose records (data-model §3, device-local) ──────────────────────
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

describe("purpose records (T014)", () => {
  it("round-trips and replaces by isaId; money stays a decimal string", () => {
    const storage = new MemStorage();
    savePurposeRecord(storage, {
      isaId: 9,
      principalAusd: "480000000",
      purpose: "bibit padi",
      createdAt: 1,
    });
    savePurposeRecord(storage, {
      isaId: 9,
      principalAusd: "500000000",
      purpose: "pupuk",
      createdAt: 2,
    });
    savePurposeRecord(storage, {
      isaId: 11,
      principalAusd: "300000000",
      purpose: "benih",
      createdAt: 3,
    });
    const rows = loadPurposeRecords(storage);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.isaId === 9)?.principalAusd).toBe("500000000");
    expect(rows.find((r) => r.isaId === 11)?.purpose).toBe("benih");
  });
});

// ── the screen itself (smoke: the catalog copy renders, not literals) ──────
function makeReader(): ChainReader {
  return {
    async offerOf() {
      return OFFER;
    },
    async isaOf() {
      throw new Error("not used here");
    },
    async profileOf() {
      return { totalIsas: 4, completed: 2, qualEvents: 11, distinctBackers: 2 };
    },
    async balanceAusd() {
      return 2_000_000_000n;
    },
    async scoreOf() {
      return 58;
    },
    async channelOf() {
      return { name: "mill", pubkey: `0x${"11".repeat(32)}`, active: true };
    },
    async ausdNonces() {
      return 0n;
    },
  };
}

const ME = {
  wallet: SEEKER,
  balanceAusd: 1_200_000_000,
  identityBound: true,
  profile: {
    score: 58,
    maxSupportAusd: 624_000_000,
    totalIsas: 4,
    completed: 2,
    qualEvents: 11,
    distinctBackers: 2,
  },
  activeIsa: null,
  recentPurchases: [],
};

describe("the Ajukan screen (T014)", () => {
  it("first paint is the honest loading state straight from the catalog", () => {
    const html = renderToString(
      <Ajukan
        locale={id}
        session={{ address: SEEKER } as unknown as AccountSession}
        api={{ me: async () => ME } as unknown as ApiClient}
        storage={new MemStorage()}
        reader={makeReader()}
        broadcaster={fakeBroadcaster({})}
        origin="https://app.example"
        onBack={() => {}}
      />,
    );
    expect(html).toContain("Sebentar ya…");
  });
});

// T014 — the Ajukan seam (FR-006, FR-011's direct lane, research D3). The
// guidance numbers come from the CONTRACT'S OWN rule — share 2000−8×score
// bps, cap 1.3×P (PLAN §6.3) — read LIVE, never invented client-side. The
// amount is checked against the live offer; the draft rides the seeker's own
// signature (auth/tx) at the PUBLISHED fixed limit, drip-funded. Screens
// never see viem: this module and chain/client are the only wire imports
// under data/. Fee check runs BEFORE any signature; the OOG-at-limit
// signature (all units burned, no revert data) maps to the FIRST-CLASS
// drip-exhausted state; everything else is the generic retryable failure.
import { abis, KITE_DEPLOYMENT } from "@kite/contracts";
import type { Hex } from "viem";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  type PublicClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { getAddress } from "viem/utils";
import { DRAFT_GAS_LIMIT, makeTxAccount } from "../auth/tx.js";
import type { AccountSession } from "../auth/types.js";
import { type ChainReader, chainReader, chainRpcUrl, type HexAddress } from "../chain/client.js";

// ── The guidance rule (PLAN §6.3 — the contract's own economics) ───────────

export interface Guidance {
  score: number;
  offerAusd: bigint;
  shareBps: number; // 2000 − 8×score
  capMult: number; // 130 — the 1.3× rule
}

export function guidanceFrom(score: number, offerAusd: bigint): Guidance {
  return { score, offerAusd, shareBps: 2000 - 8 * score, capMult: 130 };
}

export async function liveGuidance(reader: ChainReader, seeker: HexAddress): Promise<Guidance> {
  const [score, offer] = await Promise.all([reader.scoreOf(seeker), reader.offerOf(seeker)]);
  return guidanceFrom(score, offer);
}

/** cap = 1.3 × principal, integer math over 6-dp base units. */
export function capOf(amountAusd: bigint, capMult = 130): bigint {
  return (amountAusd * BigInt(capMult)) / 100n;
}

export function amountOk(amountAusd: bigint, offerAusd: bigint): boolean {
  return amountAusd > 0n && amountAusd <= offerAusd;
}

/** One season (the app's fixed term — within the contract's 730-day bound). */
export const TERM_DAYS = 365;

export function defaultTermEnd(nowSec: number): bigint {
  return BigInt(nowSec + TERM_DAYS * 86_400);
}

/** The demo deployment registers the mill's channel as id 1 — read LIVE and
 *  require it active before any signature (the contract would revert). */
export async function defaultChannel(reader: ChainReader) {
  const channel = await reader.channelOf(1);
  if (!channel.active) {
    throw new Error("the mill's channel is not active right now");
  }
  return channel;
}

// ── Input parsing (pure — unit-tested) ─────────────────────────────────────

/** Backer input: a raw address OR a profile link containing one (the receive
 *  code). Lowercase input is re-checksummed to EIP-55; mixed-case input must
 *  carry a VALID checksum or it is refused (viem's second parameter is a
 *  chainId for EIP-1191 — never passed here). */
export function parseBackerInput(raw: string): HexAddress | null {
  const m = raw.match(/0x[0-9a-fA-F]{40}/);
  if (!m) return null;
  try {
    return getAddress(m[0]) as HexAddress;
  } catch {
    return null;
  }
}

/** AUSD amount input: up to 2 decimals, comma or dot → 6-dp base units. */
export function parseAusdInput(raw: string): bigint | null {
  const t = raw.trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(2, "0")) * 10_000n;
}

// ── The share action (FR-006: WhatsApp-shareable deep link) ────────────────

/** Deep link to the seeker's public profile — the open request + Dukung CTA
 *  render there (FR-019). The purpose rides the URL (never onchain). */
export function purposeDeepLink(origin: string, profileId: string, purpose: string): string {
  const base = `${origin.replace(/\/+$/, "")}/p/${profileId}`;
  const trimmed = purpose.trim();
  return trimmed === "" ? base : `${base}?ajukan=${encodeURIComponent(trimmed)}`;
}

export function waShareLink(link: string, purpose: string): string {
  const text = `${purpose} ${link}`.trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ── The broadcast (pure parts + one injected-transport integration) ────────

export interface DraftRequest {
  backer: HexAddress;
  amountAusd: bigint;
  guidance: Guidance;
  termEnd: bigint;
  channelId: bigint;
}

export function draftCalldata(req: DraftRequest): Hex {
  return encodeFunctionData({
    abi: abis.kitecore,
    functionName: "createISADraft",
    args: [
      {
        principal: req.amountAusd,
        shareBps: req.guidance.shareBps,
        capMult: req.guidance.capMult,
        termEnd: req.termEnd,
        channelId: req.channelId,
      },
      req.backer,
    ],
  });
}

export interface DraftReceipt {
  status: "success" | "reverted";
  gasUsed: bigint;
  logs: Array<{ data: Hex; topics: Hex[] }>;
}

/** OOG at the fixed limit burns every unit and emits no revert data
 *  (research D3 §4, packages/contracts gasLimits notes). An in-contract
 *  revert refunds its unused tail, so it never reaches the limit. */
export function isDripExhausted(receipt: DraftReceipt, limit: bigint): boolean {
  return receipt.status === "reverted" && receipt.gasUsed >= limit;
}

/** The drafted id from the receipt's own ISADrafted log (constitution IV:
 *  the id comes from the chain, not from the caller's math). */
export function isaIdFromLogs(logs: DraftReceipt["logs"]): number | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: abis.kitecore,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "ISADrafted") {
        const args = decoded.args as { isaId?: unknown };
        return Number(args.isaId);
      }
    } catch {
      // a log from another surface in the same tx — skip it
    }
  }
  return null;
}

export type DraftOutcome =
  | { kind: "mined"; isaId: number; txHash: Hex }
  | { kind: "drip-exhausted" }
  | { kind: "failed"; reason: string };

/** The transport seam — injectable so tests never touch a network. */
export interface DraftBroadcaster {
  feeBalance(): Promise<bigint>;
  nextNonce(): Promise<number>;
  feePerUnit(): Promise<bigint>;
  send(tx: {
    to: HexAddress;
    data: Hex;
    limit: bigint;
    price: bigint;
    nonce: number;
  }): Promise<Hex>;
  receiptOf(txHash: Hex): Promise<DraftReceipt>;
}

const RECEIPT_TIMEOUT_MS = 60_000;

/** The real broadcaster: signs through the in-session account adapter at the
 *  PUBLISHED fixed limit (constitution III — never an estimate). */
export function makeDefaultBroadcaster(
  session: AccountSession,
  client: PublicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(chainRpcUrl()),
  }),
): DraftBroadcaster {
  const account = makeTxAccount(session, KITE_DEPLOYMENT.chainId);
  const issuer = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(chainRpcUrl()),
  });
  return {
    feeBalance() {
      return client.getBalance({ address: session.address });
    },
    nextNonce() {
      return client.getTransactionCount({ address: session.address });
    },
    feePerUnit() {
      return client.getGasPrice();
    },
    async send(tx) {
      return issuer.sendTransaction({
        account,
        chain: monadTestnet,
        to: KITE_DEPLOYMENT.kiteCore as HexAddress,
        data: tx.data,
        gas: tx.limit,
        gasPrice: tx.price,
        nonce: tx.nonce,
      });
    },
    async receiptOf(txHash) {
      const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
      for (;;) {
        try {
          const r = await client.getTransactionReceipt({ hash: txHash });
          return {
            status: r.status === "success" ? "success" : "reverted",
            gasUsed: r.gasUsed,
            logs: r.logs.map((l) => ({ data: l.data, topics: l.topics as Hex[] })),
          };
        } catch {
          if (Date.now() > deadline) throw new Error("no receipt in time");
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
      }
    },
  };
}

/** The FR-011 direct lane, classified. A wasted tap never signs: the fee
 *  check runs FIRST; the drip exhaustion is detected again at the receipt
 *  (OOG signature) as the belt to the pre-check's braces. */
export async function broadcastDraft(
  broadcaster: DraftBroadcaster,
  req: DraftRequest,
): Promise<DraftOutcome> {
  const price = await broadcaster.feePerUnit();
  const need = DRAFT_GAS_LIMIT * price;
  if ((await broadcaster.feeBalance()) < need) {
    return { kind: "drip-exhausted" };
  }
  const data = draftCalldata(req);
  let txHash: Hex;
  try {
    const nonce = await broadcaster.nextNonce();
    txHash = await broadcaster.send({
      to: KITE_DEPLOYMENT.kiteCore as HexAddress,
      data,
      limit: DRAFT_GAS_LIMIT,
      price,
      nonce,
    });
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : "broadcast refused" };
  }
  let receipt: DraftReceipt;
  try {
    receipt = await broadcaster.receiptOf(txHash);
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : "no receipt" };
  }
  if (receipt.status === "reverted") {
    return isDripExhausted(receipt, DRAFT_GAS_LIMIT)
      ? { kind: "drip-exhausted" }
      : { kind: "failed", reason: "the request was refused by the contract" };
  }
  const isaId = isaIdFromLogs(receipt.logs);
  if (isaId === null) {
    return { kind: "failed", reason: "mined but the drafted id was unreadable" };
  }
  return { kind: "mined", isaId, txHash };
}

export type { ChainReader, HexAddress, IsaOnChain } from "../chain/client.js";
/** The module reader — data-only access for screens via bootstrap. */
export { chainReader };

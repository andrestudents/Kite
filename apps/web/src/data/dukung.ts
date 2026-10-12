// T016 — the Dukung seam (FR-007/FR-008, jobs-route.md): the backer's permit
// over the AUSD domain, the live draftability check (NEVER cached), the
// decimal-string wire shape, and the read-back poll. The permit's value is
// EXACTLY the draft's principal — never a typed amount above it (a larger
// permit would let the contract pull more than the deal needs). Screens never
// see viem: this module rides auth/tx's origin-agnostic session adapter.
import { KITE_DEPLOYMENT } from "@kite/contracts";
import { type Hex, hashTypedData, toBytes } from "viem";
import { makeTxAccount } from "../auth/tx.js";
import type { AccountSession } from "../auth/types.js";
import { type ChainReader, type HexAddress, ISA_STATUS } from "../chain/client.js";

// ── ERC-2612 over the AUSD domain (domain ("AUSD","1",10143,ausd)) ─────────

export interface PermitDomain {
  name: "AUSD";
  version: "1";
  chainId: number;
  verifyingContract: HexAddress;
}

export function permitDomain(ausd: HexAddress, chainId: number): PermitDomain {
  return { name: "AUSD", version: "1", chainId, verifyingContract: ausd };
}

export interface PermitMessage {
  owner: HexAddress;
  spender: HexAddress;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** The EIP-712 digest the session's prompt-free primitive signs in tests. */
export function permitDigest(domain: PermitDomain, message: PermitMessage): Uint8Array {
  return toBytes(hashTypedData({ domain, types: PERMIT_TYPES, primaryType: "Permit", message }));
}

/** The 65-byte signature → (v, r, s) — v is the plain 27|28 integer the
 *  jobs wire expects. */
export function splitSig65(sig: Hex): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const body = sig.slice(2);
  return {
    r: `0x${body.slice(0, 64)}`,
    s: `0x${body.slice(64, 128)}`,
    v: parseInt(body.slice(128, 130), 16),
  };
}

/** The signer seam — one biometric confirmation signs the permit. */
export interface PermitSigner {
  sign(
    domain: PermitDomain,
    message: PermitMessage,
  ): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }>;
}

export function makeDefaultPermitSigner(session: AccountSession, chainId: number): PermitSigner {
  const account = makeTxAccount(session, chainId);
  return {
    async sign(domain, message) {
      const sig = await account.signTypedData({
        domain,
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message,
      });
      return splitSig65(sig);
    },
  };
}

/** Ten minutes — the permit lives just long enough for the relayer to land. */
export const PERMIT_TTL_SEC = 600;

// ── the wire shape (jobs-route.md §2 — decimal strings, EIP-55 hex) ────────

export interface ActivationWire {
  kind: "activate_with_permit";
  isaId: string;
  deadline: string;
  v: number;
  r: string;
  s: string;
}

export function buildActivationWire(
  isaId: number,
  deadline: bigint,
  sig: { v: number; r: string; s: string },
): ActivationWire {
  return {
    kind: "activate_with_permit",
    isaId: String(isaId),
    deadline: deadline.toString(),
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}

// ── FR-008's live check — at step-2 entry, step-3 entry, AND pre-signature ─
//
// Every check RESOLVES within CHECK_TIMEOUT_MS (device-gate rule: a check
// stuck on "Memeriksa…" with zero reads dispatched is the bug class — the
// runner never rejects and never hangs; a failed or slow read is the honest
// "error" verdict with a retry, never an infinite spinner).

export type DraftState = "ok" | "over-limit" | "not-draftable" | "error";

export interface CheckResult {
  state: DraftState;
  /** The live offer behind an over-limit verdict — the inline copy states it. */
  offerAusd: bigint;
}

export const CHECK_TIMEOUT_MS = 5_000;

/** checkDraftable under the resolution bound. Never throws, never hangs: a
 *  timeout or a failed read resolves `error` (offer 0 — there is no live
 *  offer to state). Callers treat `error` as UX sugar, never a submission
 *  block — the contract and the relayer's 409s are the enforcement. */
export async function runLiveCheck(
  reader: ChainReader,
  isaId: number,
  principalAusd: bigint,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      checkDraftable(reader, isaId, principalAusd),
      new Promise<CheckResult>((resolve) => {
        timer = setTimeout(() => resolve({ state: "error", offerAusd: 0n }), timeoutMs);
      }),
    ]);
  } catch {
    return { state: "error", offerAusd: 0n };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function checkDraftable(
  reader: ChainReader,
  isaId: number,
  principalAusd: bigint,
): Promise<CheckResult> {
  const isa = await reader.isaOf(BigInt(isaId));
  if (isa.status !== ISA_STATUS.drafted) {
    return { state: "not-draftable", offerAusd: 0n };
  }
  const offerAusd = await reader.offerOf(isa.seeker);
  return { state: offerAusd >= principalAusd ? "ok" : "over-limit", offerAusd };
}

// ── the read-back poll (the relayer lands the job; the chain confirms) ─────

const POLL_DELAY_MS = 1_500;

/** True once isaOf reports Active within `timeoutMs` (the contract — not the
 *  API receipt — is the authority, constitution IV). */
export async function pollActive(
  reader: ChainReader,
  isaId: number,
  timeoutMs: number,
  now: () => number = Date.now,
  delayMs: number = POLL_DELAY_MS,
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const isa = await reader.isaOf(BigInt(isaId));
    if (isa.status === ISA_STATUS.active) return true;
    if (now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export const DEFAULTS = {
  chainId: KITE_DEPLOYMENT.chainId,
  ausd: KITE_DEPLOYMENT.ausd as HexAddress,
  core: KITE_DEPLOYMENT.kiteCore as HexAddress,
};

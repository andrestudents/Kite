// T031 — the Kirim seam (FR-016, jobs-route.md): the sender's EIP-3009
// TransferWithAuthorization over the SAME AUSD domain as the Dukung permit
// (MockAUSD §header), the decimal-string wire shape, the INLINE sufficiency
// check that runs BEFORE any signature, and the balance read-back that only
// then says Lunas (constitution IV — submitted ≠ done). Screens never see
// viem: this module rides the same prompt-free session primitive as T016.
import { type Hex, hashTypedData, toBytes } from "viem";
import type { TransferJobBody } from "../api/client.js";
import type { StorageLike } from "../auth/session.js";
import { makeTxAccount } from "../auth/tx.js";
import type { AccountSession } from "../auth/types.js";
import type { ChainReader, HexAddress } from "../chain/client.js";
import { chainReader } from "../chain/client.js";
import type { ApiClient } from "./bootstrap.js";
import { parseAusdInput } from "./draft.js";
import { type PermitDomain, splitSig65 } from "./dukung.js";
import { saveSentRecord } from "./records.js";

// ── EIP-3009 over the AUSD domain (MockAUSD's typehash, six fields) ────────

export interface TransferAuthMessage {
  from: HexAddress;
  to: HexAddress;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

export const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The EIP-712 digest the session's prompt-free primitive signs in tests. */
export function transferDigest(domain: PermitDomain, message: TransferAuthMessage): Uint8Array {
  return toBytes(
    hashTypedData({
      domain,
      types: TRANSFER_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    }),
  );
}

/** The signer seam — one biometric confirmation signs the authorization. */
export interface TransferSigner {
  sign(
    domain: PermitDomain,
    message: TransferAuthMessage,
  ): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }>;
}

export function makeDefaultTransferSigner(
  session: AccountSession,
  chainId: number,
): TransferSigner {
  const account = makeTxAccount(session, chainId);
  return {
    async sign(domain, message) {
      const sig: Hex = await account.signTypedData({
        domain,
        types: TRANSFER_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
      });
      return splitSig65(sig);
    },
  };
}

/** 32 random bytes — EIP-3009 nonces are single-use forever. */
export function freshNonce(
  randoms: { getRandomValues(b: Uint8Array): Uint8Array } = crypto,
): `0x${string}` {
  const bytes = new Uint8Array(32);
  randoms.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ── the recipient: a receive-code (profile URL) or a bare address ─────────

export type ParsedRecipient =
  | { kind: "address"; address: HexAddress }
  | { kind: "profile"; id: string };

export function parseRecipient(raw: string): ParsedRecipient | null {
  const s = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: "address", address: s as HexAddress };
  const m = s.match(/\/p\/([^/?#]+)/);
  return m?.[1] ? { kind: "profile", id: decodeURIComponent(m[1]) } : null;
}

/** A profile-code recipient resolves through the public surface (keyless);
 *  anything unresolvable stays null — the screen says so, never guesses. */
export async function resolveRecipient(
  api: ApiClient,
  parsed: ParsedRecipient,
): Promise<HexAddress | null> {
  if (parsed.kind === "address") return parsed.address;
  try {
    const dto = await api.profile(parsed.id);
    return /^0x[0-9a-fA-F]{40}$/.test(dto.wallet) ? (dto.wallet as HexAddress) : null;
  } catch {
    return null;
  }
}

// ── the inline check BEFORE any signature (FR-016) ────────────────────────

export type SendState = "ok" | "insufficient";

export interface SendCheckResult {
  state: SendState;
  /** The live balance behind an insufficient verdict — the inline copy states it. */
  balanceAusd: bigint;
}

export async function checkSufficient(
  reader: ChainReader,
  from: HexAddress,
  valueAusd: bigint,
): Promise<SendCheckResult> {
  const balanceAusd = await reader.balanceAusd(from);
  return { state: balanceAusd >= valueAusd ? "ok" : "insufficient", balanceAusd };
}

// ── the wire shape (jobs-route.md §2 — decimal strings, EIP-55 hex) ───────

/** One hour — the authorization lives just long enough for the relayer. */
export const TRANSFER_TTL_SEC = 3_600;

export function buildTransferWire(
  from: HexAddress,
  to: HexAddress,
  valueAusd: bigint,
  nowSec: number,
  sig: { v: number; r: string; s: string },
  nonce: `0x${string}`,
): TransferJobBody {
  return {
    kind: "transfer_with_authorization",
    from,
    to,
    valueAusd: valueAusd.toString(),
    validAfter: BigInt(Math.floor(nowSec)).toString(),
    validBefore: BigInt(Math.floor(nowSec) + TRANSFER_TTL_SEC).toString(),
    nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}

// ── the read-back poll: Lunas ONLY when the chain shows the delta ─────────

const POLL_DELAY_MS = 1_500;

/** How long the balance read-back waits before admitting "not confirmed". */
export const READ_BACK_TIMEOUT_MS = 30_000;

/** True once balanceOf reports the value gone within `timeoutMs` (the
 *  contract — not the 202 receipt — is the authority, constitution IV). A
 *  simultaneous income landing only pulls the balance further down, so the
 *  `<=` comparison stays honest in both directions. */
export async function pollBalanceDropped(
  reader: ChainReader,
  from: HexAddress,
  beforeAusd: bigint,
  valueAusd: bigint,
  timeoutMs: number,
  now: () => number = Date.now,
  delayMs: number = POLL_DELAY_MS,
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const balance = await reader.balanceAusd(from);
    if (balance <= beforeAusd - valueAusd) return true;
    if (now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/** The module reader — screens default to this, tests inject their own. */
export const kirimReader: ChainReader = chainReader;

// ── ONE send, in the FR-016 order ──────────────────────────────────────────

export type SendOutcome =
  | { ok: true; to: HexAddress; valueAusd: bigint }
  | {
      ok: false;
      reason:
        | "invalid-recipient"
        | "unresolved"
        | "invalid-amount"
        | "insufficient"
        | "unconfirmed"
        | "error";
      balanceAusd?: bigint;
    };

export interface KirimDeps {
  api: ApiClient;
  reader: ChainReader;
  signer: TransferSigner;
  storage: StorageLike;
  from: HexAddress;
  nowSec(): number;
  nonce(): `0x${string}`;
  /** test seam — the real send waits the full read-back window */
  timeoutMs?: number;
}

/** Resolve → INLINE check → sign → submit → read-back → record. The signer
 *  is untouched unless the recipient resolved AND the live balance covers
 *  the amount — an over-balance attempt can never reach a passkey prompt. */
export async function sendKirim(
  deps: KirimDeps,
  domain: PermitDomain,
  recipientRaw: string,
  amountRaw: string,
): Promise<SendOutcome> {
  const parsed = parseRecipient(recipientRaw);
  if (parsed === null) return { ok: false, reason: "invalid-recipient" };
  const to = await resolveRecipient(deps.api, parsed);
  if (to === null) return { ok: false, reason: "unresolved" };
  const value = parseAusdInput(amountRaw);
  if (value === null || value <= 0n) return { ok: false, reason: "invalid-amount" };
  const check = await checkSufficient(deps.reader, deps.from, value);
  if (check.state === "insufficient") {
    return { ok: false, reason: "insufficient", balanceAusd: check.balanceAusd };
  }
  try {
    const nowSec = deps.nowSec();
    const sig = await deps.signer.sign(domain, {
      from: deps.from,
      to,
      value,
      validAfter: BigInt(nowSec),
      validBefore: BigInt(nowSec) + BigInt(TRANSFER_TTL_SEC),
      nonce: deps.nonce(),
    });
    await deps.api.postJob(buildTransferWire(deps.from, to, value, nowSec, sig, deps.nonce()));
    const confirmed = await pollBalanceDropped(
      deps.reader,
      deps.from,
      check.balanceAusd,
      value,
      deps.timeoutMs ?? READ_BACK_TIMEOUT_MS,
    );
    if (!confirmed) return { ok: false, reason: "unconfirmed" };
    saveSentRecord(deps.storage, { to, valueAusd: value, at: Date.now() });
    return { ok: true, to, valueAusd: value };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// T006 — the client side of the frozen session contract
// (specs/006-mera-passkey-onboarding/contracts/auth-session.md §1–§2). The
// message format is FROZEN; the digest formula lives in the contract
// (EIP-191 via viem hashMessage) and is NOT duplicated here. Storage keeps
// the signed proof (wallet, until, sig) — never the key (data-model §2.2).

export const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // FR-007: at most 7 days

/** The frozen message — EXACTLY three lines, no extras (contract §1). */
export function buildSessionMessage(wallet: string, until: number): string {
  return `Sign in to Kite\n${wallet}\nuntil ${until}`;
}

export interface SessionSignature {
  v: number;
  r: string;
  s: string;
}

/** Hex for a byte range without copying the whole buffer needlessly. */
function hexOf(bytes: Uint8Array, start: number, end: number): `0x${string}` {
  let out = "0x";
  for (const byte of bytes.slice(start, end)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

/**
 * Wire {v, r, s} from a signing session's compact r‖s (64 bytes, low-S) and
 * recovery bit — contract §1.1: v = 27 + recovery, r/s 0x-prefixed 64 hex.
 * Pure, so the adapter's serialization is unit-testable without a ceremony.
 */
export function splitCompactSignature(
  compact: Uint8Array,
  recovery: number,
): { v: number; r: `0x${string}`; s: `0x${string}` } {
  if (compact.length !== 64) {
    throw new Error(`compact signature must be 64 bytes, got ${compact.length}`);
  }
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`recovery bit must be 0 or 1, got ${recovery}`);
  }
  return { v: 27 + recovery, r: hexOf(compact, 0, 32), s: hexOf(compact, 32, 64) };
}

/** Wire encoding (contract §2): `<wallet>|<until>|<v>|<r>|<s>`, pipe, no spaces. */
export function serializeSessionHeader(
  wallet: string,
  until: number,
  sig: SessionSignature,
): string {
  return `${wallet}|${until}|${sig.v}|${sig.r}|${sig.s}`;
}

export interface ParsedSessionHeader {
  wallet: string;
  until: number;
  v: number;
  r: string;
  s: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Strict §2 parse — anything malformed is null (the server's mirror rejects). */
export function parseSessionHeader(raw: string | null | undefined): ParsedSessionHeader | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 5) return null;
  const [wallet, untilRaw, vRaw, r, s] = parts;
  if (!wallet || !untilRaw || !vRaw || !r || !s) return null;
  if (!ADDRESS_RE.test(wallet)) return null;
  if (!/^\d+$/.test(untilRaw)) return null;
  // v is DECIMAL 27|28 (contract §2) — Number() alone would accept "0x1b" as 27.
  if (!/^\d+$/.test(vRaw)) return null;
  const until = Number(untilRaw);
  const v = Number(vRaw);
  if (!Number.isSafeInteger(until) || !Number.isSafeInteger(v)) return null;
  if (v !== 27 && v !== 28) return null;
  if (!HEX32_RE.test(r) || !HEX32_RE.test(s)) return null;
  return { wallet, until, v, r, s };
}

/** SessionBlob — the refresh-survival artifact (data-model §2.2). */
export interface SessionBlob {
  wallet: string;
  until: number;
  sig: SessionSignature;
}

export function headerFromBlob(blob: SessionBlob): string {
  return serializeSessionHeader(blob.wallet, blob.until, blob.sig);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_KEY = "kite.session.v1";

export function saveSessionBlob(storage: StorageLike, blob: SessionBlob): void {
  storage.setItem(SESSION_KEY, JSON.stringify(blob));
}

export function loadSessionBlob(storage: StorageLike): SessionBlob | null {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { wallet, until, sig } = parsed as Record<string, unknown>;
    if (typeof wallet !== "string" || typeof until !== "number") return null;
    if (typeof sig !== "object" || sig === null) return null;
    const { v, r, s } = sig as Record<string, unknown>;
    if (
      typeof v !== "number" ||
      typeof r !== "string" ||
      typeof s !== "string" ||
      parseSessionHeader(serializeSessionHeader(wallet, until, { v, r, s })) === null
    ) {
      return null;
    }
    return { wallet, until, sig: { v, r, s } };
  } catch {
    return null;
  }
}

export function clearSessionBlob(storage: StorageLike): void {
  storage.removeItem(SESSION_KEY);
}

/** Client-side freshness pre-check (the SERVER stays the authority, FR-007). */
export function isSessionUsable(blob: SessionBlob | null, nowSec: number): boolean {
  return blob !== null && Number.isSafeInteger(blob.until) && nowSec < blob.until;
}

/** FR-007 cap: issuedAt < until ≤ issuedAt + 7d — the client issues at the cap. */
export function defaultUntil(nowSec: number): number {
  return nowSec + SESSION_TTL_SEC;
}

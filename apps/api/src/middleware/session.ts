// T007 — the session middleware (contracts/auth-session.md §2–§3): identity
// is RECOVERED from the signature, never asserted. Local ecrecover only — no
// RPC. This file owns the five named conformance tests (FR-007); downstream
// route work (T015, T018) is attachment-only.
//
// Known limitation (TRUST.md): the header is bearer-like and replayable
// within its window — accepted for MVP; nonce binding is roadmap.

import { KiteError } from "@kite/core";
import type { MiddlewareHandler } from "hono";
import { type Address, getAddress, recoverMessageAddress } from "viem";

export const SESSION_HEADER = "x-kite-session";
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // FR-007: expiry at most 7 days
const SKEW_SEC = 60; // §3.5 clock-skew allowance on the upper bound

/** The frozen message — EXACTLY the contract §1 string (client lockstep). */
export function buildSessionMessage(wallet: string, until: number): string {
  return `Sign in to Kite\n${wallet}\nuntil ${until}`;
}

export interface ParsedSession {
  wallet: Address; // EIP-55 checksummed — §2 requires the exact form
  until: number;
  signature: `0x${string}`; // r‖s‖v, 65 bytes, v ∈ {27, 28}
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX64_RE = /^0x[0-9a-fA-F]{64}$/;

/** §2 parse — strict. Anything malformed is null, never a best-effort read. */
export function parseSessionHeader(raw: string | undefined | null): ParsedSession | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 5) return null;
  const [wallet, untilRaw, vRaw, r, s] = parts;
  if (!wallet || !untilRaw || !vRaw || !r || !s) return null;
  if (!ADDRESS_RE.test(wallet) || getAddress(wallet) !== wallet) return null; // EIP-55 exact
  if (!/^\d+$/.test(untilRaw)) return null;
  // v is DECIMAL 27|28 — Number() alone would read "0x1b" as 27.
  if (!/^\d+$/.test(vRaw)) return null;
  if (!HEX64_RE.test(r) || !HEX64_RE.test(s)) return null;
  const until = Number(untilRaw);
  const v = Number(vRaw);
  if (!Number.isSafeInteger(until) || (v !== 27 && v !== 28)) return null;
  const vHex = v.toString(16).padStart(2, "0");
  return { wallet, until, signature: `0x${r.slice(2)}${s.slice(2)}${vHex}` };
}

export type SessionEnv = { Variables: { wallet: Address } };

/** §3 verification: parse → recover → declared==recovered → window → attach. */
export function sessionAuth(): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const parsed = parseSessionHeader(c.req.header(SESSION_HEADER));
    if (!parsed) {
      throw new KiteError("session_invalid", "missing or malformed session header");
    }
    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({
        message: buildSessionMessage(parsed.wallet, parsed.until),
        signature: parsed.signature,
      });
    } catch {
      throw new KiteError("session_invalid", "signature does not verify");
    }
    if (recovered.toLowerCase() !== parsed.wallet.toLowerCase()) {
      throw new KiteError("session_invalid", "recovered identity differs from declared wallet");
    }
    const now = Math.floor(Date.now() / 1000);
    if (now >= parsed.until) {
      throw new KiteError("session_expired", "session has expired");
    }
    if (parsed.until > now + MAX_AGE_SEC + SKEW_SEC) {
      throw new KiteError("session_invalid", "session window exceeds the 7-day cap");
    }
    c.set("wallet", recovered);
    await next();
  };
}

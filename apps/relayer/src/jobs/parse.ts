// T023–T025 — payload guards for the job handlers. A malformed payload can
// never succeed, so every guard throws bad_request (which dispatchJob turns
// into an IMMEDIATE terminal — no retries burned on a deterministic failure).
//
// Wire contract (http-api.md): JSON cannot carry a uint256 safely as a JS
// number, so uint256 payload fields arrive as DECIMAL STRINGS; this module is
// the edge where they are parsed and validated. Integral numbers are still
// accepted for small fields (and for the in-process tests); raw BigInt is NOT
// — a BigInt in a payload would explode jsonb serialization at enqueue time.

import { KiteError } from "@kite/core";
import { isAddress, isHex } from "viem";

function bad(what: string): never {
  throw new KiteError("bad_request", what);
}

export function asPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    bad("job payload must be an object");
  }
  return raw as Record<string, unknown>;
}

export function requireAddress(p: Record<string, unknown>, key: string): `0x${string}` {
  const v = p[key];
  if (typeof v !== "string" || !isAddress(v)) {
    bad(`payload.${key} must be an address`);
  }
  return v as `0x${string}`;
}

export function requireBytes32(p: Record<string, unknown>, key: string): `0x${string}` {
  const v = p[key];
  if (typeof v !== "string" || !isHex(v, { strict: true }) || v.length !== 66) {
    bad(`payload.${key} must be a bytes32 hex string`);
  }
  return v as `0x${string}`;
}

/** uint256 on the wire: a decimal-string ("1000000") or a small integral
 *  number; returns the exact BigInt (constitution VI — no floats anywhere). */
export function requireUint(p: Record<string, unknown>, key: string): bigint {
  const v = p[key];
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
    return BigInt(v);
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    return BigInt(v);
  }
  bad(`payload.${key} must be a non-negative integer (decimal string on the wire)`);
}

/** An EIP-712/3009 signature triplet {v, r, s}. */
export function requireSig(p: Record<string, unknown>): {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
} {
  const v = requireUint(p, "v");
  if (v !== 27n && v !== 28n) {
    bad("payload.v must be 27 or 28");
  }
  return { v: Number(v), r: requireBytes32(p, "r"), s: requireBytes32(p, "s") };
}

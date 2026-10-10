// T023–T025 — payload guards for the job handlers. A malformed payload can
// never succeed, so every guard throws bad_request (which dispatchJob turns
// into an IMMEDIATE terminal — no retries burned on a deterministic failure).

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

export function requireUint(p: Record<string, unknown>, key: string): number {
  const v = p[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    bad(`payload.${key} must be a non-negative integer`);
  }
  return v;
}

/** An EIP-712/3009 signature triplet {v, r, s}. */
export function requireSig(p: Record<string, unknown>): {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
} {
  const v = requireUint(p, "v");
  if (v !== 27 && v !== 28) {
    bad("payload.v must be 27 or 28");
  }
  return { v, r: requireBytes32(p, "r"), s: requireBytes32(p, "s") };
}

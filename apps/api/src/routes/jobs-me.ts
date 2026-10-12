// T012 — the ONE new surface (contracts/jobs-route.md): a whitelisted,
// session-authed forward to 006's relayer client. The route validates shape
// (naming the FIELD, never the value), then refuses what the contract would
// revert (live read-back caps — research D2), then enqueues with a
// DETERMINISTIC clientRef so a client retry can never double-submit. No key
// ever reaches this module — the INTERNAL key lives only inside the relayer
// client, and no response field or log line echoes credential material.
import { KiteError } from "@kite/core";
import { Hono } from "hono";
import { getAddress } from "viem";
import type { ApiDeps } from "../app.js";
import { sessionAuth } from "../middleware/session.js";
import type { RelayerClient } from "../services/relayer-client.js";
import { activateJobClientRef, transferJobClientRef } from "../services/relayer-client.js";

/** ISA status machine (modules/ISA.sol): 1 = Drafted — the only activable
 *  state. Non-Drafted (unknown id included) is 409, never a blind enqueue. */
const DRAFTED = 1;
const DEC = /^\d+$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
/** isaOf() reads through a JS number — ids past 2^53-1 are unreadable here. */
const MAX_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);

/** EIP-55 exact — the same bar the session header sets (middleware/session). */
function requireEip55(p: Record<string, unknown>, field: string): string {
  const v = p[field];
  if (typeof v !== "string") {
    throw new KiteError("job_payload_invalid", `payload.${field} must be an address`);
  }
  try {
    if (getAddress(v) !== v) throw new Error("checksum mismatch");
  } catch {
    throw new KiteError("job_payload_invalid", `payload.${field} must be an EIP-55 address`);
  }
  return v;
}

/** uint256 wire rule: decimal strings (never floats, never hex) — the same
 *  grammar the relayer's parse.ts enforces at its edge. */
function requireDecUint(p: Record<string, unknown>, field: string): string {
  const v = p[field];
  if (typeof v !== "string" || !DEC.test(v)) {
    throw new KiteError(
      "job_payload_invalid",
      `payload.${field} must be a decimal string (uint256 wire rule)`,
    );
  }
  return v;
}

function requireHex32(p: Record<string, unknown>, field: string): string {
  const v = p[field];
  if (typeof v !== "string" || !HEX32.test(v)) {
    throw new KiteError("job_payload_invalid", `payload.${field} must be 0x + 64 hex chars`);
  }
  return v;
}

function requireV(p: Record<string, unknown>): number {
  const v = p.v;
  if (typeof v !== "number" || !Number.isInteger(v) || (v !== 27 && v !== 28)) {
    throw new KiteError("job_payload_invalid", "payload.v must be 27 or 28");
  }
  return v;
}

/** sessionAuth() attached below guarantees this. */
const walletOf = (c: unknown): string =>
  (c as { get(key: string): unknown }).get("wallet") as string;

export function jobsMeRoutes(deps: ApiDeps & { relayer: RelayerClient }): Hono {
  const routes = new Hono();
  const relayer = deps.relayer;

  routes.use("/api/me/jobs", sessionAuth());

  routes.post("/api/me/jobs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null) {
      throw new KiteError("job_payload_invalid", "body must be a JSON object");
    }
    const kind = body.kind;
    const wallet = walletOf(c);

    // Whitelist FIRST (contract §1): this route may never become a general
    // relay — even real 005 kinds are rejected here.
    if (kind === "activate_with_permit") {
      const isaId = requireDecUint(body, "isaId");
      const id = BigInt(isaId);
      if (id > MAX_SAFE_ID) {
        throw new KiteError("job_payload_invalid", "payload.isaId is outside the readable range");
      }
      const deadline = requireDecUint(body, "deadline");
      const v = requireV(body);
      const r = requireHex32(body, "r");
      const s = requireHex32(body, "s");
      // Live caps (contract §3.4): refuse what the contract would revert —
      // the machine status and the seeker's CURRENT offer, read back NOW.
      const isa = await deps.chain.isaOf(Number(id));
      if (isa.status !== DRAFTED) {
        throw new KiteError("isa_not_draftable", "isa is not in the Drafted state");
      }
      const offer = await deps.chain.offerOf(isa.seeker);
      if (BigInt(offer) < BigInt(isa.principal)) {
        throw new KiteError(
          "offer_below_principal",
          "seeker offer has fallen below the drafted principal",
        );
      }
      const clientRef = activateJobClientRef(isaId);
      const payload = { isaId, deadline, v, r, s };
      const { jobId } = await relayer.enqueue({ kind, payload, clientRef });
      return c.json({ jobId: String(jobId), clientRef }, 202);
    }

    if (kind === "transfer_with_authorization") {
      const from = requireEip55(body, "from");
      const to = requireEip55(body, "to");
      const valueAusd = requireDecUint(body, "valueAusd");
      const validAfter = requireDecUint(body, "validAfter");
      const validBefore = requireDecUint(body, "validBefore");
      const nonce = requireHex32(body, "nonce");
      const v = requireV(body);
      const r = requireHex32(body, "r");
      const s = requireHex32(body, "s");
      if (from.toLowerCase() !== wallet.toLowerCase()) {
        throw new KiteError("sender_mismatch", "payload.from does not match the session wallet");
      }
      // Live cap: an authorization can never carry more than the live balance.
      const balance = await deps.chain.balanceAusd(wallet);
      if (balance < BigInt(valueAusd)) {
        throw new KiteError("cap_exceeded", "amount exceeds the live balance");
      }
      const clientRef = transferJobClientRef(from, nonce);
      const payload = { from, to, valueAusd, validAfter, validBefore, nonce, v, r, s };
      const { jobId } = await relayer.enqueue({ kind, payload, clientRef });
      return c.json({ jobId: String(jobId), clientRef }, 202);
    }

    throw new KiteError(
      "job_kind_invalid",
      "kind is not on the whitelist (activate_with_permit, transfer_with_authorization)",
    );
  });

  return routes;
}

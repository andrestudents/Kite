// The §7.2 purchase registry (PLAN §7.2 rules 1–3, FR-005..FR-008):
// idempotent create capturing the mill signature AT CREATION, the forward-only
// PENDING → PAID transition with an append-only attempt log, and the DTO the
// http-api contract fixes. Rows are never deleted; the UNIQUE
// (channel_id, purchase_ref) is the replay lock; every change appends to
// purchase_transitions.

import { assertMoneyInteger, KiteError, type PurchaseDto } from "@kite/core";
import {
  type AnyDb,
  execute,
  type MillSig,
  type NewPurchase,
  PURCHASE_STATUS,
  PURCHASE_TRANSITIONS,
  type Purchase,
  purchases,
  purchaseTransitions,
} from "@kite/core/db";
import { and, desc, eq } from "drizzle-orm";
import type { ChainClient } from "./chain.js";
import { type IncomePayload, verifyMillSignature } from "./income-sig.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-fA-F-]{36}$/;

export function toPurchaseDto(row: Purchase): PurchaseDto {
  return {
    id: row.id,
    channelId: row.channelId,
    isaId: row.isaId,
    purchaseRef: row.purchaseRef,
    grossAusd: row.grossAusd,
    status: row.status as PurchaseDto["status"],
    txHash: row.txHash,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  };
}

/** First row or 404 — the selects feeding this always carry a guard; this
 *  just satisfies noUncheckedIndexedAccess honestly. */
function mustRow(rows: Purchase[]): Purchase {
  const row = rows[0];
  if (!row) {
    throw new KiteError("purchase_not_found", "no such purchase");
  }
  return row;
}

export interface PurchaseIntent {
  channelId: number;
  isaId: number;
  purchaseRef: string;
  grossAusd: number;
  millSig: MillSig;
}

/** Structural validation → 422-shaped KiteErrors. Never interprets the
 *  signature here (that needs the channel registry read). */
export function validateIntent(raw: unknown): PurchaseIntent {
  if (typeof raw !== "object" || raw === null) {
    throw new KiteError("bad_request", "body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const channelId = body.channelId;
  const isaId = body.isaId;
  if (typeof channelId !== "number" || !Number.isInteger(channelId) || channelId <= 0) {
    throw new KiteError("bad_request", "channelId must be a positive integer");
  }
  if (typeof isaId !== "number" || !Number.isInteger(isaId) || isaId <= 0) {
    throw new KiteError("bad_request", "isaId must be a positive integer");
  }
  if (typeof body.purchaseRef !== "string" || !HEX32.test(body.purchaseRef)) {
    throw new KiteError("bad_request", "purchaseRef must be a 0x-prefixed bytes32 hex string");
  }
  const grossAusd = assertMoneyInteger(body.grossAusd, "grossAusd");

  const sig = body.millSig;
  if (typeof sig !== "object" || sig === null) {
    throw new KiteError("bad_request", "millSig must be {salt, v, r, s}");
  }
  const { salt, v, r, s } = sig as Record<string, unknown>;
  if (typeof salt !== "string" || !HEX32.test(salt)) {
    throw new KiteError("bad_request", "millSig.salt must be a 0x-prefixed bytes32 hex string");
  }
  if ((v !== 27 && v !== 28) || typeof v !== "number") {
    throw new KiteError("bad_request", "millSig.v must be 27 or 28");
  }
  if (typeof r !== "string" || !HEX32.test(r) || typeof s !== "string" || !HEX32.test(s)) {
    throw new KiteError(
      "bad_request",
      "millSig.r and millSig.s must be 0x-prefixed bytes32 hex strings",
    );
  }
  return { channelId, isaId, purchaseRef: body.purchaseRef, grossAusd, millSig: { salt, v, r, s } };
}

async function readChannel(chain: ChainClient, channelId: number) {
  try {
    const channel = await chain.channelOf(channelId);
    if (!channel.active) {
      throw new KiteError("unknown_channel", "channel is not active");
    }
    return channel;
  } catch (err) {
    if (err instanceof KiteError) throw err;
    throw new KiteError("unknown_channel", "channel does not exist");
  }
}

async function readIsa(chain: ChainClient, isaId: number) {
  try {
    const isa = await chain.isaOf(isaId);
    if (isa.status === 0) {
      throw new KiteError("unknown_isa", "deal does not exist");
    }
    return isa;
  } catch (err) {
    if (err instanceof KiteError) throw err;
    throw new KiteError("unknown_isa", "deal does not exist");
  }
}

function sameIntent(row: Purchase, intent: PurchaseIntent): boolean {
  return (
    row.isaId === intent.isaId &&
    row.grossAusd === intent.grossAusd &&
    row.millSig.salt === intent.millSig.salt &&
    row.millSig.v === intent.millSig.v &&
    row.millSig.r === intent.millSig.r &&
    row.millSig.s === intent.millSig.s
  );
}

/** Create-or-return the identical purchase (§7.2 rule 1). Throws
 *  purchase_ref_conflict when a live ref is reused with a different payload. */
export async function createPurchase(
  db: AnyDb,
  chain: ChainClient,
  raw: unknown,
): Promise<{ purchase: PurchaseDto; created: boolean }> {
  const intent = validateIntent(raw);

  const channel = await readChannel(chain, intent.channelId);
  const isa = await readIsa(chain, intent.isaId);
  if (isa.channelId !== intent.channelId) {
    throw new KiteError("unknown_isa", "deal does not belong to this channel");
  }

  const payload: IncomePayload = {
    channelId: intent.channelId,
    isaId: intent.isaId,
    purchaseRef: intent.purchaseRef as `0x${string}`,
    gross: intent.grossAusd,
    salt: intent.millSig.salt as `0x${string}`,
  };
  if (!(await verifyMillSignature(intent.millSig, payload, channel.pubkey))) {
    throw new KiteError("invalid_signature", "millSig does not verify against the channel signer");
  }

  const existing = await db
    .select()
    .from(purchases)
    .where(
      and(eq(purchases.channelId, intent.channelId), eq(purchases.purchaseRef, intent.purchaseRef)),
    )
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    if (!sameIntent(existingRow, intent)) {
      throw new KiteError(
        "purchase_ref_conflict",
        "purchase_ref already used with a different payload",
      );
    }
    return { purchase: toPurchaseDto(existingRow), created: false };
  }

  const id = crypto.randomUUID();
  await execute(db, async (tx) => {
    await tx.insert(purchases).values({
      id,
      channelId: intent.channelId,
      isaId: intent.isaId,
      purchaseRef: intent.purchaseRef,
      grossAusd: intent.grossAusd,
      status: PURCHASE_STATUS.PENDING,
      millSig: intent.millSig,
    });
    await tx.insert(purchaseTransitions).values({
      purchaseId: id,
      fromStatus: "CREATED",
      toStatus: PURCHASE_STATUS.PENDING,
      actor: "mita-api",
    });
  });

  const row = await db.select().from(purchases).where(eq(purchases.id, id)).limit(1);
  return { purchase: toPurchaseDto(mustRow(row)), created: true };
}

export async function getPurchase(db: AnyDb, id: string): Promise<PurchaseDto> {
  if (!UUID.test(id)) {
    throw new KiteError("purchase_not_found", "no such purchase");
  }
  const rows = await db.select().from(purchases).where(eq(purchases.id, id)).limit(1);
  return toPurchaseDto(mustRow(rows));
}

/** The one authenticated money transition: PENDING → PAID (FR-007). Every
 *  other move — skips, regressions, repeats — is rejected AND logged. The
 *  PAID → SETTLED/FAILED legs are internal (watcher / submit-settlement), never
 *  an HTTP route. */
export async function markPurchasePaid(db: AnyDb, id: string, actor: string): Promise<PurchaseDto> {
  if (!UUID.test(id)) {
    throw new KiteError("purchase_not_found", "no such purchase");
  }
  try {
    return await execute(db, async (tx) => {
      const rows = await tx.select().from(purchases).where(eq(purchases.id, id)).limit(1);
      const row = mustRow(rows);
      const allowed = PURCHASE_TRANSITIONS[row.status as PurchaseDto["status"]] ?? [];
      if (!allowed.includes(PURCHASE_STATUS.PAID)) {
        throw new KiteError("invalid_transition", `cannot move ${row.status} → PAID`);
      }
      const updated = await tx
        .update(purchases)
        .set({ status: PURCHASE_STATUS.PAID })
        .where(and(eq(purchases.id, id), eq(purchases.status, row.status)))
        .returning();
      await tx.insert(purchaseTransitions).values({
        purchaseId: id,
        fromStatus: row.status,
        toStatus: PURCHASE_STATUS.PAID,
        actor,
      });
      return toPurchaseDto(mustRow(updated));
    });
  } catch (err) {
    if (err instanceof KiteError && err.code === "invalid_transition") {
      // §7.2 rule 2: the attempt is logged, THEN rejected. The rejection aborts
      // the executor transaction (PGlite/Postgres roll the in-tx log back), so
      // the rejected-attempt row is a compensating write outside it — every
      // driver ends with exactly one `rejected:` row in the trail.
      const current = await db.select().from(purchases).where(eq(purchases.id, id)).limit(1);
      await db.insert(purchaseTransitions).values({
        purchaseId: id,
        fromStatus: current[0]?.status ?? "UNKNOWN",
        toStatus: PURCHASE_STATUS.PAID,
        actor: `rejected:${actor}`,
      });
    }
    throw err;
  }
}

/** The internal terminal leg (T019): PAID → FAILED on a terminal revert,
 *  with the reason recorded (§7.2 aux failed_reason). Never an HTTP route. */
export async function markPurchaseFailed(
  db: AnyDb,
  id: string,
  actor: string,
  reason: string,
): Promise<PurchaseDto> {
  if (!UUID.test(id)) {
    throw new KiteError("purchase_not_found", "no such purchase");
  }
  return execute(db, async (tx) => {
    const row = mustRow(await tx.select().from(purchases).where(eq(purchases.id, id)).limit(1));
    const allowed = PURCHASE_TRANSITIONS[row.status as PurchaseDto["status"]] ?? [];
    if (!allowed.includes(PURCHASE_STATUS.FAILED)) {
      throw new KiteError("invalid_transition", `cannot move ${row.status} → FAILED`);
    }
    const updated = await tx
      .update(purchases)
      .set({ status: PURCHASE_STATUS.FAILED, failedReason: reason })
      .where(and(eq(purchases.id, id), eq(purchases.status, row.status)))
      .returning();
    await tx.insert(purchaseTransitions).values({
      purchaseId: id,
      fromStatus: row.status,
      toStatus: PURCHASE_STATUS.FAILED,
      actor,
    });
    return toPurchaseDto(mustRow(updated));
  });
}

/** Transition log reader — the append-only evidence trail (never edited). */
export async function transitionsOf(db: AnyDb, id: string) {
  return db
    .select()
    .from(purchaseTransitions)
    .where(eq(purchaseTransitions.purchaseId, id))
    .orderBy(desc(purchaseTransitions.id));
}

/** T033 — the console's registry read (MITA-keyed route): the latest rows,
 *  Kite and non-Kite channels alike, newest first. Read-only — the registry
 *  stays forward-only. */
export async function listPurchases(db: AnyDb, limit = 50): Promise<PurchaseDto[]> {
  const rows = await db.select().from(purchases).orderBy(desc(purchases.createdAt)).limit(limit);
  return rows.map(toPurchaseDto);
}

export type { NewPurchase };

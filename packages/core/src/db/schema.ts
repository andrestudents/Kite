// THE Drizzle schema (PLAN §7.3 verbatim + §7.2-mandated auxiliaries, D15).
// Declared once; apps/api and apps/relayer both import it (research D3).
//
// Money rule (constitution VI): every *_ausd / amount column is a Postgres
// bigint holding integer AUSD base units (6 dp). No numeric/float/decimal
// column anywhere carries money. bigint({ mode: "number" }) keeps values as
// integral JSON numbers on the wire (D14) — demo magnitudes ≪ 2^53.
//
// Onchain ids (isa_id, channel_id) are §7.3 `numeric` (mode number) — uint64
// onchain, below 2^53 in practice.
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** The mill's EIP-712 signature captured AT CREATION (research D8). */
export interface MillSig {
  salt: string;
  v: number;
  r: string;
  s: string;
}

// ── §7.3 core tables (verbatim) ─────────────────────────────────────────

/** Schema-only this feature — §7.3 mandates it verbatim; the app feature
 *  (006+) owns the read/write path. */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  wallet: text("wallet").notNull().unique(),
  phone: text("phone"),
  kycStatus: text("kyc_status").notNull().default("unverified"),
  identityHash: text("identity_hash"),
  locale: text("locale").notNull().default("id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Chain cache (projection; the contract wins, constitution IV). */
export const isas = pgTable("isas", {
  isaId: numeric("isa_id", { mode: "number" }).primaryKey(),
  seeker: text("seeker").notNull(),
  backer: text("backer").notNull(),
  principal: bigint("principal", { mode: "number" }).notNull(),
  shareBps: integer("share_bps").notNull(),
  capMult: integer("cap_mult").notNull(),
  remaining: bigint("remaining", { mode: "number" }).notNull(),
  status: text("status").notNull(),
  termEnd: bigint("term_end", { mode: "number" }).notNull(),
});

/** The §7.2 state machine: PENDING → PAID → SETTLED (+ FAILED), forward only.
 *  id is uuid (§7.3: "serial/uuid") so the creation transition row ships in
 *  the SAME atomic batch as the purchase — no dependent returning-id write. */
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: numeric("channel_id", { mode: "number" }).notNull(),
    isaId: numeric("isa_id", { mode: "number" }).notNull(),
    purchaseRef: text("purchase_ref").notNull(),
    grossAusd: bigint("gross_ausd", { mode: "number" }).notNull(),
    status: text("status").notNull().default("PENDING"),
    millSig: jsonb("mill_sig").$type<MillSig>().notNull(),
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // §7.2 aux (D15): recon day attribution + terminal failure reason.
    settledAt: timestamp("settled_at", { withTimezone: true }),
    failedReason: text("failed_reason"),
  },
  (t) => [uniqueIndex("purchases_channel_ref_uq").on(t.channelId, t.purchaseRef)],
);

export const channels = pgTable("channels", {
  id: numeric("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  pubkey: text("pubkey").notNull(),
  active: boolean("active").notNull(),
});

/** Display-only locked quotes (§7.4); read inside the TTL returns the same row. */
export const fxQuotes = pgTable("fx_quotes", {
  id: serial("id").primaryKey(),
  pair: text("pair").notNull(),
  rate: bigint("rate", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** The queue (§7.3): pending → sent → confirmed; a job is "failed" iff
 *  terminal_at is set (D5/D6/D15) — no fourth state. */
export const relayerJobs = pgTable("relayer_jobs", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  status: text("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  nonce: bigint("nonce", { mode: "number" }),
  attempts: integer("attempts").notNull().default(0),
  // §7.2 aux: idempotent enqueue + visible failure (D5/D15).
  clientRef: text("client_ref").unique(),
  lastError: text("last_error"),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
});

/** The replay lock (§7.2 rule 1): "10143:<block>:<logIndex>" for chain events. */
export const webhookEvents = pgTable("webhook_events", {
  providerEventId: text("provider_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The daily verdict (§7.3); upsert by day, latest completed run wins (D16). */
export const reconDaily = pgTable("recon_daily", {
  day: date("day").primaryKey(),
  backendTotal: bigint("backend_total", { mode: "number" }).notNull(),
  chainTotal: bigint("chain_total", { mode: "number" }).notNull(),
  status: text("status").notNull(),
});

// ── Auxiliary tables (§7.2-mandated behavior; research D15) ─────────────

/** Append-only lifecycle log (§7.2 rule 2) — rows are never edited or deleted. */
export const purchaseTransitions = pgTable("purchase_transitions", {
  id: serial("id").primaryKey(),
  purchaseId: uuid("purchase_id")
    .notNull()
    .references(() => purchases.id),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only double entry (§7.2 rule 3): per purchase Σ in == Σ out == gross. */
export const ledgerEntries = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  purchaseId: uuid("purchase_id")
    .notNull()
    .references(() => purchases.id),
  account: text("account").notNull(),
  side: text("side").notNull(),
  amountAusd: bigint("amount_ausd", { mode: "number" }).notNull(),
});

/** One-time MON drip (§7.2 rule 5, FR-017): the wallet PK IS the once-lock. */
export const drips = pgTable("drips", {
  wallet: text("wallet").primaryKey(),
  txHash: text("tx_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Checkpoints and counters (D9/D15): settlements_block, recon_baseline_ts, … */
export const jobState = pgTable("job_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Row types + the state machines (§7.2 rule 2, forward-only) ──────────

export type User = typeof users.$inferSelect;
export type IsaRow = typeof isas.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type ChannelRow = typeof channels.$inferSelect;
export type FxQuoteRow = typeof fxQuotes.$inferSelect;
export type RelayerJob = typeof relayerJobs.$inferSelect;
export type ReconRow = typeof reconDaily.$inferSelect;

/** Purchase statuses (uppercase machine states — data, not copy; D18). */
export const PURCHASE_STATUS = {
  PENDING: "PENDING",
  PAID: "PAID",
  SETTLED: "SETTLED",
  FAILED: "FAILED",
} as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS];

/** Forward-only machine (§7.2 rule 2): any transition not listed here is
 *  rejected and logged. FAILED is terminal (spec Assumption). */
export const PURCHASE_TRANSITIONS: Record<PurchaseStatus, readonly PurchaseStatus[]> = {
  PENDING: ["PAID"],
  PAID: ["SETTLED", "FAILED"],
  SETTLED: [],
  FAILED: [],
};

/** Relayer job statuses (§7.3 states only; D15). */
export const JOB_STATUS = {
  pending: "pending",
  sent: "sent",
  confirmed: "confirmed",
} as const;

/** Onchain ISA statuses → cache strings (contracts/src/modules/ISA.sol). */
export const ISA_STATUS = {
  drafted: "drafted",
  active: "active",
  completed_capped: "completed_capped",
  completed_at_term: "completed_at_term",
  cancelled: "cancelled",
} as const;

export const ISA_STATUS_BY_CODE: Record<number, string> = {
  0: ISA_STATUS.drafted, // STATUS_NONE never cached; defaulted defensively
  1: ISA_STATUS.drafted,
  2: ISA_STATUS.active,
  3: ISA_STATUS.completed_capped,
  4: ISA_STATUS.completed_at_term,
  5: ISA_STATUS.cancelled,
};

/** Relayer job kinds (FR-015) — exactly four, snake_case on the wire. */
export const JOB_KINDS = [
  "activate_with_permit",
  "transfer_with_authorization",
  "bind_identity",
  "drip",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

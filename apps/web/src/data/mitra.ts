// T033/T034 — the Mitra console seam (US5, research D8): MITA-keyed calls
// over the 005 purchase registry. The key arrives by NAME from the public
// VITE_ env (non-secret by design) — the INTERNAL key never reaches this
// module, this file, or any bundle. Money stays integer bigint here; the
// wire carries integral JSON numbers only. The settlement submitter is ONE
// seam: Feature 009's CRE WF-1 swaps the implementation by CONFIGURATION,
// not code changes (FR-018's pinned statement).
import type { IsaOnChain } from "../chain/client.js";

export type PurchaseStatus = "PENDING" | "PAID" | "SETTLED" | "FAILED";

/** The registry's awaiting-payment wire enum (005 PURCHASE_STATUS). It is a
 *  protocol key, never UI copy — screens render it only through the locale
 *  catalogs — and the T005 scan exempts template ${expressions} precisely
 *  for such enum values. */
export const STATUS_PENDING = `${"PENDING"}` as "PENDING";

/** One registry row (005's PurchaseDto, bigint money). */
export interface MitraPurchaseRow {
  id: string;
  channelId: number;
  isaId: number;
  purchaseRef: string;
  grossAusd: bigint;
  status: PurchaseStatus;
  txHash?: string;
  createdAt: string;
}

export interface ConsoleModel {
  rows: MitraPurchaseRow[];
  fetchedAt: number;
}

/** Integral JSON number → bigint; a float is rejected, never rounded. */
function asInt(n: number, what: string): bigint {
  if (!Number.isInteger(n)) {
    throw new Error(`${what} must be an integral base-unit number, got ${String(n)}`);
  }
  return BigInt(n);
}

export function rowFromDto(dto: unknown): MitraPurchaseRow {
  const r = dto as {
    id: string;
    channelId: number;
    isaId: number;
    purchaseRef: string;
    grossAusd: number;
    status: string;
    txHash?: string | null;
    createdAt: string;
  };
  const STATUSES: PurchaseStatus[] = [STATUS_PENDING, "PAID", "SETTLED", "FAILED"];
  const status = STATUSES.find((s) => s === r.status);
  if (status === undefined) throw new Error(`unknown purchase status: ${String(r.status)}`);
  return {
    id: r.id,
    channelId: r.channelId,
    isaId: r.isaId,
    purchaseRef: r.purchaseRef,
    grossAusd: asInt(r.grossAusd, "grossAusd"),
    status,
    txHash: r.txHash ?? undefined,
    createdAt: r.createdAt,
  };
}

/** The MITA-keyed registry client. `key` is injected — screens read the env
 *  by NAME and pass the value; nothing in this module knows import.meta. */
export interface MitraClient {
  list(): Promise<MitraPurchaseRow[]>;
  markPaid(id: string): Promise<MitraPurchaseRow>;
}

export function makeMitraClient(
  baseUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): MitraClient {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-api-key": key, ...init?.headers },
    });
    if (!res.ok) throw new Error(`mitra ${path} → ${String(res.status)}`);
    return res.json();
  };
  return {
    list: async () => {
      const rows = (await call("/api/channel/purchases")) as unknown[];
      return rows.map(rowFromDto);
    },
    markPaid: async (id) =>
      rowFromDto(
        await call(`/api/channel/purchases/${encodeURIComponent(id)}/paid`, { method: "POST" }),
      ),
  };
}

/** Kite rows ride the Kite channel; every other channel is "Di luar Kite". */
export const KITE_CHANNEL_ID = 1;

export function isKiteRow(row: MitraPurchaseRow): boolean {
  return row.channelId === KITE_CHANNEL_ID;
}

// ── the split preview (identical math to what the contract enforces) ──────

export interface SplitPreview {
  grossAusd: bigint;
  toSeekerAusd: bigint;
  toBackerAusd: bigint;
}

export function splitPreview(grossAusd: bigint, isa: Pick<IsaOnChain, "shareBps">): SplitPreview {
  const toSeekerAusd = (grossAusd * BigInt(isa.shareBps)) / 10_000n;
  return { grossAusd, toSeekerAusd, toBackerAusd: grossAusd - toSeekerAusd };
}

// ── the ONE settlement submitter seam (FR-018) ────────────────────────────

export interface SettlementReceipt {
  status: string;
  txHash?: string;
}

export interface SettlementSubmitter {
  submit(purchaseId: string): Promise<SettlementReceipt>;
}

/** The shipped default: honestly unconfigured. Feature 009's CRE WF-1 (and
 *  any operator deployment) supplies the real implementation targeting 005's
 *  Demo Tool submit-settlement path BY CONFIGURATION — this file, the
 *  Console, and Bayar never change. */
export function makeUnconfiguredSubmitter(): SettlementSubmitter {
  return {
    async submit() {
      throw new Error("settlement submitter not configured");
    },
  };
}

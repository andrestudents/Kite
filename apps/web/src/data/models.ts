// T008 — the screen models (data-model §2): the ONLY shapes screens consume.
// Money is bigint AUSD base units; display strings are computed at render
// (lib/money), never stored here. Every top-level model carries fetchedAt for
// snapshots/stale labels. `status` stays the contract's machine value — the
// app never derives state the contract owns (data-model §5).
import type { IsaStatusCode } from "../chain/client.js";

/** The four elements every deal surface must render (FR-004) plus the live
 *  numbers; `label` is the backer-side nickname overlay (FR-017), `purpose`
 *  rides device-local records / the share link (never onchain). */
export interface DealCardModel {
  isaId: number;
  seeker: string;
  counterparty: string;
  principalAusd: bigint;
  shareBps: number;
  capMult: number;
  capAusd: bigint;
  remainingAusd: bigint;
  progressBps: number;
  termEnd: number;
  status: IsaStatusCode;
  label?: string;
  purpose?: string;
  /** Per-panen rows as carried by the public profile surface (T015); the
   *  seeker's own detail view builds its rows through dealDetailFromProfile. */
  panen?: PanenRow[];
  fetchedAt: number;
}

/** One per-panen row (005 profile events, verbatim). */
export interface PanenRow {
  grossAusd: bigint;
  toSeekerAusd: bigint;
  toBackerAusd: bigint;
  remainingAfterAusd: bigint;
  txHash: string;
  blockTime: string;
}

/** Device-local send record (§3 sentRecords) — feeds Riwayat. */
export interface SendRecord {
  to: string;
  valueAusd: bigint;
  at: number;
  txHash?: string;
}

export interface HomeModel {
  saldoAusd: bigint;
  deal: DealCardModel | null;
  reputation: {
    score: number;
    completed: number;
    consistentPanen: number;
    distinctBackers: number;
    maxSupportAusd: bigint;
  };
  empty: boolean;
  fetchedAt: number;
}

export interface DealDetailModel {
  card: DealCardModel;
  panen: PanenRow[];
  fetchedAt: number;
}

export interface ProfileModel {
  id: string;
  wallet: string;
  stars: number;
  completedDeals: number;
  qualEvents: number;
  openRequest: DealCardModel | null;
  deals: DealCardModel[];
  explorerBaseUrl: string;
  fetchedAt: number;
}

export type RiwayatRow =
  | { kind: "income"; isaId: number; panen: PanenRow }
  | { kind: "send"; send: SendRecord }
  | { kind: "complete"; card: DealCardModel };

export interface RiwayatModel {
  rows: RiwayatRow[];
  fetchedAt: number;
}

export interface DukungFlowModel {
  seeker: ProfileModel;
  maxSupportAusd: bigint;
  amountAusd: bigint | null;
  purpose?: string;
  agreementText: string;
  nicknameDraft: string;
  checkState: "ok" | "over-limit" | "not-draftable" | "checking";
  fetchedAt: number;
}

/** The Ajukan flow (FR-006): live guidance + the draft broadcast. Guidance
 *  numbers come from the contract's rule through data/draft — never invented.
 *  `drip-exhausted` is the FIRST-CLASS error (FR-006); `done` carries the
 *  shareable deep link. */
export interface AjukanModel {
  backer: string | null;
  amountAusd: bigint | null;
  purpose: string;
  score: number;
  offerAusd: bigint;
  shareBps: number;
  capAusd: bigint | null;
  state:
    | "draft"
    | "checking"
    | "over-limit"
    | "signing"
    | "submitted"
    | "done"
    | "drip-exhausted"
    | "error";
  isaId: number | null;
  shareLink: string | null;
  fetchedAt: number;
}

export interface KirimModel {
  recipient: { kind: "code" | "manual"; wallet: string };
  amountAusd: bigint;
  quoteSnapshot: { rate: number; scale: number };
  balanceAusd: bigint;
  state: "draft" | "signing" | "submitted" | "confirmed" | "insufficient" | "offline";
  fetchedAt: number;
}

export interface MomentModel {
  grossAusd: bigint;
  toSeekerAusd: bigint;
  toBackerAusd: bigint;
  progressBeforeBps: number;
  progressAfterBps: number;
  remainingAfterAusd: bigint;
  fetchedAt: number;
}

export interface FinishModel {
  card: DealCardModel;
  panenCount: number;
  durationDays: number;
  totalDivertedAusd: bigint;
  repBefore: number;
  repAfter: number;
  nextOfferAusd: bigint;
  entry: "live" | "replay";
  variant: "capped" | "term";
  backerTotalReceivedAusd?: bigint;
  fetchedAt: number;
}

export interface PurchaseRow {
  id: string;
  channelId: number;
  isaId: number;
  purchaseRef: string;
  grossAusd: bigint;
  status: string;
  txHash?: string;
  createdAt: string;
  settledAt?: string;
  kiteRow: boolean;
}

export interface ConsoleModel {
  purchases: PurchaseRow[];
  splitPreview: { gross: bigint; toSeeker: bigint; toBacker: bigint };
  settlementSeam: "demo-tool";
  fetchedAt: number;
}

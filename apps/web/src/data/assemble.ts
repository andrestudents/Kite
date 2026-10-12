// T008 — the assemblers: wire shapes (005 API, contract reads) in, screen
// models out. This is the ONLY place money becomes bigint — integral JSON
// numbers are guarded, never floats (constitution VI) — and the only place
// the machine status is interpreted into model shapes. Indexer-ready: when
// Envio replaces a source (later feature), only this file changes.

import type { MeDto, ProfileDealDto, ProfileDto } from "../api/client.js";
import type { IsaStatusCode } from "../chain/client.js";
import type {
  DealCardModel,
  DealDetailModel,
  HomeModel,
  MomentModel,
  PanenRow,
  ProfileModel,
  RiwayatModel,
  RiwayatRow,
  SendRecord,
} from "./models.js";

function asInt(n: number, what: string): bigint {
  if (!Number.isInteger(n)) {
    throw new Error(`${what} must be an integral base-unit number, got ${String(n)}`);
  }
  return BigInt(n);
}

/** The wire spells statuses as names (005's ISA_STATUS_BY_CODE); the app
 *  thinks in the CONTRACT's machine values (modules/ISA.sol) — this seam is
 *  the only translator. Unknown names collapse to 0 (None), never invented. */
const STATUS_BY_NAME: Record<string, IsaStatusCode> = {
  drafted: 1,
  active: 2,
  completed_capped: 3,
  completed_at_term: 4,
  cancelled: 5,
};

export function statusFromName(name: string): IsaStatusCode {
  return STATUS_BY_NAME[name] ?? 0;
}

/** A seeker's active deal from /api/me (the caller's own surface — it IS the
 *  Active ISA, so the machine status is 2 by construction, not derived). */
export function dealCardFromMe(me: MeDto, fetchedAt: number): DealCardModel | null {
  const isa = me.activeIsa;
  if (isa === null) return null;
  return {
    isaId: isa.isaId,
    seeker: me.wallet,
    counterparty: isa.backer,
    principalAusd: asInt(isa.principalAusd, "principalAusd"),
    shareBps: isa.shareBps,
    capMult: isa.capMult,
    capAusd: asInt(isa.capAusd, "capAusd"),
    remainingAusd: asInt(isa.remainingAusd, "remainingAusd"),
    progressBps: isa.progressBps,
    termEnd: isa.termEnd,
    status: 2,
    fetchedAt,
  };
}

function panenRows(events: ProfileDealDto["events"]): PanenRow[] {
  const rows = events.map((e) => ({
    grossAusd: asInt(e.grossAusd, "grossAusd"),
    toSeekerAusd: asInt(e.toSeekerAusd, "toSeekerAusd"),
    toBackerAusd: asInt(e.toBackerAusd, "toBackerAusd"),
    remainingAfterAusd: asInt(e.remainingAusd, "remainingAusd"),
    txHash: e.txHash,
    blockTime: e.blockTime,
  }));
  // Latest first (data-model §2) — ISO timestamps sort lexically.
  return rows.sort((a, b) => (a.blockTime < b.blockTime ? 1 : -1));
}

function dealCardFromProfileDeal(
  deal: ProfileDealDto,
  seeker: string,
  status: IsaStatusCode,
  fetchedAt: number,
): DealCardModel {
  const cap = asInt(deal.capAusd, "capAusd");
  const diverted = asInt(deal.totalDivertedAusd, "totalDivertedAusd");
  // The public DTO carries cap + total diverted — remaining/progress derive
  // from those two contract-owned numbers (never from anything else).
  const remaining = diverted > cap ? 0n : cap - diverted;
  const progressBps = deal.capAusd > 0 ? Number((diverted * 10_000n) / cap) : 0;
  // termEnd is not on the public surface — the profile screen enriches it
  // with a live isaOf read through data/ (T015); 0 means "unknown here".
  return {
    isaId: deal.isaId,
    seeker,
    counterparty: "",
    principalAusd: asInt(deal.principalAusd, "principalAusd"),
    shareBps: deal.shareBps,
    capMult: 0,
    capAusd: cap,
    remainingAusd: remaining,
    progressBps,
    termEnd: 0,
    status,
    panen: panenRows(deal.events),
    fetchedAt,
  };
}

/** The public profile → ProfileModel (FR-019): stars, counts, the open
 *  request (Drafted deal) pulled out prominently, history with collapsed
 *  per-deal panen rows. No name, no documents — the identity IS this. */
export function profileFromDto(dto: ProfileDto, fetchedAt: number): ProfileModel {
  const deals = dto.deals.map((d) =>
    dealCardFromProfileDeal(d, dto.wallet, statusFromName(d.status), fetchedAt),
  );
  const openRequest = deals.find((d) => d.status === 1) ?? null;
  return {
    id: dto.id,
    wallet: dto.wallet,
    stars: Math.min(5, Math.round(dto.reputation.score / 20)),
    completedDeals: dto.reputation.completedDeals,
    qualEvents: dto.reputation.qualEvents,
    openRequest,
    deals,
    explorerBaseUrl: dto.explorerBaseUrl,
    fetchedAt,
  };
}

/** One deal's detail: its card + the per-panen history (FR-014). */
export function dealDetailFromProfile(
  dto: ProfileDto,
  isaId: number,
  fetchedAt: number,
): DealDetailModel {
  const deal = dto.deals.find((d) => d.isaId === isaId);
  if (!deal) throw new Error(`isa ${String(isaId)} not found on the public profile`);
  const card = dealCardFromProfileDeal(deal, dto.wallet, statusFromName(deal.status), fetchedAt);
  card.seeker = dto.wallet;
  return { card, panen: panenRows(deal.events), fetchedAt };
}

/** Riwayat (FR-015): ONE merged latest-first feed assembled INSIDE the seam —
 *  income rows and completions from the public profile's settlement events,
 *  sends from the device-local store. Timestamps normalize to epoch ms for
 *  the sort; the row shapes themselves never carry a derived clock. */
export function riwayatFrom(dto: ProfileDto, sends: SendRecord[], fetchedAt: number): RiwayatModel {
  const stamped: Array<{ at: number; row: RiwayatRow }> = [];
  for (const d of dto.deals) {
    const status = statusFromName(d.status);
    for (const panen of panenRows(d.events)) {
      stamped.push({
        at: Date.parse(panen.blockTime) || 0,
        row: { kind: "income", isaId: d.isaId, panen },
      });
    }
    if (status === 3 || status === 4) {
      const lastEvent = d.events.reduce((acc, e) => Math.max(acc, Date.parse(e.blockTime) || 0), 0);
      stamped.push({
        at: lastEvent,
        row: {
          kind: "complete",
          card: dealCardFromProfileDeal(d, dto.wallet, status, fetchedAt),
        },
      });
    }
  }
  for (const s of sends) {
    stamped.push({ at: s.at, row: { kind: "send", send: s } });
  }
  stamped.sort((a, b) => b.at - a.at);
  return { rows: stamped.map((s) => s.row), fetchedAt };
}

/** Beranda (FR-013): saldo, the active card, the reputation row with its
 *  why-inputs (FR-005). `empty` is honest — no fake cards. */
export function homeFromMe(me: MeDto, fetchedAt: number): HomeModel {
  return {
    saldoAusd: asInt(me.balanceAusd, "balanceAusd"),
    deal: dealCardFromMe(me, fetchedAt),
    reputation: {
      score: me.profile.score,
      completed: me.profile.completed,
      consistentPanen: me.profile.qualEvents,
      distinctBackers: me.profile.distinctBackers,
      maxSupportAusd: asInt(me.profile.maxSupportAusd, "maxSupportAusd"),
    },
    empty: me.activeIsa === null,
    fetchedAt,
  };
}

/** The watcher's split event → the full-screen moment's numbers (FR-009):
 *  the NEWEST panen row of the deal that moved carries the settlement's own
 *  figures; the progress jump is the watcher's watermark delta. Null when
 *  the surface has no events — a split is never invented. */
export function momentFromProfile(
  dto: ProfileDto,
  isaId: number,
  progressBeforeBps: number,
  progressAfterBps: number,
  fetchedAt: number,
): MomentModel | null {
  const deal = dto.deals.find((d) => d.isaId === isaId);
  if (deal === undefined) return null;
  const newest = panenRows(deal.events)[0];
  if (newest === undefined) return null;
  return {
    grossAusd: newest.grossAusd,
    toSeekerAusd: newest.toSeekerAusd,
    toBackerAusd: newest.toBackerAusd,
    progressBeforeBps,
    progressAfterBps,
    remainingAfterAusd: newest.remainingAfterAusd,
    fetchedAt,
  };
}

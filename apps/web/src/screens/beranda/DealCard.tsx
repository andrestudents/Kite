// T018 — the ONE deal card (FR-004): every deal surface — Beranda's active
// card today, any future surface — leans on this component so the four
// elements can never drift apart: (1) the supporter's share %, (2) the cap,
// (3) the failed-harvest line, (4) the end condition. Above them: live
// progress (integer bps → whole %), the remaining amount, the machine status
// label, and the partner (short-form address — never a fabricated name).
// Catalog copy only; numbers integer end-to-end.
import type { DealCardModel } from "../../data/models.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { statusLabel } from "../profile/PublicProfile.js";
import { pctLabel } from "./Ajukan.js";

/** Short address form for tight rows — a value, never prose. */
export function shortAddress(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Element 4 — the end condition. A finished-at-term deal names its day;
 *  everything else ends when the cap is reached. */
export function DealEnd(props: { card: DealCardModel; locale: Locale }) {
  const { card, locale } = props;
  if (card.status === 4 && card.termEnd > 0) {
    const day = new Date(card.termEnd * 1000).toISOString().slice(0, 10);
    return (
      <p className="text-xs text-slate-500">
        {locale.dealCard.endLabel} {locale.dealCard.endByTerm} {day}
      </p>
    );
  }
  return (
    <p className="text-xs text-slate-500">
      {locale.dealCard.endLabel} {locale.dealCard.endByCap}
    </p>
  );
}

export function DealCard(props: {
  card: DealCardModel;
  locale: Locale;
  lang?: MoneyLocale;
  onOpen?(): void;
}) {
  const { card, locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const progressPct = Math.floor(card.progressBps / 100);
  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-500">{locale.home.activeDealTitle}</p>
        <span className="text-xs text-slate-500">{statusLabel(card.status, locale)}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-lg font-semibold text-slate-800">
          {locale.home.remainingLabel} {formatAusdDetail(card.remainingAusd, lang)}
        </span>
        <span className="text-sm text-slate-500">{progressPct}%</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-teal-600"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {locale.ajukan.backerLabel} {shortAddress(card.counterparty)}
      </p>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-600">
          {locale.dealCard.shareLabel} {pctLabel(card.shareBps, lang)}
        </span>
        <span className="text-slate-600">
          {locale.dealCard.capLabel} {formatAusdDetail(card.capAusd, lang)}
        </span>
      </div>
      <div className="mt-1">
        <DealEnd card={card} locale={locale} />
      </div>
      <p className="mt-1 text-xs text-slate-600">{locale.dealCard.failedHarvest}</p>
      {props.onOpen ? (
        <button
          type="button"
          onClick={props.onOpen}
          className="mt-3 w-full rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow"
        >
          {locale.detail.title}
        </button>
      ) : null}
    </section>
  );
}

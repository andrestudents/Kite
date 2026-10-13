// T021 — the split moment (FR-009): a harvest settling IS the product's
// heart, so it arrives as a full-screen dark moment on ink green (never
// black), unprompted (the watcher mounts it above everything; dismissing
// restores the prior screen). Every number comes from the MomentModel —
// assembled LIVE from chain/API deltas, never cached literals: the gross
// headline (display-only "≈" IDR when a quote is at hand + the AUSD detail
// row), the proportion bar (the deal's actual split seen before anything is
// read — leaf for the farmer, gold for the supporter), the two split cards,
// the progress jump (before → after) on the ripening fill, and what remains.
import type { MomentModel } from "../../data/models.js";
import type { MoneyLocale } from "../../lib/money.js";
import { formatAusdDetail, formatGrouped, toDisplayUnits } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";

export type Quote = { pair: string; rate: number; scale: number };

function pctOf(bps: number): number {
  return Math.floor(bps / 100);
}

export function SplitMoment(props: {
  moment: MomentModel;
  locale: Locale;
  lang?: MoneyLocale;
  quote?: Quote | null;
  onDismiss(): void;
}) {
  const { moment, locale, quote } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const hasQuote = quote !== null && quote !== undefined;
  const idrOf = (base: bigint): string | null =>
    hasQuote
      ? `${locale.home.idrPrefix} ${formatGrouped(toDisplayUnits(Number(base), quote))}`
      : null;
  const idrHeadline = hasQuote
    ? `${locale.home.idrPrefix} ${locale.home.approx} ${formatGrouped(
        toDisplayUnits(Number(moment.grossAusd), quote),
      )}`
    : null;
  // The proportion bar shows THIS settlement's real split — the share of the
  // payout that went to each side, not the deal's nominal shareBps.
  const total = moment.toSeekerAusd + moment.toBackerAusd;
  const seekPct = total > 0n ? Number((moment.toSeekerAusd * 100n) / total) : 50;
  const afterPct = pctOf(moment.progressAfterBps);
  const seekIdr = idrOf(moment.toSeekerAusd);
  const backIdr = idrOf(moment.toBackerAusd);
  return (
    <div className="fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center gap-5 bg-ink px-6 text-center text-[#F2F6EF]">
      <p className="text-sm font-extrabold text-goldhi">{locale.moments.splitTitle}</p>
      <div>
        {idrHeadline !== null ? (
          <p className="text-4xl font-extrabold tracking-tight text-white">{idrHeadline}</p>
        ) : null}
        <p
          className={
            idrHeadline !== null
              ? "mt-1 text-sm text-[#F2F6EF]/70"
              : "text-3xl font-extrabold text-white"
          }
        >
          {locale.detail.grossLabel} {formatAusdDetail(moment.grossAusd, lang)}
        </p>
      </div>
      <div aria-hidden="true" className="flex h-3.5 w-full max-w-sm overflow-hidden rounded-full">
        <div className="bg-[#3F9A5C]" style={{ width: `${seekPct}%` }} />
        <div className="flex-1 bg-gold" />
      </div>
      <div className="flex w-full max-w-sm gap-3">
        <div className="flex-1 rounded-2xl border border-[#2C5A40] bg-nightseek p-4 text-left">
          <p className="text-xs text-[#F2F6EF]/70">{locale.moments.toYouLabel}</p>
          <p className="mt-1 text-xl font-extrabold text-[#9FE0B0]">
            {formatAusdDetail(moment.toSeekerAusd, lang)}
          </p>
          {seekIdr !== null ? <p className="mt-0.5 text-xs text-[#F2F6EF]/60">{seekIdr}</p> : null}
        </div>
        <div className="flex-1 rounded-2xl border border-[#55491F] bg-nightback p-4 text-left">
          <p className="text-xs text-[#F2F6EF]/70">{locale.moments.toBackerLabel}</p>
          <p className="mt-1 text-xl font-extrabold text-goldhi">
            {formatAusdDetail(moment.toBackerAusd, lang)}
          </p>
          {backIdr !== null ? <p className="mt-0.5 text-xs text-[#F2F6EF]/60">{backIdr}</p> : null}
        </div>
      </div>
      <div className="w-full max-w-sm">
        <p className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="text-[#F2F6EF]/70">{locale.dealCard.progressLabel}</span>
          <span className="font-bold text-white">
            {pctOf(moment.progressBeforeBps)}% → {pctOf(moment.progressAfterBps)}%
          </span>
        </p>
        <div className="h-2.5 rounded-full bg-night">
          <div
            className="ripen h-2.5 rounded-full"
            style={{ width: `${Math.min(100, afterPct)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[#F2F6EF]/60">
          {locale.home.remainingLabel} {formatAusdDetail(moment.remainingAfterAusd, lang)}
        </p>
      </div>
      <button
        type="button"
        onClick={props.onDismiss}
        className="w-full max-w-sm rounded-xl bg-gold px-6 py-3.5 text-lg font-bold text-ink shadow"
      >
        {locale.common.continue}
      </button>
    </div>
  );
}

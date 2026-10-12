// T021 — the split moment (FR-009): a harvest settling IS the product's
// heart, so it arrives as a full-screen dark moment, unprompted (the watcher
// mounts it above everything; dismissing restores the prior screen). Every
// number comes from the MomentModel — assembled LIVE from chain/API deltas,
// never cached literals: the gross headline (display-only "≈" IDR when a
// quote is at hand + the AUSD detail row), the two split cards, the progress
// jump (before → after), and what remains of the deal.
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
  const idrHeadline =
    quote !== null && quote !== undefined
      ? `${locale.home.idrPrefix} ${locale.home.approx} ${formatGrouped(
          toDisplayUnits(Number(moment.grossAusd), quote),
        )}`
      : null;
  return (
    <div className="fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center gap-5 bg-slate-900/95 px-6 text-center">
      <p className="text-sm font-semibold tracking-wide text-teal-300">
        {locale.moments.splitTitle}
      </p>
      <div>
        {idrHeadline !== null ? (
          <p className="text-4xl font-bold text-white">{idrHeadline}</p>
        ) : null}
        <p
          className={
            idrHeadline !== null ? "mt-1 text-sm text-teal-200" : "text-3xl font-bold text-white"
          }
        >
          {locale.detail.grossLabel} {formatAusdDetail(moment.grossAusd, lang)}
        </p>
      </div>
      <div className="flex w-full max-w-sm gap-3">
        <div className="flex-1 rounded-2xl bg-slate-800 p-4">
          <p className="text-xs text-slate-400">{locale.moments.toYouLabel}</p>
          <p className="mt-1 text-xl font-bold text-teal-300">
            {formatAusdDetail(moment.toSeekerAusd, lang)}
          </p>
        </div>
        <div className="flex-1 rounded-2xl bg-slate-800 p-4">
          <p className="text-xs text-slate-400">{locale.moments.toBackerLabel}</p>
          <p className="mt-1 text-xl font-bold text-teal-300">
            {formatAusdDetail(moment.toBackerAusd, lang)}
          </p>
        </div>
      </div>
      <p className="text-sm text-slate-300">
        {locale.dealCard.progressLabel} {pctOf(moment.progressBeforeBps)}% →{" "}
        {pctOf(moment.progressAfterBps)}%
      </p>
      <p className="text-xs text-slate-400">
        {locale.home.remainingLabel} {formatAusdDetail(moment.remainingAfterAusd, lang)}
      </p>
      <button
        type="button"
        onClick={props.onDismiss}
        className="mt-2 w-full max-w-sm rounded-xl bg-teal-500 px-6 py-3 text-lg font-semibold text-slate-900 shadow"
      >
        {locale.common.continue}
      </button>
    </div>
  );
}

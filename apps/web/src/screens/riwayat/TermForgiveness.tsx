// T024 — the term variant's face: the season ended with the target unmet, and
// the rest is FORGIVEN — this is the not-a-bond disclosure given dignity. No
// confetti, no party colors: a quiet slate card that still shows the honest
// chain-derived recap (what came back, from what target, over how many
// panen and days). "kembali dari target · sisanya dimaafkan" — the copy
// family from the catalog, subdued and visually distinct from the capped
// celebration.
import type { FinishModel } from "../../data/models.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";

export function TermForgiveness(props: {
  model: FinishModel;
  locale: Locale;
  lang?: MoneyLocale;
  onClose?(): void;
}) {
  const { model, locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const day =
    model.card.termEnd > 0 ? new Date(model.card.termEnd * 1000).toISOString().slice(0, 10) : "";
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-300 bg-slate-50 p-6 text-center">
      <p className="text-sm font-semibold text-slate-500">{locale.moments.finishTitle}</p>
      <p className="mt-1 text-base text-slate-700">{locale.moments.forgiveBanner}</p>
      <p className="mt-3 text-2xl font-bold text-slate-800">
        {formatAusdDetail(model.totalDivertedAusd, lang)}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {formatAusdDetail(model.totalDivertedAusd, lang)} {locale.dukung.recapBack}{" "}
        {formatAusdDetail(model.card.capAusd, lang)} · {locale.dukung.recapForgiven}
      </p>
      <div className="mt-4 rounded-xl bg-white p-3 text-left text-sm text-slate-600">
        <div className="flex items-baseline justify-between">
          <span>{locale.moments.seasonPanen}</span>
          <span className="font-semibold text-slate-800">{String(model.panenCount)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span>{locale.moments.seasonDuration}</span>
          <span className="font-semibold text-slate-800">{String(model.durationDays)}</span>
        </div>
        {day !== "" ? (
          <div className="mt-1 flex items-baseline justify-between">
            <span>{locale.dealCard.endLabel}</span>
            <span className="font-semibold text-slate-800">{day}</span>
          </div>
        ) : null}
      </div>
      {props.onClose ? (
        <button
          type="button"
          onClick={props.onClose}
          className="mt-4 w-full rounded-xl bg-slate-700 px-6 py-3 text-base font-semibold text-white shadow"
        >
          {locale.common.continue}
        </button>
      ) : null}
    </div>
  );
}

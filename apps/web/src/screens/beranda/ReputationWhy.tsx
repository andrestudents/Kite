// T027 — the reputation row's why (FR-005): no bare unexplained number. The
// score is never shown alone — its live inputs (completed agreements,
// consistent harvests, distinct supporters) stand beside it in plain words,
// read straight from /api/me's profile fields through HomeModel. Nothing is
// computed here; the contract owns the score, this only names its inputs.
import type { HomeModel } from "../../data/models.js";
import type { Locale } from "../../locales/id.js";

export function ReputationWhy(props: { reputation: HomeModel["reputation"]; locale: Locale }) {
  const { locale, reputation } = props;
  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-500">{locale.home.scoreTitle}</p>
        <span className="text-xs text-slate-500">{locale.rep.title}</span>
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-800">{reputation.score}</p>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-600">
        <li>
          {reputation.completed} {locale.rep.completedLabel}
        </li>
        <li>
          {reputation.consistentPanen} {locale.rep.consistentLabel}
        </li>
        <li>
          {reputation.distinctBackers} {locale.rep.backersLabel}
        </li>
      </ul>
      <p className="mt-2 text-xs text-slate-500">{locale.rep.hint}</p>
    </section>
  );
}

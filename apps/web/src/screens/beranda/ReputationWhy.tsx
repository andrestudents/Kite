// T027 — the reputation row's why (FR-005): no bare unexplained number. The
// score is never shown alone — it ripens in a ring (the same gradient as
// every progress bar: light young green to padi gold as the record fills)
// with its live inputs (completed agreements, consistent harvests, distinct
// supporters) beside it in plain words, read straight from /api/me's profile
// fields through HomeModel. Nothing is computed here; the contract owns the
// score, this only names its inputs.
import { useId } from "react";
import type { HomeModel } from "../../data/models.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export function ReputationWhy(props: {
  reputation: HomeModel["reputation"];
  locale: Locale;
  lang?: MoneyLocale;
}) {
  const { locale, reputation } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const gradientId = useId();
  const score = Math.max(0, Math.min(100, reputation.score));
  const filled = (RING_C * score) / 100;
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">{locale.home.scoreTitle}</p>
        <span className="text-xs text-muted">{locale.rep.title}</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7CC08F" />
                <stop offset="0.55" stopColor="#2E7D46" />
                <stop offset="0.82" stopColor="#C98F1B" />
                <stop offset="1" stopColor="#E3A72F" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r={RING_R} fill="none" stroke="#E4EBDF" strokeWidth="7" />
            {score > 0 ? (
              <circle
                cx="32"
                cy="32"
                r={RING_R}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${RING_C - filled}`}
                transform="rotate(-90 32 32)"
              />
            ) : null}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-ink">
            {reputation.score}
          </span>
        </div>
        <ul className="flex flex-col gap-1 text-sm text-muted">
          <li>
            <b className="font-bold text-ink">{reputation.completed}</b> {locale.rep.completedLabel}
          </li>
          <li>
            <b className="font-bold text-ink">{reputation.consistentPanen}</b>{" "}
            {locale.rep.consistentLabel}
          </li>
          <li>
            <b className="font-bold text-ink">{reputation.distinctBackers}</b>{" "}
            {locale.rep.backersLabel}
          </li>
        </ul>
      </div>
      <p className="mt-3 text-xs italic text-muted">{locale.rep.hint}</p>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-sm text-muted">{locale.home.maxSupportLabel}</span>
        <span className="text-sm font-bold text-ink">
          {formatAusdDetail(reputation.maxSupportAusd, lang)}
        </span>
      </div>
    </section>
  );
}

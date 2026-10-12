// T022 — the backer's quiet moments (research D9): income and completion
// arrive as toasts riding ONE mechanism — the same stack, no new notification
// machinery. The watcher (T020) already dedupes through watermarks, so a
// toast is a 1:1 projection of a WatchEvent: the income card shows the
// wallet delta (split figures when the isaOf read landed in the same pass —
// the progress jump), the capped completion celebrates ("Bagi hasil selesai
// — Lunas 🎉"), and the term variant closes plainly — dignity, no party.

import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import type { WatchEvent } from "../../watcher/watcher.js";

export interface Toast {
  /** Derived from the event — the same event can never stack twice. */
  id: string;
  kind: "income" | "capped" | "term" | "verify";
  /** The wallet delta (income only; bigint base units). */
  deltaAusd?: bigint;
  /** The progress jump when the isaOf read landed in the same pass. */
  progressBeforeBps?: number;
  progressAfterBps?: number;
}

/** WatchEvent → toasts. Seeker-side moments have their own full screens
 *  (T021/T024) — only the BACKER's quiet moments land here. */
export function watchEventToasts(events: WatchEvent[]): Toast[] {
  const out: Toast[] = [];
  for (const e of events) {
    if (e.side !== "backer") continue;
    if (e.kind === "split") {
      out.push({
        id: `income-${String(e.isaId)}-${String(e.deltaCount)}-${String(e.progressAfterBps)}`,
        kind: "income",
        ...(e.balanceDeltaAusd !== undefined ? { deltaAusd: e.balanceDeltaAusd } : {}),
        progressBeforeBps: e.progressBeforeBps,
        progressAfterBps: e.progressAfterBps,
      });
    } else {
      out.push({ id: `done-${String(e.isaId)}-${e.variant}`, kind: e.variant });
    }
  }
  return out;
}

function pctOf(bps: number | undefined): number | null {
  return typeof bps === "number" ? Math.floor(bps / 100) : null;
}

export function ToastStack(props: {
  toasts: Toast[];
  locale: Locale;
  lang?: MoneyLocale;
  onDismiss(id: string): void;
}) {
  const { locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  if (props.toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-md flex-col gap-2 px-6">
      {props.toasts.map((t) => (
        <div
          key={t.id}
          className={
            t.kind === "income"
              ? "rounded-2xl bg-slate-900/95 p-4 text-left shadow-lg"
              : t.kind === "capped"
                ? "rounded-2xl bg-teal-600 p-4 text-left text-white shadow-lg"
                : t.kind === "verify"
                  ? "rounded-2xl bg-amber-100 p-4 text-left text-amber-900 shadow-lg"
                  : "rounded-2xl bg-slate-200 p-4 text-left text-slate-700 shadow-lg"
          }
        >
          {t.kind === "income" ? (
            <>
              <p className="text-sm text-slate-300">{locale.moments.splitTitle}</p>
              <div className="flex items-baseline justify-between">
                <p className="text-xl font-bold text-teal-300">
                  {t.deltaAusd !== undefined
                    ? `+${formatAusdDetail(t.deltaAusd, lang)}`
                    : locale.moments.splitTitle}
                </p>
                {pctOf(t.progressBeforeBps) !== null &&
                pctOf(t.progressAfterBps) !== null &&
                t.progressBeforeBps !== undefined &&
                t.progressAfterBps !== undefined ? (
                  <p className="text-xs text-slate-400">
                    {locale.dealCard.progressLabel} {pctOf(t.progressBeforeBps)}% →{" "}
                    {pctOf(t.progressAfterBps)}%
                  </p>
                ) : null}
              </div>
            </>
          ) : t.kind === "verify" ? (
            <p className="text-sm font-semibold">{locale.verifyRequired.toast}</p>
          ) : (
            <p className="text-sm font-semibold">
              {t.kind === "capped" ? locale.dukung.toastCompleted : locale.moments.forgiveBanner}
            </p>
          )}
          <button
            type="button"
            onClick={() => props.onDismiss(t.id)}
            className="mt-2 text-xs underline opacity-70"
          >
            {locale.common.continue}
          </button>
        </div>
      ))}
    </div>
  );
}

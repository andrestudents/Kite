// T009 — the four edge states every screen reuses (FR-020): loading skeleton,
// honest empty, offline (read-only last-known state, stale-labeled with its
// data time, actions disabled — no optimistic money writes, constitution IV),
// and error (Bahasa, actionable, retry-safe). Every string from the catalogs.
import type { Locale } from "../../locales/id.js";

/** The stale label's clock: Indonesian convention "HH.MM" (dot separator). */
export function formatClock(at: Date | number | string): string {
  const d = at instanceof Date ? at : new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}.${mm}`;
}

/** Shimmer bars — never a spinner as a dead end (FR-020). */
export function LoadingSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-md animate-pulse flex-col gap-4 px-6 py-10"
      aria-hidden
    >
      <div className="h-8 w-1/3 rounded-lg bg-[#E7ECE3]" />
      <div className="h-28 rounded-2xl bg-[#E7ECE3]" />
      <div className="h-20 rounded-2xl bg-[#E7ECE3]" />
      <div className="h-20 rounded-2xl bg-[#E7ECE3]" />
    </div>
  );
}

/** Honest empty: says what is missing, offers the one action (or nothing). */
export function EmptyState(props: {
  locale: Locale;
  message: string;
  ctaLabel?: string;
  onCta?(): void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-14 text-center">
      <p className="text-sm text-muted">{props.message}</p>
      {props.ctaLabel && props.onCta ? (
        <button
          type="button"
          onClick={props.onCta}
          className="rounded-xl bg-leaf px-6 py-3 font-semibold text-white shadow"
        >
          {props.ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Offline: shell + last-known data, labeled with its time, read-only. The
 *  children render the snapshot; the caller keeps ALL actions disabled. */
export function OfflineState(props: {
  locale: Locale;
  fetchedAt: Date | number | string;
  children?: React.ReactNode;
}) {
  const { locale } = props;
  return (
    <div className="mx-auto w-full max-w-md px-6 py-10">
      <div className="mb-4 rounded-xl border border-warnline bg-warnsoft p-4">
        <p className="font-bold text-ink">{locale.edge.offlineTitle}</p>
        <p className="mt-1 text-sm text-golddk">{locale.edge.offlineBody}</p>
        <p className="mt-2 text-xs font-semibold text-golddk">
          {locale.edge.stalePrefix} {formatClock(props.fetchedAt)}
        </p>
      </div>
      <div aria-disabled className="pointer-events-none select-none opacity-60">
        {props.children}
      </div>
    </div>
  );
}

/** Error: plain language + one retry — never an English-only dump. */
export function ErrorState(props: { locale: Locale; message?: string; onRetry?(): void }) {
  const { locale } = props;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-14 text-center">
      <p className="font-bold text-ink">{locale.edge.errorTitle}</p>
      {props.message ? <p className="text-sm text-muted">{props.message}</p> : null}
      {props.onRetry ? (
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-xl border border-line2 bg-white px-6 py-3 font-semibold text-ink shadow"
        >
          {locale.edge.retry}
        </button>
      ) : null}
    </div>
  );
}

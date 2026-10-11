// T019 — Home (FR-003/FR-006): one merged /api/me render + the locked quote's
// IDR/MYR approximation (constitution VI — integer base units on the wire,
// display-only conversion here via lib/money). Actions are enabled only when
// BOTH verification read-backs are green — /api/me carries identityBound, the
// drips lock comes from the verification read-back (FR-006). Zero crypto
// vocabulary in any rendered string.
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, MeDto } from "../api/client.js";
import { formatAusd, formatGrouped, toDisplayUnits } from "../lib/money.js";
import type { Locale } from "../locales/id.js";

type Quote = { pair: string; rate: number; scale: number };

export function Home(props: {
  locale: Locale;
  api: ApiClient;
  onSignOut(): void;
  onNeedVerification(): void;
}) {
  const { locale, api } = props;
  const [me, setMe] = useState<MeDto | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [dripped, setDripped] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meDto, q, verification] = await Promise.all([
        api.me(),
        api.quote("USD_IDR"),
        api.verificationGet(),
      ]);
      setMe(meDto);
      setQuote(q);
      setDripped(verification.dripped);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setMe(null);
            void load();
          }}
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.common.retry}
        </button>
      </main>
    );
  }

  if (!me || !quote || dripped === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.home.preparing}
      </main>
    );
  }

  const ready = me.identityBound && dripped;
  const displayIdr = (base: number) =>
    `${locale.home.idrPrefix} ${formatGrouped(toDisplayUnits(base, quote))}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-teal-700">{locale.home.greeting}</h1>
        <button
          type="button"
          onClick={props.onSignOut}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600"
        >
          {locale.session.signOut}
        </button>
      </div>

      <section className="rounded-2xl bg-teal-50 p-5">
        <p className="text-sm text-teal-800">{locale.home.balanceTitle}</p>
        <p className="mt-1 text-4xl font-bold text-teal-900">
          {locale.home.approx} {displayIdr(me.balanceAusd)}
        </p>
        <p className="mt-1 text-xs text-teal-700">{formatAusd(me.balanceAusd)} AUSD</p>
      </section>

      <section className="rounded-2xl border border-slate-200 p-5">
        <p className="text-sm text-slate-500">{locale.home.scoreTitle}</p>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-3xl font-bold text-slate-800">{me.profile.score}</span>
          <span className="text-sm text-slate-500">
            {locale.home.maxSupportLabel} {locale.home.approx}{" "}
            {displayIdr(me.profile.maxSupportAusd)}
          </span>
        </div>
      </section>

      {me.activeIsa ? (
        <section className="rounded-2xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">{locale.home.activeDealTitle}</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-lg font-semibold text-slate-800">
              {locale.home.remainingLabel} {displayIdr(me.activeIsa.remainingAusd)}
            </span>
            <span className="text-sm text-slate-500">{me.activeIsa.progressBps / 100}%</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-teal-600"
              style={{ width: `${Math.min(100, me.activeIsa.progressBps / 100)}%` }}
            />
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
          {locale.home.emptyDeal}
        </section>
      )}

      {!ready ? (
        <button
          type="button"
          onClick={props.onNeedVerification}
          className="rounded-xl bg-amber-500 px-6 py-4 text-lg font-semibold text-white shadow"
        >
          {locale.home.locked}
        </button>
      ) : null}
    </main>
  );
}

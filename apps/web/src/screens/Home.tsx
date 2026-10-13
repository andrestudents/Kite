// T028 — Beranda (FR-013): everything from /api/me through homeFromMe (the
// T008 assembler) — saldo with the FR-003 money rules (rupiah headline "≈"
// at the locked quote, exact AUSD as the detail row), the active deal card
// (T018), the reputation row's why (T027), and honest empty states. The
// quote LOCKS per fetch (display-only, never stored as money) and re-locks
// when it goes stale or the AUSD balance changes under it.
import { useCallback, useEffect, useState } from "react";
import { homeFromMe } from "../data/assemble.js";
import type { ApiClient, MeDto } from "../data/bootstrap.js";
import { formatAusdDetail, formatGrouped, type MoneyLocale, toDisplayUnits } from "../lib/money.js";
import type { Locale } from "../locales/id.js";
import { DealCard } from "./beranda/DealCard.js";
import { ReputationWhy } from "./beranda/ReputationWhy.js";
import { Mark } from "./shell/Mark.js";

type Quote = { pair: string; rate: number; scale: number };

const QUOTE_TTL_MS = 5 * 60 * 1_000;

export function Home(props: {
  locale: Locale;
  lang?: MoneyLocale;
  api: ApiClient;
  onSignOut(): void;
  onNeedVerification(): void;
  onAjukan?(): void;
}) {
  const { locale, api } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const [me, setMe] = useState<MeDto | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteAt, setQuoteAt] = useState(0);
  const [quotedFor, setQuotedFor] = useState<number | null>(null);
  const [dripped, setDripped] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meDto, verification] = await Promise.all([api.me(), api.verificationGet()]);
      setMe(meDto);
      setDripped(verification.dripped);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // The quote lock: fetched once per load window, re-locked when stale or
  // when the balance it was computed against no longer matches (re-confirm).
  const balance = me?.balanceAusd ?? null;
  useEffect(() => {
    if (balance === null) return;
    const fresh = quote !== null && Date.now() - quoteAt < QUOTE_TTL_MS;
    if (fresh && quotedFor === balance) return;
    let alive = true;
    api
      .quote("USD_IDR")
      .then((q) => {
        if (alive) {
          setQuote(q);
          setQuoteAt(Date.now());
          setQuotedFor(balance);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, balance, quote, quoteAt, quotedFor]);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setMe(null);
            void load();
          }}
          className="rounded-xl bg-leaf px-6 py-3 font-semibold text-white shadow"
        >
          {locale.common.retry}
        </button>
      </main>
    );
  }

  if (!me || !quote || dripped === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        {locale.home.preparing}
      </main>
    );
  }

  const model = homeFromMe(me, Date.now());
  const ready = me.identityBound && dripped;
  const displayIdr = (base: bigint) =>
    `${locale.home.idrPrefix} ${formatGrouped(toDisplayUnits(Number(base), quote))}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mark className="h-7 w-6" />
          <span className="text-lg font-extrabold tracking-tight">{locale.appName}</span>
        </div>
        <button
          type="button"
          onClick={props.onSignOut}
          className="px-1 py-1.5 text-sm font-semibold text-muted"
        >
          {locale.session.signOut}
        </button>
      </header>
      <h1 className="-mt-3 text-2xl font-extrabold tracking-tight">{locale.home.greeting}</h1>

      <section className="rounded-2xl bg-deep p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm text-white/75">{locale.home.balanceTitle}</p>
          <Mark variant="gold" className="h-5 w-4" />
        </div>
        <p className="mt-2 text-3xl font-extrabold tracking-tight text-white">
          {locale.home.approx} {displayIdr(model.saldoAusd)}
        </p>
        <p className="mt-1 text-xs font-bold text-goldhi">
          {formatAusdDetail(model.saldoAusd, lang)} AUSD
        </p>
      </section>

      <ReputationWhy reputation={model.reputation} locale={locale} lang={lang} />

      {model.deal !== null ? (
        <DealCard card={model.deal} locale={locale} lang={lang} />
      ) : (
        <section className="rounded-2xl border border-dashed border-line2 bg-white p-5 text-center text-sm text-muted">
          {locale.home.emptyDeal}
          {props.onAjukan ? (
            <button
              type="button"
              onClick={props.onAjukan}
              className="mt-3 w-full rounded-xl bg-leaf px-6 py-3 text-base font-semibold text-white shadow"
            >
              {locale.home.ajukanCta}
            </button>
          ) : null}
        </section>
      )}

      {!ready ? (
        <button
          type="button"
          onClick={props.onNeedVerification}
          className="rounded-xl border border-warnline bg-goldsoft px-6 py-4 text-lg font-semibold text-golddk shadow"
        >
          {locale.home.locked}
        </button>
      ) : null}
    </main>
  );
}

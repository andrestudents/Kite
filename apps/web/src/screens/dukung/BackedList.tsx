// T017 — "Orang yang Kamu Dukung" (FR-004/FR-017): the deals THIS device's
// backer activated, reconciled LIVE. The chain owns every number and the
// status (isaOf / scoreOf / profileOf); the device record only supplies
// discovery (which isaIds) and warmth (the optional nickname + the request's
// purpose). The reputation signal leads each card — stars · completed ·
// progress % — the label is flavor, never the anchor. Terminal deals render
// the Lunas recap from chain numbers alone (received, panen count, duration —
// no cached literals); CompletedAtTerm shows the HONEST partial figures
// ("kembali dari target · sisanya dimaafkan") — the not-a-bond disclosure,
// visually subdued next to the full-settlement celebration. No wire imports —
// data/ only.
import { useCallback, useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import type { BackedRecord } from "../../data/backed.js";
import { derivedLabel, loadBackedRecords } from "../../data/backed.js";
import type { ChainReader, IsaOnChain } from "../../data/draft.js";
import { capOf, chainReader } from "../../data/draft.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import { starsLabel, statusLabel } from "../profile/PublicProfile.js";
import { DukungEntry } from "./DukungEntry.js";

/** One reconciled card: chain state + the device's warmth overlay. */
export interface BackedCard {
  record: BackedRecord;
  isa: IsaOnChain;
  /** nickname when kept, else the derived label — never a fabricated name. */
  label: string;
  stars: number;
  completed: number;
  /** The backer's actual inflow: cap − remaining, floored at zero. */
  receivedAusd: bigint;
  capAusd: bigint;
  progressBps: number;
  durationDays: number;
}

/** The score→stars rule, verbatim from the profile surface (assemble). */
export function starsFromScore(score: number): number {
  return Math.min(5, Math.round(score / 20));
}

/** The backer's received total — from the two contract-owned numbers only. */
export function receivedOf(isa: IsaOnChain): bigint {
  const cap = capOf(isa.principal, isa.capMult);
  return isa.remaining >= cap ? 0n : cap - isa.remaining;
}

export function progressOf(receivedAusd: bigint, capAusd: bigint): number {
  if (capAusd <= 0n) return 0;
  return Number((receivedAusd * 10_000n) / capAusd);
}

/** Season length: a finished deal counts to its last event; a live one to
 *  now. A never-activated record (activatedAt 0) stays at 0 days. */
export function durationDaysOf(isa: IsaOnChain, nowSec: number): number {
  if (isa.activatedAt === 0n) return 0;
  const done = isa.status === 3 || isa.status === 4 || isa.status === 5;
  const end = done ? isa.lastEventAt : BigInt(nowSec);
  if (end <= isa.activatedAt) return 0;
  return Math.floor(Number(end - isa.activatedAt) / 86_400);
}

/** Reputation leads the hierarchy — stars, then completed deals, then live
 *  progress. The label is flavor and never sorts. isaId breaks ties. */
export function rankCards(cards: BackedCard[]): BackedCard[] {
  const rep = (c: BackedCard): number =>
    c.stars * 1_000_000 + c.completed * 1_000 + Math.floor(c.progressBps / 100);
  return [...cards].sort((a, b) => rep(b) - rep(a) || a.record.isaId - b.record.isaId);
}

/** Reconcile every device record against the chain. Any failed read fails
 *  the whole list — a half-truth card would be worse than a retry button. */
export async function loadBackedCards(
  reader: ChainReader,
  records: BackedRecord[],
  nowSec: number,
): Promise<BackedCard[]> {
  const cards = await Promise.all(
    records.map(async (record): Promise<BackedCard> => {
      const isa = await reader.isaOf(BigInt(record.isaId));
      const [score, profile] = await Promise.all([
        reader.scoreOf(isa.seeker),
        reader.profileOf(isa.seeker),
      ]);
      const kept = (record.nickname ?? "").trim();
      const capAusd = capOf(isa.principal, isa.capMult);
      const receivedAusd = receivedOf(isa);
      return {
        record,
        isa,
        label: kept !== "" ? kept.slice(0, 40) : derivedLabel(isa.seeker, record.purpose),
        stars: starsFromScore(score),
        completed: profile.completed,
        receivedAusd,
        capAusd,
        progressBps: progressOf(receivedAusd, capAusd),
        durationDays: durationDaysOf(isa, nowSec),
      };
    }),
  );
  return rankCards(cards);
}

function EndLine(props: { isa: IsaOnChain; locale: Locale }) {
  const { isa, locale } = props;
  if (isa.status === 4) {
    const day = new Date(Number(isa.termEnd) * 1000).toISOString().slice(0, 10);
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

export function BackedCardView(props: {
  card: BackedCard;
  locale: Locale;
  lang: MoneyLocale;
  onDukung?(seeker: string): void;
}) {
  const { card, locale, lang } = props;
  const isa = card.isa;
  const terminal = isa.status === 3 || isa.status === 4;
  const progressPct = Math.floor(card.progressBps / 100);
  const panenCount = Number(isa.eventCount);
  return (
    <section
      className={
        terminal
          ? "rounded-2xl border border-teal-300 bg-teal-50 p-4"
          : "rounded-2xl border border-slate-200 p-4"
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{card.label}</h3>
        <span className="text-xs text-slate-500">{statusLabel(isa.status, locale)}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-teal-700">
        {starsLabel(card.stars)} · {card.completed} {locale.beranda.whyCompleted} · {progressPct}%{" "}
        {locale.dealCard.progressLabel}
      </p>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-sm text-slate-500">{locale.dukung.amountLabel}</span>
        <span className="text-lg font-bold text-slate-900">
          {formatAusdDetail(isa.principal, lang)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">{locale.dealCard.shareLabel}</span>
        <span className="text-slate-800">{pctLabel(isa.shareBps, lang)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">{locale.dealCard.capLabel}</span>
        <span className="text-slate-800">{formatAusdDetail(card.capAusd, lang)}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">{locale.dukung.totalReceived}</span>
        <span className="font-semibold text-slate-800">
          {formatAusdDetail(card.receivedAusd, lang)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full rounded bg-slate-200">
        <div
          className="h-2 rounded bg-teal-600"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-600">{locale.dealCard.failedHarvest}</p>
      <EndLine isa={isa} locale={locale} />
      {terminal ? (
        <>
          <p className="mt-2 text-xs text-slate-500">
            {panenCount} {locale.moments.seasonPanen} · {card.durationDays}{" "}
            {locale.moments.seasonDuration}
          </p>
          {isa.status === 4 ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatAusdDetail(card.receivedAusd, lang)} {locale.dukung.recapBack}{" "}
              {formatAusdDetail(card.capAusd, lang)} · {locale.dukung.recapForgiven}
            </p>
          ) : (
            <p className="mt-1 text-sm font-bold text-teal-700">{locale.dukung.lunasTitle}</p>
          )}
          {props.onDukung ? (
            <>
              <p className="mt-2 text-sm text-slate-600">{locale.dukung.lagi}</p>
              <button
                type="button"
                onClick={() => props.onDukung?.(isa.seeker)}
                className="mt-1 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow"
              >
                {locale.profile.dukungCta}
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function BackedList(props: {
  locale: Locale;
  lang?: MoneyLocale;
  storage: StorageLike;
  /** test seam — the real screen reads through the module reader */
  reader?: ChainReader;
  onDukung?(seeker: string): void;
}) {
  const { locale, storage } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const reader = props.reader ?? chainReader;
  const [cards, setCards] = useState<BackedCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    const records = loadBackedRecords(storage);
    if (records.length === 0) {
      setCards([]);
      setFailed(false);
      return;
    }
    setCards(null);
    setFailed(false);
    const nowSec = Math.floor(Date.now() / 1000);
    loadBackedCards(reader, records, nowSec)
      .then(setCards)
      .catch(() => setFailed(true));
  }, [reader, storage]);

  useEffect(() => {
    load();
  }, [load]);

  if (cards === null) {
    if (failed) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-slate-600">{locale.common.errorGeneric}</p>
          <button
            type="button"
            onClick={load}
            className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
          >
            {locale.common.retry}
          </button>
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
        <p className="text-slate-500">{locale.edge.loading}</p>
      </main>
    );
  }

  if (cards.length === 0) {
    // The entry face (FR-007 step 1): an empty tab is a way IN, never a dead
    // end — the form takes the address or the pasted receive-code link.
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-bold text-teal-700">{locale.dukung.listTitle}</h1>
        <DukungEntry locale={locale} onDukung={props.onDukung} />
      </main>
    );
  }

  const totalReceived = cards.reduce((sum, c) => sum + c.receivedAusd, 0n);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-bold text-teal-700">{locale.dukung.listTitle}</h1>
      <div className="flex items-baseline justify-between rounded-2xl bg-teal-50 p-4">
        <span className="text-sm text-slate-600">{locale.dukung.totalReceived}</span>
        <span className="text-xl font-bold text-teal-700">
          {formatAusdDetail(totalReceived, lang)}
        </span>
      </div>
      {cards.map((card) => (
        <BackedCardView
          key={card.record.isaId}
          card={card}
          locale={locale}
          lang={lang}
          onDukung={props.onDukung}
        />
      ))}
    </main>
  );
}

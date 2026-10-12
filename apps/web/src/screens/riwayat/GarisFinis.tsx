// T024 — Garis Finis (FR-012): ONE FinishModel view with two axes. VARIANT:
// only a capped season celebrates — confetti (T023's in-house storm),
// panen count, duration, total diverted, the reputation jump, and the
// next-offer teaser read LIVE from offerOf; the term variant is the subdued
// forgiveness treatment (TermForgiveness.tsx — dignity, no party). ENTRY:
// live = a full-screen unprompted moment while you watch; replay = the same
// story framed as a past-season detail, confetti replaying on open — never
// push-style. Every number is chain-derived; nothing is a cached literal.
import { useEffect, useState } from "react";
import type { ChainReader, IsaOnChain } from "../../data/draft.js";
import { chainReader } from "../../data/draft.js";
import type { FinishModel } from "../../data/models.js";
import { fireConfetti } from "../../lib/confetti.js";
import { MOMENT_LIVE_FRAME, MOMENT_REPLAY_FRAME } from "../../lib/frames.js";
import type { MoneyLocale } from "../../lib/money.js";
import { formatAusdDetail, formatGrouped, toDisplayUnits } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import type { Quote } from "../moments/SplitMoment.js";
import { TermForgiveness } from "./TermForgiveness.js";

export function finishFromIsa(
  isa: IsaOnChain,
  over: {
    repBefore: number;
    repAfter: number;
    nextOfferAusd: bigint;
    entry: "live" | "replay";
    fetchedAt: number;
  },
): FinishModel {
  const variant = isa.status === 4 ? "term" : "capped";
  const cap = (isa.principal * BigInt(isa.capMult)) / 100n;
  return {
    card: {
      isaId: Number(isa.isaId),
      seeker: isa.seeker,
      counterparty: isa.backer,
      principalAusd: isa.principal,
      shareBps: isa.shareBps,
      capMult: isa.capMult,
      capAusd: cap,
      remainingAusd: isa.remaining,
      progressBps: 10_000,
      termEnd: Number(isa.termEnd),
      status: isa.status,
      fetchedAt: over.fetchedAt,
    },
    panenCount: Number(isa.eventCount),
    durationDays:
      isa.activatedAt > 0n && isa.lastEventAt > isa.activatedAt
        ? Math.floor(Number(isa.lastEventAt - isa.activatedAt) / 86_400)
        : 0,
    totalDivertedAusd: isa.remaining >= cap ? cap : cap - isa.remaining,
    repBefore: over.repBefore,
    repAfter: over.repAfter,
    nextOfferAusd: over.nextOfferAusd,
    entry: over.entry,
    variant,
    fetchedAt: over.fetchedAt,
  };
}

function StatRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-slate-400">{props.label}</span>
      <span className="font-semibold text-slate-100">{props.value}</span>
    </div>
  );
}

export function GarisFinis(props: {
  model: FinishModel;
  locale: Locale;
  lang?: MoneyLocale;
  quote?: Quote | null;
  reader?: ChainReader;
  onShare?(): void;
  onClose?(): void;
}) {
  const { model, locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const reader = props.reader ?? chainReader;
  const [nextOffer, setNextOffer] = useState(model.nextOfferAusd);

  // The teaser reads LIVE — offerOf now, never the model's frozen teaser.
  useEffect(() => {
    let live = true;
    reader
      .offerOf(model.card.seeker as `0x${string}`)
      .then((v) => {
        if (live) setNextOffer(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [reader, model.card.seeker]);

  // Celebration ONLY for the cap — replay deliberately re-runs it on open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    fireConfetti(document, 80);
  }, []);

  const idrHeadline =
    props.quote !== null && props.quote !== undefined
      ? `${locale.home.idrPrefix} ${locale.home.approx} ${formatGrouped(
          toDisplayUnits(Number(model.totalDivertedAusd), props.quote),
        )}`
      : null;
  const repDelta = model.repAfter - model.repBefore;
  return (
    <div className={model.entry === "live" ? MOMENT_LIVE_FRAME : MOMENT_REPLAY_FRAME}>
      <p className="text-sm font-semibold tracking-wide text-teal-300">
        {locale.moments.finishTitle}
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
          {formatAusdDetail(model.totalDivertedAusd, lang)}
        </p>
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-slate-800 p-4 text-left">
        <StatRow label={locale.moments.seasonPanen} value={String(model.panenCount)} />
        <div className="mt-1">
          <StatRow label={locale.moments.seasonDuration} value={String(model.durationDays)} />
        </div>
        {repDelta !== 0 ? (
          <div className="mt-1">
            <StatRow label={locale.moments.repJump} value={`+${String(repDelta)}`} />
          </div>
        ) : null}
        <div className="mt-1">
          <StatRow
            label={locale.moments.nextOfferLabel}
            value={formatAusdDetail(nextOffer, lang)}
          />
        </div>
      </div>
      {props.onShare ? (
        <button
          type="button"
          onClick={props.onShare}
          className="w-full max-w-sm rounded-xl bg-teal-500 px-6 py-3 text-lg font-semibold text-slate-900 shadow"
        >
          {locale.moments.shareCta}
        </button>
      ) : null}
      {props.onClose ? (
        <button type="button" onClick={props.onClose} className="text-sm text-slate-400 underline">
          {locale.common.continue}
        </button>
      ) : null}
    </div>
  );
}

/** The ONE view — the model's variant picks the face. */
export function FinishView(props: {
  model: FinishModel;
  locale: Locale;
  lang?: MoneyLocale;
  quote?: Quote | null;
  reader?: ChainReader;
  onShare?(): void;
  onClose?(): void;
}) {
  if (props.model.variant === "term") {
    return (
      <TermForgiveness
        model={props.model}
        locale={props.locale}
        lang={props.lang}
        onClose={props.onClose}
      />
    );
  }
  return <GarisFinis {...props} />;
}

// T014 — Ajukan (FR-006, FR-008, FR-011's direct lane): amount + purpose →
// the guidance numbers WITH their why (share 2000−8×score bps, cap 1.3×P —
// read LIVE through data/draft, never invented here) → the amount checked
// against the live offer → ONE approval broadcasts the draft through T013's
// account adapter at the PUBLISHED fixed limit. The share action hands out
// the WhatsApp-ready deep link. Drip exhaustion is a FIRST-CLASS state
// (research D3 §4) with its own plain Bahasa explanation; every other
// failure is the generic retryable one. No wire imports here — data/ only.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import type { AccountSession } from "../../auth/types.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { DraftBroadcaster, Guidance } from "../../data/draft.js";
import {
  amountOk,
  broadcastDraft,
  capOf,
  chainReader,
  defaultChannel,
  defaultTermEnd,
  liveGuidance,
  makeDefaultBroadcaster,
  parseAusdInput,
  parseBackerInput,
  purposeDeepLink,
  waShareLink,
} from "../../data/draft.js";
import { savePurposeRecord } from "../../data/records.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";

type Phase = "loading" | "ready" | "signing" | "submitted" | "done" | "drip" | "blocked" | "error";

/** shareBps → a percent label with the locale's decimal separator, integer
 *  math only (constitution VI — no float ever renders a money rule). */
export function pctLabel(shareBps: number, lang: MoneyLocale): string {
  const whole = Math.floor(shareBps / 100);
  const cents = shareBps % 100;
  const sep = lang === "en" ? "." : ",";
  return `${whole}${sep}${cents.toString().padStart(2, "0")}%`;
}

export function Ajukan(props: {
  locale: Locale;
  lang?: MoneyLocale;
  session: AccountSession;
  api: ApiClient;
  storage: StorageLike;
  /** test seams — the real screen uses the module reader/broadcaster */
  reader?: typeof chainReader;
  broadcaster?: DraftBroadcaster;
  origin?: string;
  onBack(): void;
}) {
  const { locale, session, api, storage } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const [phase, setPhase] = useState<Phase>("loading");
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [backerRaw, setBackerRaw] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [purpose, setPurpose] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);

  const reader = props.reader ?? chainReader;

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [g, me] = await Promise.all([liveGuidance(reader, session.address), api.me()]);
      // FR-008: the one-active rule is checked the same way — the session's
      // own live surface; the contract re-checks at the draft anyway.
      if (me.activeIsa) {
        setPhase("blocked");
        return;
      }
      setGuidance(g);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [reader, session, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const backer = useMemo(
    () => (backerRaw.trim() === "" ? null : parseBackerInput(backerRaw)),
    [backerRaw],
  );
  const amount = useMemo(
    () => (amountRaw.trim() === "" ? null : parseAusdInput(amountRaw)),
    [amountRaw],
  );
  const overLimit = amount !== null && guidance !== null && !amountOk(amount, guidance.offerAusd);
  const cap = amount !== null ? capOf(amount) : null;
  const inputReady = backer !== null && amount !== null && !overLimit;

  async function submit(): Promise<void> {
    if (
      phase !== "ready" ||
      !inputReady ||
      guidance === null ||
      backer === null ||
      amount === null
    ) {
      return;
    }
    setPhase("signing");
    try {
      // Re-evaluate live immediately before any signature (FR-008).
      const [g, me] = await Promise.all([liveGuidance(reader, session.address), api.me()]);
      if (me.activeIsa) {
        setPhase("blocked");
        return;
      }
      setGuidance(g);
      if (!amountOk(amount, g.offerAusd)) {
        setPhase("ready");
        return;
      }
      await defaultChannel(reader);
      // One approval: the fee check inside broadcastDraft runs BEFORE the
      // signature, so an unfunded fee pot never wastes a ceremony.
      const broadcaster = props.broadcaster ?? makeDefaultBroadcaster(session);
      setPhase("submitted");
      const outcome = await broadcastDraft(broadcaster, {
        backer,
        amountAusd: amount,
        guidance: g,
        termEnd: defaultTermEnd(Math.floor(Date.now() / 1000)),
        channelId: 1n,
      });
      if (outcome.kind === "mined") {
        savePurposeRecord(storage, {
          isaId: outcome.isaId,
          principalAusd: amount.toString(),
          purpose: purpose.trim().slice(0, 140),
          createdAt: Date.now(),
        });
        setShareLink(purposeDeepLink(originOf(props.origin), session.address, purpose));
        setPhase("done");
      } else if (outcome.kind === "drip-exhausted") {
        setPhase("drip");
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    }
  }

  if (phase === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.edge.loading}
      </main>
    );
  }
  if (phase === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.edge.retry}
        </button>
        <button type="button" onClick={props.onBack} className="text-sm text-slate-500">
          {locale.edge.back}
        </button>
      </main>
    );
  }
  if (phase === "blocked") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600">{locale.dukung.satuPerjanjian}</p>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.edge.back}
        </button>
      </main>
    );
  }
  if (phase === "drip") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-slate-800">{locale.ajukan.dripTitle}</p>
        <p className="text-slate-600">{locale.ajukan.dripBody}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.common.retry}
        </button>
      </main>
    );
  }
  if (phase === "done") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10 text-center">
        <h1 className="text-2xl font-bold text-teal-700">{locale.ajukan.doneTitle}</h1>
        <p className="text-slate-600">{locale.ajukan.doneBody}</p>
        <input
          readOnly
          value={shareLink}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
        />
        <a
          href={waShareLink(shareLink, purpose)}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.ajukan.waShare}
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(shareLink).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          className="rounded-xl border border-slate-300 px-6 py-3 font-semibold text-slate-700"
        >
          {copied ? locale.ajukan.copied : locale.ajukan.copyLink}
        </button>
        <p className="text-xs text-slate-500">{locale.edge.leavesApp}</p>
        <button type="button" onClick={props.onBack} className="mt-2 text-sm text-slate-500">
          {locale.edge.back}
        </button>
      </main>
    );
  }

  const busy = phase !== "ready";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-bold text-teal-700">{locale.ajukan.title}</h1>

      <label className="flex flex-col gap-1 text-sm text-slate-600" htmlFor="ajukan-backer">
        {locale.ajukan.backerLabel}
        <input
          id="ajukan-backer"
          value={backerRaw}
          onChange={(e) => setBackerRaw(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800"
        />
        <span className="text-xs text-slate-500">{locale.ajukan.backerCode}</span>
        {backer === null && backerRaw.trim() !== "" ? (
          <span className="text-xs text-red-600">{locale.kirim.invalidAddress}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-600" htmlFor="ajukan-amount">
        {locale.ajukan.amountLabel}
        <input
          id="ajukan-amount"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          inputMode="decimal"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800"
        />
        {overLimit && guidance !== null ? (
          <span className="text-xs text-red-600">
            {locale.ajukan.overLimit} — {formatAusdDetail(guidance.offerAusd, lang)}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-600" htmlFor="ajukan-purpose">
        {locale.ajukan.purposeLabel}
        <textarea
          id="ajukan-purpose"
          value={purpose}
          maxLength={140}
          onChange={(e) => setPurpose(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800"
        />
        <span className="text-xs text-slate-500">{locale.ajukan.purposeHint}</span>
      </label>

      {guidance !== null ? (
        <section className="rounded-2xl border border-slate-200 p-4 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">{locale.ajukan.shareRuleLabel}</span>
            <span className="text-lg font-semibold text-slate-800">
              {pctLabel(guidance.shareBps, lang)}
            </span>
          </div>
          <p className="text-xs text-slate-500">{locale.ajukan.shareRuleWhy}</p>
          {cap !== null ? (
            <>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-slate-500">{locale.ajukan.capRuleLabel}</span>
                <span className="text-lg font-semibold text-slate-800">
                  {formatAusdDetail(cap, lang)}
                </span>
              </div>
              <p className="text-xs text-slate-500">{locale.ajukan.capRuleWhy}</p>
            </>
          ) : null}
          <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {locale.ajukan.offerWhyPrefix}: {formatAusdDetail(guidance.offerAusd, lang)}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        disabled={!inputReady || busy}
        onClick={() => void submit()}
        className="rounded-xl bg-teal-600 px-6 py-4 text-lg font-semibold text-white shadow disabled:bg-slate-300"
      >
        {phase === "signing"
          ? locale.ajukan.signing
          : phase === "submitted"
            ? locale.ajukan.submitting
            : locale.beranda.ajukanCta}
      </button>
      <button type="button" onClick={props.onBack} className="text-sm text-slate-500">
        {locale.edge.back}
      </button>
    </main>
  );
}

function originOf(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  try {
    return window.location.origin;
  } catch {
    return "";
  }
}

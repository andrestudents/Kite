// T015 — PublicProfile (FR-019): the target of the Ajukan share link. Stars
// from the live score, the completed count, the open request (Drafted deal)
// rendered PROMINENTLY with its Dukung CTA, per-ISA history with explorer
// proof links (never raw hex in prose — the label is the copy, the hash is
// only in the href), the ?ajukan= purpose as TEXT ONLY (React escaping —
// T005's structural assertion), and the receive-code QR over the profile
// URL, cached device-side. ZERO personal data (PLAN §8 frozen): no name, no
// documents — the record IS the identity. No session required to view.
import { useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { DealCardModel, ProfileModel } from "../../data/models.js";
import { loadProfileModel } from "../../data/profile-load.js";
import { makeDefaultQrPort, type QRPort, receiveCodeDataUrl } from "../../data/qr.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";

/** The share link's purpose, read from THIS page's URL — trimmed, capped at
 *  the same 140 the Ajukan input enforces, and rendered as text only. */
export function readAjukanParam(search?: string): string {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  try {
    return (new URLSearchParams(raw).get("ajukan") ?? "").trim().slice(0, 140);
  } catch {
    return "";
  }
}

/** The proof link — the hash lives in the href, never in rendered prose. */
export function explorerTxUrl(explorerBaseUrl: string, txHash: string): string {
  return `${explorerBaseUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

/** score → 0–5 stars, clamped (the assembler rounds score/20). */
export function starsLabel(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return `${"★".repeat(n)}${"☆".repeat(5 - n)}`;
}

/** The machine status → the catalog's label. 0 (None) renders empty — the
 *  row hides its badge rather than inventing a state. */
export function statusLabel(status: number, locale: Locale): string {
  switch (status) {
    case 1:
      return locale.dealCard.statusDrafted;
    case 2:
      return locale.dealCard.statusActive;
    case 3:
      return locale.dealCard.statusCapped;
    case 4:
      return locale.dealCard.statusTerm;
    case 5:
      return locale.dealCard.statusCancelled;
    default:
      return "";
  }
}

/** The ?ajukan= context — TEXT ONLY through interpolation (React escapes the
 *  payload; no HTML ever reaches the DOM from the URL). */
export function AjukanContext(props: { locale: Locale; text: string }) {
  return (
    <section className="rounded-2xl bg-amber-50 p-4 text-sm">
      <p className="text-xs text-slate-500">{props.locale.dealCard.purposeLabel}</p>
      <p className="mt-1 text-slate-800">{props.text}</p>
    </section>
  );
}

export function OpenRequest(props: {
  locale: Locale;
  lang: MoneyLocale;
  card: DealCardModel;
  onDukung?(seeker: string): void;
}) {
  const { locale, lang, card } = props;
  return (
    <section className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
      <p className="text-sm font-semibold text-teal-800">{locale.profile.openRequestTitle}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">
        {formatAusdDetail(card.principalAusd, lang)}
      </p>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">
          {locale.dealCard.shareLabel} {pctLabel(card.shareBps, lang)}
        </span>
        <span className="text-slate-500">
          {locale.dealCard.capLabel} {formatAusdDetail(card.capAusd, lang)}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {locale.dealCard.endLabel} {locale.dealCard.endByCap}
      </p>
      <p className="mt-1 text-xs text-slate-600">{locale.dealCard.failedHarvest}</p>
      <button
        type="button"
        onClick={() => props.onDukung?.(card.seeker)}
        className="mt-4 w-full rounded-xl bg-teal-600 px-6 py-3 text-lg font-semibold text-white shadow"
      >
        {locale.profile.dukungCta}
      </button>
    </section>
  );
}

function HistoryRow(props: {
  locale: Locale;
  lang: MoneyLocale;
  card: DealCardModel;
  explorerBaseUrl: string;
}) {
  const { locale, lang, card } = props;
  const badge = statusLabel(card.status, locale);
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-slate-800">
          {formatAusdDetail(card.principalAusd, lang)}
        </span>
        {badge !== "" ? <span className="text-xs text-slate-500">{badge}</span> : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {locale.dealCard.shareLabel} {pctLabel(card.shareBps, lang)} · {locale.dealCard.capLabel}{" "}
        {formatAusdDetail(card.capAusd, lang)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {locale.dealCard.progressLabel} {Math.floor(card.progressBps / 100)}%
      </p>
      {(card.panen ?? []).map((row) => (
        <div
          key={row.txHash}
          className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600"
        >
          <div className="flex items-baseline justify-between">
            <span>{row.blockTime.slice(0, 10)}</span>
            <a
              href={explorerTxUrl(props.explorerBaseUrl, row.txHash)}
              target="_blank"
              rel="noreferrer"
              className="text-teal-700 underline"
            >
              {locale.detail.viewProof}
            </a>
          </div>
          <p>
            {locale.detail.grossLabel} {formatAusdDetail(row.grossAusd, lang)}
          </p>
        </div>
      ))}
    </article>
  );
}

export function PublicProfile(props: {
  locale: Locale;
  lang?: MoneyLocale;
  api: ApiClient;
  storage: StorageLike;
  profileId: string;
  /** the share link's purpose — defaults to this page's own URL parameter */
  ajukan?: string;
  origin?: string;
  /** test seam — the real screen lazily wires the qrcode renderer */
  qr?: QRPort;
  onDukung?(seeker: string): void;
  onBack?(): void;
}) {
  const { locale, api, storage, profileId } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const [model, setModel] = useState<ProfileModel | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await loadProfileModel(api, profileId);
        if (!alive) return;
        setModel(loaded);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, profileId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const qr = props.qr ?? (await makeDefaultQrPort());
        const origin =
          props.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
        const dataUrl = await receiveCodeDataUrl(storage, qr, origin, profileId);
        if (alive) setQrDataUrl(dataUrl);
      } catch {
        if (alive) setQrDataUrl(null); // no QR image — no hex fallback in prose
      }
    })();
    return () => {
      alive = false;
    };
  }, [storage, profileId, props.qr, props.origin]);

  async function reload(): Promise<void> {
    setFailed(false);
    setModel(null);
    try {
      setModel(await loadProfileModel(api, profileId));
    } catch {
      setFailed(true);
    }
  }

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-slate-600">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-xl bg-teal-600 px-6 py-3 font-semibold text-white shadow"
        >
          {locale.edge.retry}
        </button>
      </main>
    );
  }
  if (model === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.edge.loading}
      </main>
    );
  }
  const ajukanText = props.ajukan !== undefined ? props.ajukan : readAjukanParam();
  const historyRows = model.deals.filter((d) => d.isaId !== model.openRequest?.isaId);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-2xl" aria-hidden="true">
          {starsLabel(model.stars)}
        </p>
        <p className="text-sm text-slate-500">
          {model.completedDeals} {locale.profile.completedLabel}
        </p>
      </header>

      {ajukanText !== "" ? <AjukanContext locale={locale} text={ajukanText} /> : null}

      {model.openRequest ? (
        <OpenRequest
          locale={locale}
          lang={lang}
          card={model.openRequest}
          onDukung={props.onDukung}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-slate-700">{locale.profile.historyTitle}</h2>
        {historyRows.length === 0 && model.openRequest === null ? (
          <p className="text-sm text-slate-500">{locale.profile.noHistory}</p>
        ) : (
          historyRows.map((d) => (
            <HistoryRow
              key={d.isaId}
              locale={locale}
              lang={lang}
              card={d}
              explorerBaseUrl={model.explorerBaseUrl}
            />
          ))
        )}
      </section>

      {qrDataUrl !== null ? (
        <section className="rounded-2xl border border-slate-200 p-5 text-center">
          <p className="text-sm font-semibold text-slate-700">{locale.profile.qrTitle}</p>
          <img src={qrDataUrl} alt={locale.profile.qrTitle} className="mx-auto mt-3 h-44 w-44" />
          <p className="mt-2 text-xs text-slate-500">{locale.profile.qrHint}</p>
        </section>
      ) : null}

      {props.onBack ? (
        <button type="button" onClick={props.onBack} className="text-sm text-slate-500">
          {locale.edge.back}
        </button>
      ) : null}
    </main>
  );
}

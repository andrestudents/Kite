// T029 — Riwayat (FR-015): ONE merged latest-first feed — income (per-panen
// settlement events), sends (device-local records), completions (terminal
// deals opening the T025 detail). Assembled ONLY inside the data seam
// (riwayatFrom); the screen projects. Every money row carries its proof:
// explorer link where a hash exists, the detail hand-off where the story is
// the deal itself. An empty feed says so — never filler rows.
import { useCallback, useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import { riwayatFrom } from "../../data/assemble.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { RiwayatModel, RiwayatRow } from "../../data/models.js";
import { loadSentRecords } from "../../data/records.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import { shortAddress } from "../beranda/DealCard.js";
import { explorerTxUrl } from "../profile/PublicProfile.js";

export function RiwayatRowView(props: {
  row: RiwayatRow;
  explorerBaseUrl: string;
  locale: Locale;
  lang?: MoneyLocale;
  onOpen?(isaId: number): void;
}) {
  const { locale, row } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  if (row.kind === "income") {
    return (
      <article className="rounded-2xl border border-leaf100 bg-leafsoft p-4 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5 font-bold text-leafdk">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-leaf" />
            {locale.riwayat.incomeLabel} {formatAusdDetail(row.panen.grossAusd, lang)}
          </span>
          <span className="text-xs text-muted">{row.panen.blockTime.slice(0, 10)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {locale.detail.toYouLabel} {formatAusdDetail(row.panen.toSeekerAusd, lang)}
        </p>
        <a
          href={explorerTxUrl(props.explorerBaseUrl, row.panen.txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs font-semibold text-leafdk underline"
        >
          {locale.riwayat.viewProof}
        </a>
      </article>
    );
  }
  if (row.kind === "send") {
    return (
      <article className="rounded-2xl border border-line bg-white p-4 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-bold text-ink">
            {locale.riwayat.sendLabel} {formatAusdDetail(row.send.valueAusd, lang)}
          </span>
          <span className="text-xs text-muted">
            {new Date(row.send.at).toISOString().slice(0, 10)}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-muted">{shortAddress(row.send.to)}</p>
        {row.send.txHash !== undefined ? (
          <a
            href={explorerTxUrl(props.explorerBaseUrl, row.send.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-leafdk underline"
          >
            {locale.riwayat.viewProof}
          </a>
        ) : null}
      </article>
    );
  }
  return (
    <article className="rounded-2xl border border-gold100 bg-goldsoft p-4 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 font-bold text-golddk">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
          {locale.riwayat.completeLabel} {formatAusdDetail(row.card.principalAusd, lang)}
        </span>
        {props.onOpen ? (
          <button
            type="button"
            onClick={() => props.onOpen?.(row.card.isaId)}
            className="text-xs font-semibold text-golddk underline"
          >
            {locale.detail.title}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        {locale.dealCard.shareLabel} {pctLabel(row.card.shareBps, lang)} ·{" "}
        {locale.dealCard.capLabel} {formatAusdDetail(row.card.capAusd, lang)}
      </p>
    </article>
  );
}

/** Stable identity from the row's own content — never the array index. */
function rowKey(row: RiwayatRow): string {
  if (row.kind === "income") {
    return `income-${row.panen.blockTime}-${String(row.panen.grossAusd)}`;
  }
  if (row.kind === "send") {
    return `send-${String(row.send.at)}-${row.send.to}`;
  }
  return `complete-${String(row.card.isaId)}`;
}

export function Riwayat(props: {
  locale: Locale;
  lang?: MoneyLocale;
  api: ApiClient;
  storage: StorageLike;
  /** THIS session's own wallet — the /api/p/:id id (profile-service accepts
   *  the address form). Income + completions come from the public surface. */
  wallet: string;
  onOpen?(isaId: number): void;
  onBack?(): void;
}) {
  const { locale, api, storage, wallet } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const [model, setModel] = useState<RiwayatModel | null>(null);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setModel(null);
    try {
      const dto = await api.profile(wallet);
      setExplorerBaseUrl(dto.explorerBaseUrl);
      setModel(riwayatFrom(dto, loadSentRecords(storage), Date.now()));
    } catch {
      setFailed(true);
    }
  }, [api, storage, wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-line2 bg-white px-6 py-3 font-semibold text-ink shadow"
        >
          {locale.edge.retry}
        </button>
      </main>
    );
  }
  if (model === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        {locale.edge.loading}
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">{locale.riwayat.title}</h1>
      {model.rows.length === 0 ? (
        <p className="text-sm text-muted">{locale.riwayat.empty}</p>
      ) : (
        model.rows.map((row) => (
          <RiwayatRowView
            key={rowKey(row)}
            row={row}
            explorerBaseUrl={explorerBaseUrl}
            locale={locale}
            lang={lang}
            onOpen={props.onOpen}
          />
        ))
      )}
      {props.onBack ? (
        <button type="button" onClick={props.onBack} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      ) : null}
    </main>
  );
}

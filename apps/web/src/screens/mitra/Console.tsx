// T033 — the Mitra console (US5): the operator's desktop-first view over the
// 005 purchase registry, reached with the MITA demo key by NAME (never the
// INTERNAL key). Constitution VIII: simulated tooling — the Demo Tool badge
// is visible on the surface. Registry status words never render raw; every
// status goes through the locale catalogs. Kite rows carry the Bayar action;
// rows from any other channel are labeled as outside Kite and stay inert
// (their settlement happens in that channel's own tooling).
import { useCallback, useEffect, useState } from "react";
import type { MitraClient, MitraPurchaseRow, PurchaseStatus } from "../../data/mitra.js";
import { isKiteRow, STATUS_PENDING } from "../../data/mitra.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { shortAddress } from "../beranda/DealCard.js";

/** Registry status → catalog label (the raw word never reaches JSX). */
export function statusLabelOf(status: PurchaseStatus, locale: Locale): string {
  if (status === STATUS_PENDING) return locale.mitra.statusPending;
  if (status === "PAID") return locale.mitra.statusPaid;
  if (status === "SETTLED") return locale.mitra.statusSettled;
  return locale.mitra.statusFailed;
}

export function ConsoleView(props: {
  rows: MitraPurchaseRow[];
  locale: Locale;
  lang?: MoneyLocale;
  onBayar?(row: MitraPurchaseRow): void;
}) {
  const { locale, rows } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight text-ink">{locale.mitra.title}</h1>
        <span className="rounded-full border border-gold100 bg-goldsoft px-3 py-1 text-xs font-bold text-golddk">
          {locale.mitra.badge}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{locale.edge.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">{locale.mitra.totalLabel}</th>
                <th className="px-4 py-3 font-semibold">{locale.mitra.statusLabel}</th>
                <th className="px-4 py-3" aria-label={locale.mitra.nonKiteRow}></th>
                <th className="px-4 py-3" aria-label={locale.mitra.bayarCta}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const kite = isKiteRow(row);
                const payable =
                  kite && row.status === STATUS_PENDING && props.onBayar !== undefined;
                return (
                  <tr
                    key={row.id}
                    className={
                      kite
                        ? "border-t border-line text-ink"
                        : "border-t border-line text-muted opacity-70"
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs">{shortAddress(row.purchaseRef)}</td>
                    <td className="px-4 py-3 font-semibold">
                      {formatAusdDetail(row.grossAusd, lang)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[#F0F3EE] px-2 py-0.5 text-xs font-semibold text-muted">
                        {statusLabelOf(row.status, locale)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{kite ? null : locale.mitra.nonKiteRow}</td>
                    <td className="px-4 py-3">
                      {payable ? (
                        <button
                          type="button"
                          onClick={() => props.onBayar?.(row)}
                          className="rounded-xl bg-leaf px-4 py-2 text-xs font-semibold text-white shadow"
                        >
                          {locale.mitra.bayarCta}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Console(props: {
  locale: Locale;
  lang?: MoneyLocale;
  client: MitraClient;
  onBayar?(row: MitraPurchaseRow): void;
  onBack?(): void;
}) {
  const { locale, client } = props;
  const [rows, setRows] = useState<MitraPurchaseRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setRows(null);
    try {
      setRows((await client.list()).slice());
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="rounded-full border border-gold100 bg-goldsoft px-3 py-1 text-xs font-bold text-golddk">
          {locale.mitra.badge}
        </span>
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
  if (rows === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        {locale.edge.loading}
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-6 py-10">
      <ConsoleView rows={rows} locale={locale} lang={props.lang} onBayar={props.onBayar} />
      {props.onBack ? (
        <button type="button" onClick={props.onBack} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      ) : null}
    </main>
  );
}

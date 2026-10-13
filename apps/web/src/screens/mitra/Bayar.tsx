// T034 — the Bayar flow (US5): the split preview comes from the LIVE ISA
// terms — the identical integer math the contract enforces (gross ×
// shareBps / 10000 to the seeker, the remainder to the backer) — and renders
// BEFORE any submission; the pay action stays unreachable until it does.
// Paying latches: one tap, disabled after, and the registry's forward-only
// transition makes a double-submit impossible server-side too. Settlement
// sits behind ONE SettlementSubmitter seam (FR-018): with no submitter
// injected the console says so honestly (settlement runs via 005's Demo Tool
// path); Feature 009's CRE WF-1 swaps the implementation by configuration —
// this file never changes.
import { useCallback, useEffect, useState } from "react";
import type { ChainReader, IsaOnChain } from "../../data/draft.js";
import { chainReader } from "../../data/draft.js";
import type {
  MitraClient,
  MitraPurchaseRow,
  SettlementReceipt,
  SettlementSubmitter,
  SplitPreview,
} from "../../data/mitra.js";
import { isKiteRow, STATUS_PENDING, splitPreview } from "../../data/mitra.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { shortAddress } from "../beranda/DealCard.js";
import { statusLabelOf } from "./Console.js";

export function BayarView(props: {
  row: MitraPurchaseRow;
  split: SplitPreview | null;
  locale: Locale;
  lang?: MoneyLocale;
  busy: boolean;
  latch: boolean;
  settleBusy: boolean;
  receipt: SettlementReceipt | null;
  submitter?: SettlementSubmitter;
  onPay?(): void;
  onSettle?(): void;
  onBack?(): void;
}) {
  const { locale, row, split } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const payable = row.status === STATUS_PENDING && split !== null && props.onPay !== undefined;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight text-ink">{locale.mitra.bayarCta}</h1>
        <span className="rounded-full border border-gold100 bg-goldsoft px-3 py-1 text-xs font-bold text-golddk">
          {locale.mitra.badge}
        </span>
      </div>
      <p className="font-mono text-xs text-muted">{shortAddress(row.purchaseRef)}</p>
      {split === null ? (
        <p className="text-sm text-muted">{locale.edge.loading}</p>
      ) : (
        <div className="rounded-2xl border border-line bg-white p-4 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">{locale.mitra.totalLabel}</span>
            <span className="font-bold text-ink">{formatAusdDetail(split.grossAusd, lang)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-leaf" />
              {locale.mitra.toFarmerLabel}
            </span>
            <span className="font-bold text-leafdk">
              {formatAusdDetail(split.toSeekerAusd, lang)}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
              {locale.mitra.toBackerLabel}
            </span>
            <span className="font-bold text-golddk">
              {formatAusdDetail(split.toBackerAusd, lang)}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-full bg-[#F0F3EE] px-3 py-1 text-xs font-semibold text-muted">
          {statusLabelOf(row.status, locale)}
        </span>
        {payable ? (
          <button
            type="button"
            disabled={props.busy || props.latch}
            onClick={() => props.onPay?.()}
            className="rounded-xl bg-leaf px-6 py-3 font-semibold text-white shadow disabled:opacity-50"
          >
            {locale.mitra.markPaid}
          </button>
        ) : null}
      </div>
      {row.status === "PAID" && props.receipt === null ? (
        props.submitter !== undefined ? (
          <button
            type="button"
            disabled={props.settleBusy}
            onClick={() => props.onSettle?.()}
            className="rounded-xl bg-ink px-6 py-3 font-semibold text-[#F2F6EF] shadow disabled:opacity-50"
          >
            {locale.mitra.settleCta}
          </button>
        ) : (
          <p className="rounded-2xl border border-warnline bg-warnsoft p-4 text-xs text-golddk">
            {locale.mitra.unconfigured}
          </p>
        )
      ) : null}
      {props.receipt !== null ? (
        <p className="font-mono text-xs text-muted">
          {locale.mitra.statusSettled}
          {props.receipt.txHash !== undefined ? ` · ${shortAddress(props.receipt.txHash)}` : ""}
        </p>
      ) : null}
      {props.onBack ? (
        <button type="button" onClick={props.onBack} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      ) : null}
    </section>
  );
}

export function Bayar(props: {
  locale: Locale;
  lang?: MoneyLocale;
  row: MitraPurchaseRow;
  client: MitraClient;
  reader?: ChainReader;
  /** Injected only where a settlement submitter is configured (FR-018). */
  submitter?: SettlementSubmitter;
  onDone?(row: MitraPurchaseRow): void;
  onBack?(): void;
}) {
  const { locale, client, row } = props;
  const reader: ChainReader = props.reader ?? chainReader;
  const [current, setCurrent] = useState<MitraPurchaseRow>(row);
  const [isa, setIsa] = useState<IsaOnChain | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [latch, setLatch] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null);

  const load = useCallback(async () => {
    if (!isKiteRow(current)) {
      return; // non-Kite settlements happen in that channel's own tooling
    }
    setFailed(false);
    try {
      setIsa(await reader.isaOf(BigInt(current.isaId)));
    } catch {
      setFailed(true);
    }
  }, [current, reader]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = useCallback(async () => {
    setBusy(true);
    setLatch(true);
    try {
      const updated = await client.markPaid(current.id);
      setCurrent(updated);
      props.onDone?.(updated);
    } catch {
      setLatch(false);
    } finally {
      setBusy(false);
    }
  }, [client, current.id, props]);

  const settle = useCallback(async () => {
    const submitter = props.submitter;
    if (submitter === undefined) {
      return;
    }
    setSettleBusy(true);
    try {
      setReceipt(await submitter.submit(current.id));
    } catch {
      setReceipt(null);
    } finally {
      setSettleBusy(false);
    }
  }, [current.id, props.submitter]);

  if (!isKiteRow(current)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="rounded-full border border-gold100 bg-goldsoft px-3 py-1 text-xs font-bold text-golddk">
          {locale.mitra.badge}
        </span>
        <p className="text-sm text-muted">{locale.mitra.nonKiteRow}</p>
      </main>
    );
  }
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
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <BayarView
        row={current}
        split={isa === null ? null : splitPreview(current.grossAusd, isa)}
        locale={locale}
        lang={props.lang}
        busy={busy}
        latch={latch}
        settleBusy={settleBusy}
        receipt={receipt}
        submitter={props.submitter}
        onPay={() => void pay()}
        onSettle={() => void settle()}
        onBack={props.onBack}
      />
    </main>
  );
}

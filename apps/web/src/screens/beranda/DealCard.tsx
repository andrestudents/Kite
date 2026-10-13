// T018 — the ONE deal card (FR-004): every deal surface — Beranda's active
// card today, any future surface — leans on this component so the four
// elements can never drift apart: (1) the supporter's share %, (2) the cap,
// (3) the failed-harvest line, (4) the end condition. Above them: live
// progress (integer bps → whole %) on the ripening fill, the remaining
// amount (an ≈Rp headline when the caller has a locked quote), the machine
// status pill, and the partner (short-form address — never a fabricated
// name). Share is always the gold chip, the cap always plain — the two
// money streams never swap colors. Catalog copy only; numbers integer
// end-to-end.
import type { DealCardModel } from "../../data/models.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { statusLabel } from "../profile/PublicProfile.js";
import { pctLabel } from "./Ajukan.js";

/** Short address form for tight rows — a value, never prose. */
export function shortAddress(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** The machine status as a quiet pill: Active is leaf, Lunas (capped) is
 *  gold — the only two states that carry color. Everything else is neutral. */
function StatusPill(props: { status: number; locale: Locale }) {
  const label = statusLabel(props.status, props.locale);
  if (label === "") return null;
  const tone =
    props.status === 2
      ? "bg-leafsoft text-leafdk"
      : props.status === 3
        ? "bg-goldsoft text-golddk"
        : "bg-[#F0F3EE] text-muted";
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold ${tone}`}
    >
      {label}
    </span>
  );
}

/** Element 4 — the end condition. A finished-at-term deal names its day;
 *  everything else ends when the cap is reached. */
export function DealEnd(props: { card: DealCardModel; locale: Locale }) {
  const { card, locale } = props;
  if (card.status === 4 && card.termEnd > 0) {
    const day = new Date(card.termEnd * 1000).toISOString().slice(0, 10);
    return (
      <p className="text-xs text-muted">
        {locale.dealCard.endLabel} {locale.dealCard.endByTerm} {day}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted">
      {locale.dealCard.endLabel} {locale.dealCard.endByCap}
    </p>
  );
}

export function DealCard(props: {
  card: DealCardModel;
  locale: Locale;
  lang?: MoneyLocale;
  /** IDR formatter over a locked quote (Beranda has one). When present the
   *  headline is the ≈Rp of what remains; AUSD stays the detail row. */
  formatIdr?: (ausd: bigint) => string;
  onOpen?(): void;
}) {
  const { card, locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const progressPct = Math.floor(card.progressBps / 100);
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{locale.home.activeDealTitle}</p>
        <StatusPill status={card.status} locale={locale} />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        {props.formatIdr ? (
          <div>
            <p className="text-xl font-extrabold tracking-tight text-ink">
              {locale.home.approx} {props.formatIdr(card.remainingAusd)}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {locale.home.remainingLabel} {formatAusdDetail(card.remainingAusd, lang)}
            </p>
          </div>
        ) : (
          <span className="text-lg font-bold text-ink">
            {locale.home.remainingLabel} {formatAusdDetail(card.remainingAusd, lang)}
          </span>
        )}
        <span className="shrink-0 text-sm font-extrabold text-leafdk">{progressPct}%</span>
      </div>
      <div className="mt-2.5 h-2.5 rounded-full bg-[#E4EBDF]">
        <div
          className="ripen h-2.5 rounded-full"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        {locale.ajukan.backerLabel}{" "}
        <span className="font-mono">{shortAddress(card.counterparty)}</span>
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-goldsoft px-2.5 py-1 text-xs font-bold whitespace-nowrap text-golddk">
          <span className="h-2 w-2 shrink-0 rounded-full bg-gold" />
          {locale.dealCard.shareLabel} {pctLabel(card.shareBps, lang)}
        </span>
        <span className="text-xs font-semibold text-muted">
          {locale.dealCard.capLabel} {formatAusdDetail(card.capAusd, lang)}
        </span>
      </div>
      <div className="mt-1.5">
        <DealEnd card={card} locale={locale} />
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-leafsoft px-3 py-2.5 text-xs font-bold text-leafdk">
        <span className="h-2 w-2 shrink-0 rounded-full bg-leaf" />
        {locale.dealCard.failedHarvest}
      </div>
      {props.onOpen ? (
        <button
          type="button"
          onClick={props.onOpen}
          className="mt-3 w-full rounded-xl bg-leaf px-6 py-3 text-base font-semibold text-white shadow"
        >
          {locale.detail.title}
        </button>
      ) : null}
    </section>
  );
}

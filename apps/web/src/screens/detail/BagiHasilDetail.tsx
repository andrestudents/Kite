// T025 — BagiHasilDetail (FR-014): ONE deal's terms + its per-panen history,
// assembled from /api/p/:id through dealDetailFromProfile (the data seam).
// The chain read wins over the projection (data-model §5): a live isaOf read
// corrects the card's numbers and — when the season is terminal — feeds
// T024's replay moment (FinishView, entry "replay"; the term variant lands
// on the forgiveness face by the model's own routing). Proof links carry the
// hash in the href only; the copy stays catalog-only.
import { useEffect, useState } from "react";
import { dealDetailFromProfile } from "../../data/assemble.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { ChainReader, IsaOnChain } from "../../data/draft.js";
import { chainReader } from "../../data/draft.js";
import type { DealCardModel, DealDetailModel, FinishModel, PanenRow } from "../../data/models.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import { DealEnd } from "../beranda/DealCard.js";
import type { Quote } from "../moments/SplitMoment.js";
import { explorerTxUrl, statusLabel } from "../profile/PublicProfile.js";
import { FinishView, finishFromIsa } from "../riwayat/GarisFinis.js";

/** The replay FinishModel: built from the chain's own ISA — the season's
 *  story told again. A replay cannot reconstruct the score BEFORE this
 *  season (the contract keeps only the current score), so rep stays flat and
 *  the view hides an unearned jump. */
export function finishFromDetail(
  isa: IsaOnChain,
  over: { score: number; offerAusd: bigint; fetchedAt: number },
): FinishModel {
  return finishFromIsa(isa, {
    repBefore: over.score,
    repAfter: over.score,
    nextOfferAusd: over.offerAusd,
    entry: "replay",
    fetchedAt: over.fetchedAt,
  });
}

/** The chain wins: cap, remaining, progress, status, partner, termEnd — all
 *  re-derived from the contract's ISA, never mixed with the projection's. */
export function mergeIsa(card: DealCardModel, isa: IsaOnChain): DealCardModel {
  const cap = (isa.principal * BigInt(isa.capMult)) / 100n;
  const progressBps = cap > 0n ? Number(((cap - isa.remaining) * 10_000n) / cap) : 0;
  return {
    ...card,
    counterparty: isa.backer,
    capMult: isa.capMult,
    capAusd: cap,
    termEnd: Number(isa.termEnd),
    remainingAusd: isa.remaining,
    progressBps,
    status: isa.status,
  };
}

export function TermsCard(props: { card: DealCardModel; locale: Locale; lang?: MoneyLocale }) {
  const { card, locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const badge = statusLabel(card.status, locale);
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-ink">{locale.detail.termsTitle}</p>
        {badge !== "" ? <span className="text-xs font-semibold text-muted">{badge}</span> : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-muted">
          {locale.dealCard.shareLabel} {pctLabel(card.shareBps, lang)}
        </span>
        <span className="text-muted">
          {locale.dealCard.capLabel} {formatAusdDetail(card.capAusd, lang)}
        </span>
      </div>
      <div className="mt-1">
        <DealEnd card={card} locale={locale} />
      </div>
      <p className="mt-3 flex items-center gap-2 rounded-xl bg-leafsoft px-3 py-2.5 text-xs font-bold text-leafdk">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-leaf" />
        {locale.dealCard.failedHarvest}
      </p>
    </section>
  );
}

export function PanenHistory(props: {
  rows: PanenRow[];
  explorerBaseUrl: string;
  locale: Locale;
  lang?: MoneyLocale;
}) {
  const { locale } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  if (props.rows.length === 0) {
    return <p className="text-sm text-muted">{locale.detail.panenEmpty}</p>;
  }
  return (
    <section className="flex flex-col gap-3">
      {props.rows.map((row) => (
        <article
          key={row.txHash}
          className="rounded-2xl border border-leaf100 bg-leafsoft p-4 text-sm"
        >
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 font-bold text-leafdk">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-leaf" />
              {locale.detail.grossLabel} {formatAusdDetail(row.grossAusd, lang)}
            </span>
            <span className="text-xs text-muted">{row.blockTime.slice(0, 10)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-muted">
            <span>
              {locale.detail.toYouLabel} {formatAusdDetail(row.toSeekerAusd, lang)}
            </span>
            <span>
              {locale.detail.toBackerLabel} {formatAusdDetail(row.toBackerAusd, lang)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {locale.detail.remainingAfterLabel} {formatAusdDetail(row.remainingAfterAusd, lang)}
          </p>
          <a
            href={explorerTxUrl(props.explorerBaseUrl, row.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-leafdk underline"
          >
            {locale.detail.viewProof}
          </a>
        </article>
      ))}
    </section>
  );
}

export function BagiHasilDetail(props: {
  locale: Locale;
  lang?: MoneyLocale;
  api: ApiClient;
  profileId: string;
  isaId: number;
  reader?: ChainReader;
  quote?: Quote | null;
  onShare?(): void;
  onClose?(): void;
}) {
  const { locale, api, profileId, isaId } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const reader = props.reader ?? chainReader;
  const [detail, setDetail] = useState<DealDetailModel | null>(null);
  const [isa, setIsa] = useState<IsaOnChain | null>(null);
  const [score, setScore] = useState(0);
  const [offerAusd, setOfferAusd] = useState(0n);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dto = await api.profile(profileId);
        if (!alive) return;
        setExplorerBaseUrl(dto.explorerBaseUrl);
        setDetail(dealDetailFromProfile(dto, isaId, Date.now()));
        try {
          const live = await reader.isaOf(BigInt(isaId));
          if (!alive) return;
          setIsa(live);
          setScore(await reader.scoreOf(live.seeker));
          setOfferAusd(await reader.offerOf(live.seeker));
        } catch {
          if (alive) setIsa(null); // projection stands alone — honest degrade
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, profileId, isaId, reader]);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-muted">{locale.common.errorGeneric}</p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setDetail(null);
            setIsa(null);
          }}
          className="rounded-xl border border-line2 bg-white px-6 py-3 font-semibold text-ink shadow"
        >
          {locale.edge.retry}
        </button>
      </main>
    );
  }
  if (detail === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        {locale.edge.loading}
      </main>
    );
  }
  const card = isa !== null ? mergeIsa(detail.card, isa) : detail.card;
  const finish: FinishModel | null =
    isa !== null && (isa.status === 3 || isa.status === 4)
      ? finishFromDetail(isa, { score, offerAusd, fetchedAt: detail.fetchedAt })
      : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">{locale.detail.title}</h1>
      {finish !== null ? (
        <FinishView
          model={finish}
          locale={locale}
          lang={lang}
          quote={props.quote}
          onShare={props.onShare}
          onClose={props.onClose}
        />
      ) : null}
      <TermsCard card={card} locale={locale} lang={lang} />
      <h2 className="text-lg font-extrabold tracking-tight text-ink">{locale.detail.panenTitle}</h2>
      <PanenHistory
        rows={detail.panen}
        explorerBaseUrl={explorerBaseUrl}
        locale={locale}
        lang={lang}
      />
      {props.onClose ? (
        <button type="button" onClick={props.onClose} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      ) : null}
    </main>
  );
}

// T025 tests — the detail surface: terms card (the FR-004 elements), the
// per-panen rows with proof links, the chain-wins merge, and the replay
// FinishModel. Fixture numbers are TEST INPUTS (FR-022) — every expectation
// derives from them, never from a live source.
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ProfileDto } from "../../api/client.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { ChainReader, IsaOnChain } from "../../data/draft.js";
import type { DealCardModel, PanenRow } from "../../data/models.js";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import {
  BagiHasilDetail,
  finishFromDetail,
  mergeIsa,
  PanenHistory,
  TermsCard,
} from "./BagiHasilDetail.js";

const WALLET: `0x${string}` = `0x${"a1".repeat(20)}`;
const BACKER: `0x${string}` = `0x${"b2".repeat(20)}`;
const EXPLORER = "https://explorer.example";

const HASH_A: `0x${string}` = `0x${"c3".repeat(32)}`;
const HASH_B: `0x${string}` = `0x${"d4".repeat(32)}`;

const ROW_A: PanenRow = {
  grossAusd: 2_000_000n,
  toSeekerAusd: 307_200n,
  toBackerAusd: 1_692_800n,
  remainingAfterAusd: 11_000_000n,
  txHash: HASH_A,
  blockTime: "2026-10-01T09:00:00.000Z",
};
const ROW_B: PanenRow = { ...ROW_A, txHash: HASH_B, grossAusd: 1_000_000n };

const CARD: DealCardModel = {
  isaId: 9,
  seeker: WALLET,
  counterparty: "",
  principalAusd: 10_000_000n,
  shareBps: 1536,
  capMult: 0,
  capAusd: 13_000_000n,
  remainingAusd: 0n,
  progressBps: 10_000,
  termEnd: 0,
  status: 3,
  fetchedAt: 1,
};

const ISA: IsaOnChain = {
  isaId: 9n,
  principal: 10_000_000n,
  shareBps: 1536,
  capMult: 130,
  termEnd: 1_900_000_000n,
  channelId: 1n,
  seeker: WALLET,
  backer: BACKER,
  remaining: 0n,
  activatedAt: 1_700_000_000n,
  lastEventAt: 1_700_000_000n + 100n * 86_400n,
  eventCount: 2n,
  status: 3,
};

const DTO: ProfileDto = {
  id: "siti",
  wallet: WALLET,
  reputation: { score: 71, completedDeals: 1, qualEvents: 2 },
  deals: [
    {
      isaId: 9,
      principalAusd: 10_000_000,
      shareBps: 1536,
      capAusd: 13_000_000,
      totalDivertedAusd: 13_000_000,
      status: "completed_capped",
      events: [
        {
          grossAusd: 2_000_000,
          toSeekerAusd: 307_200,
          toBackerAusd: 1_692_800,
          remainingAusd: 11_000_000,
          txHash: HASH_A,
          blockTime: ROW_A.blockTime,
        },
        {
          grossAusd: 11_000_000,
          toSeekerAusd: 1_689_600,
          toBackerAusd: 9_310_400,
          remainingAusd: 0,
          txHash: HASH_B,
          blockTime: "2026-10-09T09:00:00.000Z",
        },
      ],
    },
  ],
  explorerBaseUrl: EXPLORER,
};

function fakeApi(dto: ProfileDto): ApiClient {
  return { profile: async () => dto } as unknown as ApiClient;
}

function makeReader(over: Partial<ChainReader> = {}): ChainReader {
  return {
    isaOf: async () => ISA,
    scoreOf: async () => 71,
    offerOf: async () => 8_000_000n,
    ...over,
  } as unknown as ChainReader;
}

describe("TermsCard (T025)", () => {
  it("renders the four elements: share, cap, end condition, failed-harvest line", () => {
    const html = renderToString(<TermsCard card={CARD} locale={id} lang="id" />).replaceAll(
      "<!-- -->",
      "",
    );
    expect(html).toContain(id.detail.termsTitle);
    expect(html).toContain(id.dealCard.shareLabel);
    expect(html).toContain(pctLabel(1536, "id"));
    expect(html).toContain(id.dealCard.capLabel);
    expect(html).toContain(formatAusdDetail(13_000_000n, "id"));
    expect(html).toContain(id.dealCard.endLabel);
    expect(html).toContain(id.dealCard.endByCap); // capped season ends at the cap
    expect(html).toContain(id.dealCard.failedHarvest);
    expect(html).toContain(id.dealCard.statusCapped); // the machine-status badge
  });

  it("a term-ended season names its day", () => {
    const term = { ...CARD, status: 4 as const, termEnd: 1_900_000_000 };
    const html = renderToString(<TermsCard card={term} locale={id} lang="id" />);
    expect(html).toContain(id.dealCard.endByTerm);
    expect(html).toContain("2030"); // 1_900_000_000 epoch seconds
  });
});

describe("PanenHistory (T025)", () => {
  it("each row: gross, to seeker, to backer, remaining after, proof link", () => {
    const html = renderToString(
      <PanenHistory rows={[ROW_A, ROW_B]} explorerBaseUrl={EXPLORER} locale={id} lang="id" />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.detail.grossLabel);
    expect(html).toContain(formatAusdDetail(2_000_000n, "id"));
    expect(html).toContain(formatAusdDetail(307_200n, "id"));
    expect(html).toContain(id.detail.toBackerLabel);
    expect(html).toContain(formatAusdDetail(1_692_800n, "id"));
    expect(html).toContain(id.detail.remainingAfterLabel);
    expect(html).toContain(formatAusdDetail(11_000_000n, "id"));
    expect(html).toContain(id.detail.viewProof);
    expect(html).toContain(`href="${EXPLORER}/tx/${ROW_A.txHash}"`);
    expect(html).toContain("2026-10-01"); // the row's day, not raw ISO noise
  });

  it("no rows says so — never an empty list pretending to be data", () => {
    const html = renderToString(
      <PanenHistory rows={[]} explorerBaseUrl={EXPLORER} locale={id} lang="id" />,
    );
    expect(html).toContain(id.detail.panenEmpty);
  });
});

describe("mergeIsa — the chain wins (T025)", () => {
  it("re-derives cap/remaining/progress/status/partner/termEnd from the ISA", () => {
    const merged = mergeIsa(CARD, ISA);
    expect(merged.counterparty).toBe(BACKER); // the DTO leaves it blank; the chain fills it
    expect(merged.capMult).toBe(130);
    expect(merged.capAusd).toBe(13_000_000n); // principal × capMult / 100
    expect(merged.remainingAusd).toBe(0n);
    expect(merged.progressBps).toBe(10_000);
    expect(merged.status).toBe(3);
    expect(merged.termEnd).toBe(1_900_000_000);
  });

  it("a partially harvested season derives its progress from remaining", () => {
    const merged = mergeIsa(CARD, { ...ISA, remaining: 3_900_000n, status: 2 });
    expect(merged.remainingAusd).toBe(3_900_000n);
    expect(merged.progressBps).toBe(7_000); // (13M − 3.9M) × 10000 / 13M
  });
});

describe("finishFromDetail (T025)", () => {
  it("a capped season replays as the celebration, rep flat", () => {
    const finish = finishFromDetail(ISA, { score: 71, offerAusd: 8_000_000n, fetchedAt: 1 });
    expect(finish.variant).toBe("capped");
    expect(finish.entry).toBe("replay");
    expect(finish.repBefore).toBe(71);
    expect(finish.repAfter).toBe(71); // a replay cannot reconstruct the before-score
    expect(finish.panenCount).toBe(2);
  });

  it("a term-ended season routes to the forgiveness face", () => {
    const term = finishFromDetail(
      { ...ISA, status: 4, remaining: 4_000_000n, lastEventAt: 1_900_000_000n },
      { score: 71, offerAusd: 1n, fetchedAt: 1 },
    );
    expect(term.variant).toBe("term");
    expect(term.totalDivertedAusd).toBe(9_000_000n); // cap − remaining, honest
  });
});

describe("BagiHasilDetail (T025)", () => {
  it("loads through the seam — the first paint is the loading state", () => {
    const html = renderToString(
      <BagiHasilDetail
        locale={id}
        api={fakeApi(DTO)}
        profileId="siti"
        isaId={9}
        reader={makeReader()}
      />,
    );
    expect(html).toContain(id.edge.loading);
  });
});

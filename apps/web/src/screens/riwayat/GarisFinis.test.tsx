// T024 tests — ONE FinishModel, two faces. The capped season celebrates
// (stats + teaser + share); the term season forgives quietly (recapBack /
// recapForgiven, no share action). finishFromIsa derives EVERYTHING from the
// contract's own ISA state — fixture numbers are TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { IsaOnChain } from "../../data/draft.js";
import type { FinishModel } from "../../data/models.js";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import { FinishView, finishFromIsa, GarisFinis } from "./GarisFinis.js";
import { TermForgiveness } from "./TermForgiveness.js";

const ISA: IsaOnChain = {
  isaId: 9n,
  principal: 10_000_000n,
  shareBps: 1536,
  capMult: 130,
  termEnd: 1_900_000_000n,
  channelId: 1n,
  seeker: `0x${"a1".repeat(20)}`,
  backer: `0x${"b2".repeat(20)}`,
  remaining: 0n,
  activatedAt: 1_700_000_000n,
  lastEventAt: 1_700_000_000n + 120n * 86_400n,
  eventCount: 7n,
  status: 3,
};

const CAPPED: FinishModel = finishFromIsa(ISA, {
  repBefore: 58,
  repAfter: 71,
  nextOfferAusd: 8_000_000n,
  entry: "live",
  fetchedAt: 1,
});

describe("finishFromIsa (T024)", () => {
  it("derives the recap from the ISA alone: panen, days, diverted, variant", () => {
    expect(CAPPED.variant).toBe("capped");
    expect(CAPPED.panenCount).toBe(7);
    expect(CAPPED.durationDays).toBe(120);
    expect(CAPPED.totalDivertedAusd).toBe(13_000_000n); // cap reached, 0 remaining
    expect(CAPPED.card.capAusd).toBe(13_000_000n);
    const term = finishFromIsa(
      { ...ISA, status: 4, remaining: 4_000_000n, lastEventAt: 1_900_000_000n },
      { repBefore: 58, repAfter: 60, nextOfferAusd: 1n, entry: "replay", fetchedAt: 1 },
    );
    expect(term.variant).toBe("term");
    expect(term.totalDivertedAusd).toBe(9_000_000n); // cap − remaining, honest
  });
});

describe("GarisFinis — the capped face (T024)", () => {
  it("celebrates: diverted headline, season stats, rep jump, teaser, share", () => {
    const html = renderToString(
      <GarisFinis
        model={CAPPED}
        locale={id}
        lang="id"
        quote={{ pair: "USD_IDR", rate: 16_500, scale: 1 }}
        onShare={() => {}}
        onClose={() => {}}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.moments.finishTitle);
    expect(html).toContain(formatAusdDetail(13_000_000n, "id"));
    expect(html).toContain(id.moments.seasonPanen);
    expect(html).toContain(id.moments.seasonDuration);
    expect(html).toContain(id.moments.repJump);
    expect(html).toContain("+13"); // 71 − 58
    expect(html).toContain(id.moments.nextOfferLabel);
    expect(html).toContain(formatAusdDetail(8_000_000n, "id")); // the frozen teaser pre-effect
    expect(html).toContain(id.moments.shareCta);
    expect(html).not.toContain(id.dukung.recapForgiven); // no forgiveness here
  });

  it("replay frames the same story as a past-season detail", () => {
    const replay = { ...CAPPED, entry: "replay" as const };
    const live = renderToString(<GarisFinis model={CAPPED} locale={id} onClose={() => {}} />);
    const framed = renderToString(<GarisFinis model={replay} locale={id} onClose={() => {}} />);
    expect(framed).toContain("max-w-md rounded-2xl"); // framed, not fixed full-screen
    expect(live).toContain("fixed inset-0 z-50");
  });

  it("hides the rep jump when the score did not move — replays stay honest", () => {
    // A replay cannot reconstruct the score before the season; a flat rep
    // must render NO jump row rather than a fabricated "+0".
    const flat = { ...CAPPED, repBefore: 71, repAfter: 71, entry: "replay" as const };
    const html = renderToString(<GarisFinis model={flat} locale={id} onClose={() => {}} />);
    expect(html).not.toContain(id.moments.repJump);
  });
});

describe("TermForgiveness — the subdued face (T024)", () => {
  const term = finishFromIsa(
    { ...ISA, status: 4, remaining: 4_000_000n },
    { repBefore: 58, repAfter: 60, nextOfferAusd: 1n, entry: "replay", fetchedAt: 1 },
  );

  it("forgives honestly: recapBack/recapForgiven with the real shortfall", () => {
    const html = renderToString(
      <TermForgiveness model={term} locale={id} lang="id" onClose={() => {}} />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.moments.forgiveBanner);
    expect(html).toContain(id.dukung.recapBack);
    expect(html).toContain(id.dukung.recapForgiven);
    expect(html).toContain(formatAusdDetail(9_000_000n, "id")); // came back
    expect(html).toContain(formatAusdDetail(13_000_000n, "id")); // of the target
    expect(html).toContain(id.moments.seasonPanen);
    expect(html).toContain(id.dealCard.endLabel);
    expect(html).toContain(id.common.continue);
  });

  it("FinishView routes by variant — no confetti face for the term season", () => {
    const routed = renderToString(
      <FinishView model={term} locale={id} onShare={() => {}} onClose={() => {}} />,
    );
    expect(routed).toContain(id.moments.forgiveBanner);
    expect(routed).not.toContain(id.moments.shareCta); // the party stays out
    const capped = renderToString(
      <FinishView model={CAPPED} locale={id} onShare={() => {}} onClose={() => {}} />,
    );
    expect(capped).toContain(id.moments.shareCta);
  });
});

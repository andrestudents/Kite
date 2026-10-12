// T021 tests — the moment renders the MomentModel and nothing else. Fixture
// numbers are TEST INPUTS (FR-022); the IDR headline only appears with a
// quote in hand (display-only, integer math inside lib/money).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { MomentModel } from "../../data/models.js";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import { SplitMoment } from "./SplitMoment.js";

const MOMENT: MomentModel = {
  grossAusd: 2_000_000n,
  toSeekerAusd: 1_690_000n,
  toBackerAusd: 310_000n,
  progressBeforeBps: 4500,
  progressAfterBps: 6900,
  remainingAfterAusd: 4_030_000n,
  fetchedAt: 1,
};

const render = (quote?: { pair: string; rate: number; scale: number } | null) =>
  renderToString(
    <SplitMoment moment={MOMENT} locale={id} lang="id" quote={quote} onDismiss={() => {}} />,
  );

describe("the split moment (T021)", () => {
  it("carries the whole MomentModel: gross, both cards, jump, remaining", () => {
    // SSR splits interpolations with <!-- --> markers — normalize first.
    const html = render().replaceAll("<!-- -->", "");
    expect(html).toContain(id.moments.splitTitle);
    expect(html).toContain(id.detail.grossLabel);
    expect(html).toContain(formatAusdDetail(MOMENT.grossAusd, "id"));
    expect(html).toContain(id.moments.toYouLabel);
    expect(html).toContain(formatAusdDetail(MOMENT.toSeekerAusd, "id"));
    expect(html).toContain(id.moments.toBackerLabel);
    expect(html).toContain(formatAusdDetail(MOMENT.toBackerAusd, "id"));
    expect(html).toContain("45% → 69%"); // the jump, integer floors
    expect(html).toContain(id.home.remainingLabel);
    expect(html).toContain(formatAusdDetail(MOMENT.remainingAfterAusd, "id"));
    expect(html).toContain(id.common.continue);
  });

  it("the rupiah headline is display-only and needs a quote; absent otherwise", () => {
    const withQuote = render({ pair: "USD_IDR", rate: 16_500, scale: 1 });
    expect(withQuote).toContain(id.home.idrPrefix);
    expect(withQuote).toContain(id.home.approx);
    const withoutQuote = render(null);
    expect(withoutQuote).not.toContain(id.home.idrPrefix);
    expect(withoutQuote).toContain(formatAusdDetail(MOMENT.grossAusd, "id"));
  });
});

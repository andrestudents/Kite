// T018 — the four-element checklist (FR-004): EVERY deal surface — Beranda's
// active card, the public profile's open request, the backer list's card —
// must render all four elements (share %, cap, failed-harvest line, end
// condition). If any surface drops one, this file fails. Catalog numbers are
// TEST INPUTS (FR-022); fixtures carry integral base units.
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { BackedRecord } from "../../data/backed.js";
import type { IsaOnChain } from "../../data/draft.js";
import type { DealCardModel } from "../../data/models.js";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import { BackedCardView } from "../dukung/BackedList.js";
import { OpenRequest } from "../profile/PublicProfile.js";
import { pctLabel } from "./Ajukan.js";
import { DealCard, DealEnd, shortAddress } from "./DealCard.js";

const SEEKER = "0xAaAa00112233445566778899AaBbCcDdEeFf0011";
const BACKER = "0xBbBb00112233445566778899AaBbCcDdEeFf0022";

const FIXTURE: DealCardModel = {
  isaId: 9,
  seeker: SEEKER,
  counterparty: BACKER,
  principalAusd: 10_000_000n,
  shareBps: 1536,
  capMult: 130,
  capAusd: 13_000_000n,
  remainingAusd: 3_000_000n,
  progressBps: 7692,
  termEnd: 0,
  status: 2,
  fetchedAt: 1,
};

/** The checklist itself — every deal surface must pass ALL of these. */
function expectFourElements(html: string): void {
  // (1) share %
  expect(html).toContain(id.dealCard.shareLabel);
  expect(html).toContain(pctLabel(FIXTURE.shareBps, "id"));
  // (2) cap
  expect(html).toContain(id.dealCard.capLabel);
  expect(html).toContain(formatAusdDetail(FIXTURE.capAusd, "id"));
  // (3) the failed-harvest line
  expect(html).toContain(id.dealCard.failedHarvest);
  // (4) the end condition
  expect(html).toContain(id.dealCard.endLabel);
  expect(html).toContain(id.dealCard.endByCap);
}

const record: BackedRecord = {
  seeker: SEEKER,
  isaId: 9,
  nickname: "Pak Slameto",
  purpose: "bibit padi",
  activatedAt: 3,
};

const isa: IsaOnChain = {
  isaId: 9n,
  principal: 10_000_000n,
  shareBps: 1536,
  capMult: 130,
  termEnd: 1_900_000_000n,
  channelId: 1n,
  seeker: SEEKER,
  backer: BACKER,
  remaining: 3_000_000n,
  activatedAt: 1_700_000_000n,
  lastEventAt: 1_700_000_000n,
  eventCount: 0n,
  status: 2,
};

describe("the deal card (T018)", () => {
  it("Beranda's active card shows all four elements + progress + partner", () => {
    const html = renderToString(<DealCard card={FIXTURE} locale={id} lang="id" />);
    expectFourElements(html);
    expect(html).toContain("76%"); // floor(7692/100) — integer math
    expect(html).toContain(shortAddress(BACKER));
  });

  it("the public profile's open request passes the same checklist", () => {
    const html = renderToString(<OpenRequest card={FIXTURE} locale={id} lang="id" />);
    expectFourElements(html);
  });

  it("the backer list's card passes the same checklist", () => {
    const backed = {
      record,
      isa,
      label: "Pak Slameto",
      stars: 3,
      completed: 2,
      receivedAusd: 10_000_000n,
      capAusd: 13_000_000n,
      progressBps: 7692,
      durationDays: 90,
    };
    const html = renderToString(<BackedCardView card={backed} locale={id} lang="id" />);
    expectFourElements(html);
  });

  it("a term-finished deal names its day; shortAddress trims long values", () => {
    const day = new Date(1_900_000_000 * 1000).toISOString().slice(0, 10);
    const html = renderToString(
      <DealEnd card={{ ...FIXTURE, status: 4, termEnd: 1_900_000_000 }} locale={id} />,
    );
    expect(html).toContain(id.dealCard.endByTerm);
    expect(html).toContain(day);
    expect(shortAddress(BACKER)).toBe("0xBbBb…0022");
    expect(shortAddress("0x12345678")).toBe("0x12345678");
  });
});

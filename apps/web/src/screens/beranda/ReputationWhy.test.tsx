// T027 tests — the score never stands bare: every number on the why-row is
// accompanied by its plain-words input label (FR-005). Fixture numbers are
// TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { HomeModel } from "../../data/models.js";
import { id } from "../../locales/id.js";
import { ReputationWhy } from "./ReputationWhy.js";

const REP: HomeModel["reputation"] = {
  score: 71,
  completed: 2,
  consistentPanen: 7,
  distinctBackers: 3,
  maxSupportAusd: 4_000_000n,
};

describe("ReputationWhy (T027)", () => {
  it("names every input in plain words beside its number", () => {
    const html = renderToString(<ReputationWhy reputation={REP} locale={id} />).replaceAll(
      "<!-- -->",
      "",
    );
    expect(html).toContain("71");
    expect(html).toContain(`2 ${id.rep.completedLabel}`);
    expect(html).toContain(`7 ${id.rep.consistentLabel}`);
    expect(html).toContain(`3 ${id.rep.backersLabel}`);
    expect(html).toContain(id.rep.title);
    expect(html).toContain(id.rep.hint);
  });

  it("zero inputs still render their labels — an empty history is honest", () => {
    const html = renderToString(
      <ReputationWhy
        reputation={{ ...REP, score: 0, completed: 0, consistentPanen: 0, distinctBackers: 0 }}
        locale={id}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(`0 ${id.rep.completedLabel}`);
    expect(html).toContain(`0 ${id.rep.consistentLabel}`);
    expect(html).toContain(`0 ${id.rep.backersLabel}`);
  });
});

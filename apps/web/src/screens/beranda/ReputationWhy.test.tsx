// T027 tests — the score never stands bare: every number on the why-row is
// accompanied by its plain-words input label (FR-005). Fixture numbers are
// TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import type { ReactElement } from "react";
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

/** First paint as visible text — SSR comments out, tags out (the numbers
 *  render inside <b> since the restyle; the words beside them are the point). */
function visibleText(el: ReactElement): string {
  return renderToString(el)
    .replaceAll("<!-- -->", "")
    .replace(/<[^>]+>/g, "");
}

describe("ReputationWhy (T027)", () => {
  it("names every input in plain words beside its number", () => {
    const text = visibleText(<ReputationWhy reputation={REP} locale={id} />);
    expect(text).toContain("71");
    expect(text).toContain(`2 ${id.rep.completedLabel}`);
    expect(text).toContain(`7 ${id.rep.consistentLabel}`);
    expect(text).toContain(`3 ${id.rep.backersLabel}`);
    expect(text).toContain(id.rep.title);
    expect(text).toContain(id.rep.hint);
    expect(text).toContain(id.home.maxSupportLabel);
  });

  it("zero inputs still render their labels — an empty history is honest", () => {
    const text = visibleText(
      <ReputationWhy
        reputation={{ ...REP, score: 0, completed: 0, consistentPanen: 0, distinctBackers: 0 }}
        locale={id}
      />,
    );
    expect(text).toContain(`0 ${id.rep.completedLabel}`);
    expect(text).toContain(`0 ${id.rep.consistentLabel}`);
    expect(text).toContain(`0 ${id.rep.backersLabel}`);
  });
});

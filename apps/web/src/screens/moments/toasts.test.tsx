// T022 tests — the projection (event → toast, backer only, dedupe-stable ids)
// and the stack render. Fixture numbers are TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import type { WatchEvent } from "../../watcher/watcher.js";
import { ToastStack, watchEventToasts } from "./toasts.js";

describe("watchEventToasts (T022)", () => {
  it("projects only backer events; income carries the delta + the jump", () => {
    const events: WatchEvent[] = [
      {
        kind: "split",
        side: "seeker",
        isaId: 9,
        deltaCount: 1,
        progressBeforeBps: 1000,
        progressAfterBps: 2000,
      },
      {
        kind: "split",
        side: "backer",
        isaId: 9,
        deltaCount: 1,
        progressBeforeBps: 1000,
        progressAfterBps: 2000,
        balanceDeltaAusd: 310_000n,
      },
      { kind: "completed", side: "backer", isaId: 9, variant: "capped" },
      { kind: "completed", side: "seeker", isaId: 9, variant: "term" },
    ];
    const toasts = watchEventToasts(events);
    expect(toasts).toEqual([
      {
        id: "income-9-1-2000",
        kind: "income",
        deltaAusd: 310_000n,
        progressBeforeBps: 1000,
        progressAfterBps: 2000,
      },
      { id: "done-9-capped", kind: "capped" },
    ]);
  });

  it("the same event never stacks twice — ids derive from content", () => {
    const e: WatchEvent = {
      kind: "split",
      side: "backer",
      isaId: 4,
      deltaCount: 2,
      progressBeforeBps: 1000,
      progressAfterBps: 3000,
    };
    const [first, second] = watchEventToasts([e, e]);
    expect(first?.id).toBe(second?.id);
    expect(first?.kind === "income" && first.deltaAusd === undefined).toBe(true);
  });

  it("a term completion maps to the plain close, not the celebration", () => {
    expect(
      watchEventToasts([{ kind: "completed", side: "backer", isaId: 2, variant: "term" }]),
    ).toEqual([{ id: "done-2-term", kind: "term" }]);
  });
});

describe("the toast stack (T022)", () => {
  it("renders the income figures, the capped party, and the plain close", () => {
    const html = renderToString(
      <ToastStack
        locale={id}
        lang="id"
        onDismiss={() => {}}
        toasts={[
          {
            id: "income-9-1-2000",
            kind: "income",
            deltaAusd: 310_000n,
            progressBeforeBps: 1000,
            progressAfterBps: 2000,
          },
          { id: "done-9-capped", kind: "capped" },
          { id: "done-8-term", kind: "term" },
        ]}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(`+${formatAusdDetail(310_000n, "id")}`);
    expect(html).toContain("10% → 20%");
    expect(html).toContain(id.dukung.toastCompleted);
    expect(html).toContain(id.moments.forgiveBanner);
    expect(html).toContain(id.common.continue);
  });

  it("an empty stack renders nothing at all", () => {
    expect(renderToString(<ToastStack locale={id} onDismiss={() => {}} toasts={[]} />)).toBe("");
  });
});

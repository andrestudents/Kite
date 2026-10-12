// T034 — the Bayar contract: the live-terms split renders BEFORE any pay
// action exists; paying latches; the settle action appears only when a
// submitter is injected and the row is paid — otherwise the console says
// honestly that settlement runs via the Demo Tool path.

import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { type MitraPurchaseRow, splitPreview } from "../../data/mitra.js";
import { id } from "../../locales/id.js";
import { shortAddress } from "../beranda/DealCard.js";
import { Bayar, BayarView } from "./Bayar.js";

const REF = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;

function row(over: Partial<MitraPurchaseRow>): MitraPurchaseRow {
  return {
    id: "pur-1",
    channelId: 1,
    isaId: 9,
    purchaseRef: REF,
    grossAusd: 1_000_000n,
    status: "PENDING",
    createdAt: "2026-10-12T00:00:00.000Z",
    ...over,
  };
}

const SPLIT = splitPreview(1_000_000n, { shareBps: 1536 });
const SUBMITTER = {
  submit: () => Promise.resolve({ status: "SETTLED", txHash: TX }),
};

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("BayarView", () => {
  test("the preview shows the exact contract split before anything else", () => {
    const html = renderToString(
      <BayarView
        row={row({})}
        split={SPLIT}
        locale={id}
        busy={false}
        latch={false}
        settleBusy={false}
        receipt={null}
      />,
    );
    expect(html).toContain(id.mitra.totalLabel);
    expect(html).toContain("1,00 AUSD");
    expect(html).toContain(id.mitra.toFarmerLabel);
    expect(html).toContain("0,15 AUSD");
    expect(html).toContain(id.mitra.toBackerLabel);
    expect(html).toContain("0,84 AUSD");
  });

  test("a pending row offers the pay action — and nothing beyond it", () => {
    const html = renderToString(
      <BayarView
        row={row({})}
        split={SPLIT}
        locale={id}
        busy={false}
        latch={false}
        settleBusy={false}
        receipt={null}
        onPay={() => {}}
      />,
    );
    expect(html).toContain(id.mitra.badge);
    expect(count(html, `>${id.mitra.markPaid}<`)).toBe(1);
    expect(html).not.toContain(id.mitra.settleCta);
    expect(html).not.toContain(id.mitra.unconfigured);
  });

  test("a paid row without a submitter names the Demo Tool path", () => {
    const html = renderToString(
      <BayarView
        row={row({ status: "PAID" })}
        split={SPLIT}
        locale={id}
        busy={false}
        latch={false}
        settleBusy={false}
        receipt={null}
      />,
    );
    expect(count(html, `>${id.mitra.markPaid}<`)).toBe(0);
    expect(html).toContain(id.mitra.unconfigured);
    expect(html).not.toContain(id.mitra.settleCta);
  });

  test("a paid row with an injected submitter offers settlement", () => {
    const html = renderToString(
      <BayarView
        row={row({ status: "PAID" })}
        split={SPLIT}
        locale={id}
        busy={false}
        latch={false}
        settleBusy={false}
        receipt={null}
        submitter={SUBMITTER}
      />,
    );
    expect(html).toContain(id.mitra.settleCta);
    expect(html).not.toContain(id.mitra.unconfigured);
  });

  test("a settled receipt shows the short proof", () => {
    const html = renderToString(
      <BayarView
        row={row({ status: "PAID" })}
        split={SPLIT}
        locale={id}
        busy={false}
        latch={false}
        settleBusy={false}
        receipt={{ status: "SETTLED", txHash: TX }}
        submitter={SUBMITTER}
      />,
    );
    expect(html).toContain(id.mitra.statusSettled);
    expect(html).toContain(shortAddress(TX));
  });

  test("the pay action latches: disabled once tapped", () => {
    const html = renderToString(
      <BayarView
        row={row({})}
        split={SPLIT}
        locale={id}
        busy={false}
        latch
        settleBusy={false}
        receipt={null}
        onPay={() => {}}
      />,
    );
    expect(html).toContain("disabled");
  });
});

describe("Bayar container", () => {
  test("first paint has no pay action — the live terms must land first", () => {
    const client = {
      list: () => Promise.reject(new Error("unused")),
      markPaid: () => Promise.reject(new Error("effects never run in SSR")),
    };
    const html = renderToString(<Bayar locale={id} row={row({})} client={client} />);
    expect(html).toContain(id.mitra.badge);
    expect(count(html, `>${id.mitra.markPaid}<`)).toBe(0);
  });

  test("a non-Kite row never reaches the pay flow", () => {
    const client = {
      list: () => Promise.reject(new Error("unused")),
      markPaid: () => Promise.reject(new Error("unused")),
    };
    const html = renderToString(
      <Bayar locale={id} row={row({ channelId: 2, isaId: 77 })} client={client} />,
    );
    expect(html).toContain(id.mitra.nonKiteRow);
    expect(html).not.toContain(id.mitra.totalLabel);
  });
});

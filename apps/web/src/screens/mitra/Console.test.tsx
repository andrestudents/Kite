// T033 — the console's contract: the Demo Tool badge is on the surface, the
// table carries Kite + non-Kite rows with catalog statuses (the raw registry
// word never renders), and only a Kite row still awaiting payment shows the
// Bayar action.

import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { MitraPurchaseRow } from "../../data/mitra.js";
import { id } from "../../locales/id.js";
import { shortAddress } from "../beranda/DealCard.js";
import { Console, ConsoleView } from "./Console.js";

const REF_A = `0x${"ab".repeat(32)}`;
const REF_B = `0x${"cd".repeat(32)}`;
const REF_C = `0x${"ef".repeat(32)}`;

function row(over: Partial<MitraPurchaseRow>): MitraPurchaseRow {
  return {
    id: "pur-x",
    channelId: 1,
    isaId: 9,
    purchaseRef: REF_A,
    grossAusd: 1_000_000n,
    status: "PENDING",
    createdAt: "2026-10-12T00:00:00.000Z",
    ...over,
  };
}

const ROWS: MitraPurchaseRow[] = [
  row({ id: "pur-1", purchaseRef: REF_A, status: "PENDING" }),
  row({ id: "pur-2", purchaseRef: REF_B, status: "SETTLED", txHash: `0x${"11".repeat(32)}` }),
  row({ id: "pur-3", purchaseRef: REF_C, channelId: 2, isaId: 77 }),
];

describe("ConsoleView", () => {
  const html = renderToString(<ConsoleView rows={ROWS} locale={id} onBayar={() => {}} />);

  test("the Demo Tool badge is visible on the surface", () => {
    expect(html).toContain(id.mitra.badge);
  });

  test("lists every row: Kite and non-Kite alike", () => {
    expect(html).toContain(shortAddress(REF_A));
    expect(html).toContain(shortAddress(REF_B));
    expect(html).toContain(shortAddress(REF_C));
  });

  test("statuses render from the catalogs — never the raw registry word", () => {
    expect(html).toContain(id.mitra.statusPending);
    expect(html).toContain(id.mitra.statusSettled);
    expect(html).not.toContain("PENDING");
  });

  test("a non-Kite row carries the outside-Kite label", () => {
    expect(html).toContain(id.mitra.nonKiteRow);
  });

  test("only the payable Kite row shows Bayar", () => {
    const taps = html.split(`>${id.mitra.bayarCta}<`).length - 1;
    expect(taps).toBe(1);
  });

  test("money renders in the exact AUSD detail form", () => {
    expect(html).toContain("1,00 AUSD");
  });
});

describe("Console container", () => {
  test("first paint is the loading face — the registry read lands in an effect", () => {
    const client = {
      list: () => Promise.reject(new Error("effects never run in SSR")),
      markPaid: () => Promise.reject(new Error("unused")),
    };
    const html = renderToString(<Console locale={id} client={client} />);
    expect(html).toContain(id.edge.loading);
    expect(html).not.toContain(id.mitra.title);
  });
});

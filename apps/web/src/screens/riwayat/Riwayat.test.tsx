// T029 tests — the sentRecords store (decimal-string discipline, corrupted
// rows skipped), the seam assembler (ONE merged latest-first feed from mixed
// sources, honest with zero sends), and the row projections. Fixture numbers
// are TEST INPUTS (FR-022).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ProfileDto } from "../../api/client.js";
import { riwayatFrom } from "../../data/assemble.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { SendRecord } from "../../data/models.js";
import { loadSentRecords, saveSentRecord } from "../../data/records.js";
import { formatAusdDetail } from "../../lib/money.js";
import { id } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import { shortAddress } from "../beranda/DealCard.js";
import { Riwayat, RiwayatRowView } from "./Riwayat.js";

const WALLET = `0x${"a1".repeat(20)}`;
const FRIEND = `0x${"e5".repeat(20)}`;
const EXPLORER = "https://explorer.example";
const HASH_A: `0x${string}` = `0x${"c3".repeat(32)}`;

const MEM = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
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
          blockTime: "2026-10-01T09:00:00.000Z",
        },
        {
          grossAusd: 11_000_000,
          toSeekerAusd: 1_689_600,
          toBackerAusd: 9_310_400,
          remainingAusd: 0,
          txHash: `0x${"d4".repeat(32)}`,
          blockTime: "2026-10-09T09:00:00.000Z",
        },
      ],
    },
    {
      isaId: 11,
      principalAusd: 4_000_000,
      shareBps: 1_000,
      capAusd: 5_200_000,
      totalDivertedAusd: 1_000_000,
      status: "active",
      events: [
        {
          grossAusd: 1_000_000,
          toSeekerAusd: 100_000,
          toBackerAusd: 900_000,
          remainingAusd: 4_200_000,
          txHash: `0x${"f6".repeat(32)}`,
          blockTime: "2026-10-10T09:00:00.000Z",
        },
      ],
    },
  ],
  explorerBaseUrl: EXPLORER,
};

const SEND: SendRecord = {
  to: FRIEND,
  valueAusd: 250_000n,
  at: Date.parse("2026-10-11T08:00:00.000Z"),
  txHash: `0x${"a7".repeat(32)}`,
};

describe("sentRecords store (T029)", () => {
  it("round-trips through decimal strings — bigint in storage never happens", () => {
    const storage = MEM();
    saveSentRecord(storage, SEND);
    saveSentRecord(storage, { ...SEND, valueAusd: 1_000n });
    const rows = loadSentRecords(storage);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.valueAusd).toBe(1_000n);
    expect(rows[0]?.to).toBe(FRIEND);
    const raw = storage.getItem("kite.v1.snapshots.sent") ?? "";
    expect(raw).toContain('"250000"'); // string on the wire, not a JSON number
  });

  it("a corrupted row is skipped, never thrown at the screen", () => {
    const storage = MEM();
    saveSentRecord(storage, SEND);
    storage.setItem(
      "kite.v1.snapshots.sent",
      (storage.getItem("kite.v1.snapshots.sent") ?? "").replace('"250000"', '"oops"'),
    );
    const rows = loadSentRecords(storage);
    expect(rows).toHaveLength(0);
  });
});

describe("riwayatFrom — the seam assembler (T029)", () => {
  it("merges income, completions and sends latest-first", () => {
    const model = riwayatFrom(DTO, [SEND], 1);
    // send (10-11) beats isa 11's panen (10-10), then isa 9's panen and the
    // completion TIE at 10-09 (stable sort keeps the income first — it was
    // pushed first), and the oldest panen (10-01) comes last.
    expect(model.rows.map((r) => r.kind)).toEqual([
      "send",
      "income",
      "income",
      "complete",
      "income",
    ]);
    const second = model.rows[1];
    expect(second !== undefined && second.kind === "income" ? second.panen.grossAusd : 0n).toBe(
      1_000_000n,
    );
  });

  it("works with an empty sends list — US4 fills it later", () => {
    const model = riwayatFrom(DTO, [], 1);
    expect(model.rows.every((r) => r.kind !== "send")).toBe(true);
    expect(model.rows.length).toBe(4);
  });

  it("a terminal deal yields exactly one completion row", () => {
    const model = riwayatFrom(DTO, [], 1);
    const completes = model.rows.filter((r) => r.kind === "complete");
    expect(completes).toHaveLength(1);
    const only = completes[0];
    expect(only !== undefined && only.kind === "complete" ? only.card.isaId : 0).toBe(9);
  });
});

describe("RiwayatRowView (T029)", () => {
  it("income: gross, my cut, proof link with the hash in the href only", () => {
    const model = riwayatFrom(DTO, [], 1);
    const income = model.rows.find((r) => r.kind === "income" && r.panen.grossAusd === 2_000_000n);
    if (income === undefined || income.kind !== "income") throw new Error("fixture broke");
    const html = renderToString(
      <RiwayatRowView row={income} explorerBaseUrl={EXPLORER} locale={id} lang="id" />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.riwayat.incomeLabel);
    expect(html).toContain(formatAusdDetail(2_000_000n, "id"));
    expect(html).toContain(formatAusdDetail(307_200n, "id"));
    expect(html).toContain(`href="${EXPLORER}/tx/${HASH_A}"`);
    expect(html.split(HASH_A).length - 1).toBe(1); // the hash lives ONLY in the href
  });

  it("send: value, short recipient, day; proof link only when a hash exists", () => {
    const html = renderToString(
      <RiwayatRowView
        row={{ kind: "send", send: SEND }}
        explorerBaseUrl={EXPLORER}
        locale={id}
        lang="id"
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.riwayat.sendLabel);
    expect(html).toContain(formatAusdDetail(250_000n, "id"));
    expect(html).toContain(shortAddress(FRIEND));
    expect(html).toContain(`href="${EXPLORER}/tx/${SEND.txHash}"`);
    const bare = renderToString(
      <RiwayatRowView
        row={{ kind: "send", send: { ...SEND, txHash: undefined } }}
        explorerBaseUrl={EXPLORER}
        locale={id}
        lang="id"
      />,
    );
    expect(bare).not.toContain(id.riwayat.viewProof);
  });

  it("complete: the deal opens the detail — cap context, no bare number", () => {
    const model = riwayatFrom(DTO, [], 1);
    const done = model.rows.find((r) => r.kind === "complete");
    if (done === undefined || done.kind !== "complete") throw new Error("fixture broke");
    const html = renderToString(
      <RiwayatRowView
        row={done}
        explorerBaseUrl={EXPLORER}
        locale={id}
        lang="id"
        onOpen={() => {}}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain(id.riwayat.completeLabel);
    expect(html).toContain(formatAusdDetail(10_000_000n, "id"));
    expect(html).toContain(id.dealCard.capLabel);
    expect(html).toContain(pctLabel(1536, "id"));
    expect(html).toContain(id.detail.title); // the hand-off CTA
  });
});

describe("Riwayat (T029)", () => {
  it("first paint is the loading state — the feed arrives from the seam", () => {
    const html = renderToString(
      <Riwayat
        locale={id}
        api={{ profile: async () => DTO } as unknown as ApiClient}
        storage={MEM()}
        wallet={WALLET}
      />,
    );
    expect(html).toContain(id.edge.loading);
  });
});

// T015 — the public profile's proof: the ajukan param is TEXT ONLY (React
// escaping — no HTML ever arrives from the URL), stars/status/proof helpers
// stay catalog- and clamp-honest, the receive-code QR is cache-first, and
// per-deal panen rows ride the profile model for the explorer links.
// Fixture numbers are TEST INPUTS (FR-022).

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { StorageLike } from "../../auth/session.js";
import { profileFromDto } from "../../data/assemble.js";
import type { ApiClient, ProfileDto } from "../../data/bootstrap.js";
import { loadReceiveCode, type QRPort, receiveCodeDataUrl } from "../../data/qr.js";
import { id } from "../../locales/id.js";
import {
  AjukanContext,
  explorerTxUrl,
  PublicProfile,
  readAjukanParam,
  starsLabel,
  statusLabel,
} from "./PublicProfile.js";

const FIXTURE: ProfileDto = {
  id: "budi-hash",
  wallet: "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD",
  reputation: { score: 58, completedDeals: 2, qualEvents: 11 },
  deals: [
    {
      isaId: 7,
      principalAusd: 300_000_000,
      shareBps: 1536,
      capAusd: 390_000_000,
      totalDivertedAusd: 390_000_000,
      status: "completed_capped",
      events: [
        {
          grossAusd: 200_000_000,
          toBackerAusd: 30_720_000,
          toSeekerAusd: 169_280_000,
          remainingAusd: 0,
          txHash: `0x${"aa".repeat(32)}`,
          blockTime: "2026-10-01T02:00:00.000Z",
        },
      ],
    },
  ],
  explorerBaseUrl: "https://testnet.monadscan.com",
};

describe("profile helpers (T015)", () => {
  it("the ajukan param decodes, trims, and caps at the input's 140", () => {
    expect(readAjukanParam("?ajukan=bibit%20padi")).toBe("bibit padi");
    expect(readAjukanParam("")).toBe("");
    expect(readAjukanParam("?other=1")).toBe("");
    expect(readAjukanParam(`?ajukan=${"x".repeat(200)}`)).toHaveLength(140);
  });

  it("the proof link is the explorer base plus the hash", () => {
    expect(explorerTxUrl("https://testnet.monadscan.com/", `0x${"aa".repeat(32)}`)).toBe(
      `https://testnet.monadscan.com/tx/0x${"aa".repeat(32)}`,
    );
  });

  it("stars clamp to 0–5", () => {
    expect(starsLabel(3)).toBe("★★★☆☆");
    expect(starsLabel(-1)).toBe("☆☆☆☆☆");
    expect(starsLabel(9)).toBe("★★★★★");
  });

  it("machine statuses render the catalog's labels; 0 renders empty", () => {
    expect(statusLabel(1, id)).toBe(id.dealCard.statusDrafted);
    expect(statusLabel(2, id)).toBe(id.dealCard.statusActive);
    expect(statusLabel(3, id)).toBe(id.dealCard.statusCapped);
    expect(statusLabel(4, id)).toBe(id.dealCard.statusTerm);
    expect(statusLabel(5, id)).toBe(id.dealCard.statusCancelled);
    expect(statusLabel(0, id)).toBe("");
  });

  it("per-deal panen rows ride the profile model (explorer links anchor there)", () => {
    const model = profileFromDto(FIXTURE, 1_795_000_000_000);
    expect(model.deals[0]?.panen).toHaveLength(1);
    expect(model.deals[0]?.panen?.[0]?.txHash).toBe(`0x${"aa".repeat(32)}`);
  });
});

describe("the ajukan context is text only (T015, T005)", () => {
  it("a hostile URL payload renders escaped — never as markup", () => {
    const html = renderToString(
      <AjukanContext locale={id} text={'<img src=x onerror="alert(1)">'} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function fakeQr(counts: { calls: number }): QRPort {
  return {
    async toDataURL(text) {
      counts.calls += 1;
      return `data:image/png;base64,${Buffer.from(text).toString("base64")}`;
    },
  };
}

describe("the receive code (T015)", () => {
  it("caches by URL — a revisit never re-encodes; a new profile does", async () => {
    const storage = new MemStorage();
    const counts = { calls: 0 };
    const qr = fakeQr(counts);
    const first = await receiveCodeDataUrl(storage, qr, "https://app.example", "abc");
    const again = await receiveCodeDataUrl(storage, qr, "https://app.example", "abc");
    expect(again).toBe(first);
    expect(counts.calls).toBe(1);
    await receiveCodeDataUrl(storage, qr, "https://app.example", "other");
    expect(counts.calls).toBe(2);
  });

  it("corrupt cache bytes re-encode instead of crashing", async () => {
    const storage = new MemStorage();
    storage.setItem("kite.v1.receiveCodeCache", "{not json");
    expect(loadReceiveCode(storage)).toBeNull();
    const counts = { calls: 0 };
    const dataUrl = await receiveCodeDataUrl(storage, fakeQr(counts), "https://app.example", "abc");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(counts.calls).toBe(1);
  });
});

describe("the PublicProfile screen (T015)", () => {
  it("first paint is the honest loading state straight from the catalog", () => {
    const html = renderToString(
      <PublicProfile
        locale={id}
        api={{ profile: async () => FIXTURE } as unknown as ApiClient}
        storage={new MemStorage()}
        profileId="budi-hash"
        origin="https://app.example"
        qr={fakeQr({ calls: 0 })}
      />,
    );
    expect(html).toContain("Sebentar ya…");
  });
});

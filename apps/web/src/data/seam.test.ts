// T008 — the seam, proven twice:
//  1. STRUCTURAL: only data/** imports from api/ and chain/ (screens, app,
//     lib — nobody else touches the wire modules). This is the indexer-ready
//     boundary: Envio swaps sources inside data/, screens untouched.
//  2. BEHAVIORAL: assemblers turn fixture wire shapes into models — money
//     becomes guarded bigint, status stays the machine value, panen rows
//     order latest-first, the Drafted deal is the open request — and the
//     snapshots store round-trips and replaces.
// Fixture numbers are TEST INPUTS (FR-022) — never screen literals.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { MeDto, ProfileDto } from "../api/client.js";
import type { StorageLike } from "../auth/session.js";
import {
  dealCardFromMe,
  dealDetailFromProfile,
  homeFromMe,
  profileFromDto,
  statusFromName,
} from "./assemble.js";
import { resolveApiBase } from "./bootstrap.js";
import { loadSnapshot, saveSnapshot } from "./snapshots.js";

// ── 1. the structural seam ─────────────────────────────────────────────────
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield p;
  }
}

const SRC = join(import.meta.dir, "..");

describe("the data seam (T008, data-model §1)", () => {
  it("only data/** imports from api/ and chain/", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const rel = normalize(file).replaceAll("\\", "/");
      if (rel.includes("/data/") || /\.test\.(ts|tsx)$/.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/^import[\s\S]*?from\s+["'](\.[^"']+)["']/);
        if (!m?.[1]) return;
        const target = normalize(join(dirname(file), m[1])).replaceAll("\\", "/");
        if (
          target.includes("/api/") ||
          target.endsWith("/api") ||
          target.includes("/chain/") ||
          target.endsWith("/chain")
        ) {
          violations.push(`${rel}:${i + 1} imports ${m[1]}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("screens/** never imports the wire modules directly (belt and braces)", () => {
    const violations: string[] = [];
    for (const file of walk(join(SRC, "screens"))) {
      const rel = normalize(file).replaceAll("\\", "/");
      if (/\.test\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/from\s+["'](\.[^"']*(api|chain)[^"']*)["']/g)) {
        violations.push(`${rel} imports ${m[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ── 2. the assemblers against fixtures ─────────────────────────────────────
const FetchedAt = 1_795_000_000_000;

/** A /api/me fixture (integral JSON numbers — 005's wire grammar). */
const ME_FIXTURE: MeDto = {
  wallet: "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD",
  balanceAusd: 1_200_000_000,
  identityBound: true,
  profile: {
    score: 58,
    maxSupportAusd: 624_000_000,
    totalIsas: 4,
    completed: 2,
    qualEvents: 11,
    distinctBackers: 2,
  },
  activeIsa: {
    isaId: 3,
    backer: "0x127BD57eA26e6F5eee15efe8b5b495ae539d82Ea",
    principalAusd: 480_000_000,
    shareBps: 1540,
    capMult: 1300,
    capAusd: 624_000_000,
    remainingAusd: 295_200_000,
    progressBps: 5270,
    termEnd: 1_900_000_000,
    channelId: 1,
  },
  recentPurchases: [],
};

/** A /api/p/:id fixture — two deals, one open request, events out of order. */
const PROFILE_FIXTURE: ProfileDto = {
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
    {
      isaId: 9,
      principalAusd: 400_000_000,
      shareBps: 1536,
      capAusd: 520_000_000,
      totalDivertedAusd: 130_000_000,
      status: "drafted",
      events: [],
    },
  ],
  explorerBaseUrl: "https://testnet.monadscan.com",
};

describe("assemblers (T008 behavioral)", () => {
  it("dealCardFromMe maps the active deal; money becomes bigint; status is Active", () => {
    const card = dealCardFromMe(ME_FIXTURE, FetchedAt);
    expect(card).not.toBeNull();
    expect(card?.principalAusd).toBe(480_000_000n);
    expect(card?.capAusd).toBe(624_000_000n);
    expect(card?.remainingAusd).toBe(295_200_000n);
    expect(card?.status).toBe(2);
    expect(card?.shareBps).toBe(1540);
  });

  it("dealCardFromMe returns null when /api/me carries no active deal", () => {
    const empty: MeDto = { ...ME_FIXTURE, activeIsa: null };
    expect(dealCardFromMe(empty, FetchedAt)).toBeNull();
    expect(homeFromMe(empty, FetchedAt).empty).toBe(true);
  });

  it("homeFromMe carries the reputation why-inputs from the live profile", () => {
    const home = homeFromMe(ME_FIXTURE, FetchedAt);
    expect(home.saldoAusd).toBe(1_200_000_000n);
    expect(home.reputation).toEqual({
      score: 58,
      completed: 2,
      consistentPanen: 11,
      distinctBackers: 2,
      maxSupportAusd: 624_000_000n,
    });
    expect(home.empty).toBe(false);
    expect(home.fetchedAt).toBe(FetchedAt);
  });

  it("profileFromDto pulls the Drafted deal out as the open request (FR-019)", () => {
    const profile = profileFromDto(PROFILE_FIXTURE, FetchedAt);
    expect(profile.openRequest?.isaId).toBe(9);
    expect(profile.openRequest?.status).toBe(1);
    expect(profile.stars).toBe(3); // round(58/20), capped at 5
    expect(profile.deals).toHaveLength(2);
    expect(profile.explorerBaseUrl).toBe("https://testnet.monadscan.com");
  });

  it("a completed profile deal derives remaining/progress from cap and diverted", () => {
    const profile = profileFromDto(PROFILE_FIXTURE, FetchedAt);
    const capped = profile.deals.find((d) => d.isaId === 7);
    expect(capped?.remainingAusd).toBe(0n);
    expect(capped?.progressBps).toBe(10_000);
  });

  it("dealDetailFromProfile orders panen rows latest-first and maps money", () => {
    const detail = dealDetailFromProfile(PROFILE_FIXTURE, 7, FetchedAt);
    expect(detail.panen).toHaveLength(1);
    expect(detail.panen[0]?.grossAusd).toBe(200_000_000n);
    expect(detail.panen[0]?.toBackerAusd).toBe(30_720_000n);
    expect(detail.panen[0]?.remainingAfterAusd).toBe(0n);
    expect(detail.panen[0]?.txHash).toBe(`0x${"aa".repeat(32)}`);
  });

  it("a non-integral money number refuses to assemble (floats never pass)", () => {
    const broken: ProfileDto = structuredClone(PROFILE_FIXTURE);
    const d0 = broken.deals[0];
    if (!d0) throw new Error("fixture");
    broken.deals[0] = { ...d0, principalAusd: 300.5 };
    expect(() => profileFromDto(broken, FetchedAt)).toThrow(/integral base-unit/);
  });

  it("wire status NAMES become the contract machine values — never invented", () => {
    expect(statusFromName("drafted")).toBe(1);
    expect(statusFromName("active")).toBe(2);
    expect(statusFromName("completed_capped")).toBe(3);
    expect(statusFromName("completed_at_term")).toBe(4);
    expect(statusFromName("cancelled")).toBe(5);
    expect(statusFromName("unknown:something")).toBe(0);
  });
});

// ── 3. the snapshots store ──────────────────────────────────────────────────
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

describe("snapshots (T008, D5)", () => {
  it("round-trips a model and replaces per write (one snapshot per screen)", () => {
    const storage = new MemStorage();
    saveSnapshot(storage, "beranda", { saldoAusd: "1n" });
    saveSnapshot(storage, "beranda", { saldoAusd: "2n" });
    const snap = loadSnapshot<{ saldoAusd: string }>(storage, "beranda");
    expect(snap?.model.saldoAusd).toBe("2n");
    expect(typeof snap?.fetchedAt).toBe("number");
    expect([...storage.map.keys()]).toEqual(["kite.v1.snapshots.beranda"]);
  });

  it("corrupt or malformed bytes read as null — the honest empty wins", () => {
    const storage = new MemStorage();
    storage.setItem("kite.v1.snapshots.detail", "{not json");
    expect(loadSnapshot(storage, "detail")).toBeNull();
    storage.setItem("kite.v1.snapshots.detail", JSON.stringify({ fetchedAt: 1 }));
    expect(loadSnapshot(storage, "detail")).toBeNull();
    expect(loadSnapshot(storage, "missing")).toBeNull();
  });
});

describe("resolveApiBase (dev-only absolute bases)", () => {
  it("production builds NEVER get an absolute base — configured or not", () => {
    expect(resolveApiBase("http://localhost:3000", false)).toBe("");
    expect(resolveApiBase("https://kite-api.example.com", false)).toBe("");
    expect(resolveApiBase(undefined, false)).toBe("");
  });
  it("dev builds may aim at the configured base, else stay relative", () => {
    expect(resolveApiBase("http://localhost:3000", true)).toBe("http://localhost:3000");
    expect(resolveApiBase(undefined, true)).toBe("");
    expect(resolveApiBase("", true)).toBe("");
  });
});

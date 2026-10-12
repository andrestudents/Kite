// T020 — the settlement watcher (research D1): TWO feeds behind ONE module.
// The seeker feed polls /api/me (activeIsa progress/remaining + settled
// purchase rows); the backer feed polls the chain directly — isaOf per backed
// ISA (eventCount = the contract's own panen count) plus balanceOf. Cadence
// ≤ 1.5 s while the tab is visible, paused when hidden, ONE immediate
// catch-up pass on visibility-return. Delivery dedupes through device-local
// watermarks `kite.v1.watermarks` — a settlement missed while hidden still
// fires exactly once (a settledCount jump > 1 becomes ONE event carrying the
// jump, never stacked moments). Polling only — no WS dependency. The chain
// stays the authority; this module only NOTICES deltas.
import type { StorageLike } from "../auth/session.js";
import { loadBackedRecords } from "../data/backed.js";
import type { ApiClient, MeDto } from "../data/bootstrap.js";
import type { ChainReader, HexAddress, IsaOnChain } from "../data/draft.js";
import { capOf } from "../data/draft.js";

export const WATERMARKS_KEY = "kite.v1.watermarks";
export const DEFAULT_POLL_MS = 1_500;

/** The per-ISA delivery watermark. `status` and `side` ride along (optional)
 *  so a live → terminal transition fires exactly once and each feed only
 *  ever touches its OWN entries; the stored JSON keeps the three pinned
 *  fields at its core. */
export interface Watermark {
  progressBps: number;
  settledCount: number;
  blockTime: string;
  status?: number;
  side?: "seeker" | "backer";
}

export interface SplitDetected {
  kind: "split";
  side: "seeker" | "backer";
  isaId: number;
  /** panen since the last watermark — ≥ 2 means "summary", never stacked. */
  deltaCount: number;
  progressBeforeBps: number;
  progressAfterBps: number;
  /** The backer's wallet delta when the same pass saw one (T022's toast). */
  balanceDeltaAusd?: bigint;
}

export interface CompletedDetected {
  kind: "completed";
  side: "seeker" | "backer";
  isaId: number;
  variant: "capped" | "term";
}

export type WatchEvent = SplitDetected | CompletedDetected;

/** Injectable time — tests drive the loop by hand. */
export interface WatcherClock {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
}

export const defaultClock: WatcherClock = {
  now: () => Date.now(),
  schedule(fn, ms) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export function defaultVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// ── pure watermark math (fixture-testable) ──────────────────────────────────

function settledRows(me: MeDto): Array<{ settledAt?: unknown }> {
  return me.recentPurchases.filter(
    (p) => (p as { status?: unknown }).status === "settled",
  ) as Array<{ settledAt?: unknown }>;
}

/** The seeker feed's watermark: /api/me's active deal + its settled rows. */
export function watermarkFromMe(me: MeDto): [number, Watermark] | null {
  const isa = me.activeIsa;
  if (isa === null) return null;
  const rows = settledRows(me);
  const last = rows[rows.length - 1];
  const blockTime = typeof last?.settledAt === "string" ? last.settledAt : "";
  return [
    isa.isaId,
    { progressBps: isa.progressBps, settledCount: rows.length, blockTime, side: "seeker" },
  ];
}

/** The backer feed's watermark: contract-owned numbers only. */
export function watermarkFromIsa(isa: IsaOnChain): Watermark {
  const cap = capOf(isa.principal, isa.capMult);
  const received = isa.remaining >= cap ? 0n : cap - isa.remaining;
  return {
    progressBps: cap > 0n ? Number((received * 10_000n) / cap) : 0,
    settledCount: Number(isa.eventCount),
    blockTime: isa.lastEventAt > 0n ? new Date(Number(isa.lastEventAt) * 1000).toISOString() : "",
    status: isa.status,
    side: "backer",
  };
}

/** The delivery rule: first sight baselines (never fires); a settledCount or
 *  progress increase fires exactly once per pass with the full jump. */
export function diffWatermark(
  prev: Watermark | undefined,
  next: Watermark,
): { fires: boolean; deltaCount: number } {
  if (!prev) return { fires: false, deltaCount: 0 };
  const deltaCount = Math.max(0, next.settledCount - prev.settledCount);
  const fires = deltaCount > 0 || next.progressBps > prev.progressBps;
  return { fires, deltaCount: Math.max(1, deltaCount) };
}

// ── the loop ────────────────────────────────────────────────────────────────

export interface WatcherOptions {
  api: ApiClient;
  reader: ChainReader;
  storage: StorageLike;
  /** the backer feed runs only when the device backs someone */
  backerAddress?: HexAddress;
  onEvent(event: WatchEvent): void;
  clock?: WatcherClock;
  visible?: () => boolean;
  pollMs?: number;
}

export interface WatcherHandle {
  stop(): void;
  /** one manual pass — the loop calls this too (tests drive it directly) */
  pollOnce(): Promise<void>;
}

export function startWatcher(options: WatcherOptions): WatcherHandle {
  const {
    api,
    reader,
    storage,
    backerAddress,
    onEvent,
    clock = defaultClock,
    visible = defaultVisible,
    pollMs = DEFAULT_POLL_MS,
  } = options;

  let stopped = false;
  let cancel: (() => void) | null = null;
  let lastBalance: bigint | null = null;

  function loadMarks(): Record<string, Watermark> {
    const raw = storage.getItem(WATERMARKS_KEY);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return {};
      return parsed as Record<string, Watermark>;
    } catch {
      return {}; // corrupt bytes are no watermark — baseline again
    }
  }

  function saveMarks(marks: Record<string, Watermark>): void {
    storage.setItem(WATERMARKS_KEY, JSON.stringify(marks));
  }

  /** One feed sample → events + watermark bookkeeping. */
  function apply(
    marks: Record<string, Watermark>,
    side: "seeker" | "backer",
    isaId: number,
    next: Watermark,
    balanceDeltaAusd?: bigint,
  ): void {
    const key = String(isaId);
    const prev = marks[key];
    if (!prev) {
      marks[key] = next;
      return;
    }
    const { fires, deltaCount } = diffWatermark(prev, next);
    if (fires) {
      onEvent({
        kind: "split",
        side,
        isaId,
        deltaCount,
        progressBeforeBps: prev.progressBps,
        progressAfterBps: next.progressBps,
        ...(balanceDeltaAusd !== undefined ? { balanceDeltaAusd } : {}),
      });
    }
    // Only a LIVE transition completes; a first-sight terminal ISA is replay
    // material (T024), not a moment.
    if ((next.status === 3 || next.status === 4) && prev.status === 2) {
      onEvent({
        kind: "completed",
        side,
        isaId,
        variant: next.progressBps >= 10_000 ? "capped" : "term",
      });
    }
    marks[key] = next;
  }

  async function pollOnce(): Promise<void> {
    const marks = loadMarks();
    let changed = false;

    // seeker feed — the API projection (005)
    try {
      const me = await api.me();
      const w = watermarkFromMe(me);
      if (w === null) {
        // The deal left /api/me — a live deal just finished: say so once,
        // then drop the watermark (the next deal starts a fresh baseline).
        // ONLY seeker-side entries count — the backer feed owns its own.
        const finished = Object.entries(marks).find(
          ([, m]) => m.side === "seeker" || (m.side === undefined && m.status === undefined),
        );
        if (finished) {
          onEvent({
            kind: "completed",
            side: "seeker",
            isaId: Number(finished[0]),
            variant: finished[1].progressBps >= 10_000 ? "capped" : "term",
          });
          delete marks[finished[0]];
          changed = true;
        }
      } else {
        const key = String(w[0]);
        const before = JSON.stringify(marks[key] ?? null);
        apply(marks, "seeker", w[0], w[1]);
        if (JSON.stringify(marks[key]) !== before) changed = true;
      }
    } catch {
      // a failed poll notices nothing — the next pass retries
    }

    // backer feed — the chain itself
    if (backerAddress) {
      try {
        const records = loadBackedRecords(storage);
        const samples = await Promise.all(
          records.map((r) =>
            reader
              .isaOf(BigInt(r.isaId))
              .then((isa) => ({ isaId: r.isaId, isa }))
              .catch(() => null),
          ),
        );
        const balance = await reader.balanceAusd(backerAddress).catch(() => null);
        // the wallet delta rides the FIRST backer split of this pass
        let pendingDelta: bigint | undefined =
          balance !== null && lastBalance !== null && balance > lastBalance
            ? balance - lastBalance
            : undefined;
        for (const s of samples) {
          if (s === null) continue;
          const key = String(s.isaId);
          const before = JSON.stringify(marks[key] ?? null);
          const delta = pendingDelta;
          apply(marks, "backer", s.isaId, watermarkFromIsa(s.isa), delta);
          if (JSON.stringify(marks[key]) !== before) {
            changed = true;
            pendingDelta = undefined;
          }
        }
        if (balance !== null) lastBalance = balance;
      } catch {
        // next pass
      }
    }

    if (changed) saveMarks(marks);
  }

  function loop(): void {
    if (stopped || !visible()) return;
    cancel = clock.schedule(() => {
      void pollOnce().then(() => {
        if (!stopped) loop();
      });
    }, pollMs);
  }

  function onVisibility(): void {
    if (stopped || !visible()) return;
    if (cancel) cancel();
    // ONE immediate catch-up pass, then the normal cadence resumes.
    void pollOnce().then(() => {
      if (!stopped) loop();
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  void pollOnce().then(() => loop());

  return {
    stop() {
      stopped = true;
      if (cancel) cancel();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
    pollOnce,
  };
}

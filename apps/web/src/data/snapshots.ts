// T008 — the snapshots store (data-model §3, research D5): the last
// successful render per screen under `kite.v1.snapshots.<screen>`, replaced
// per write (one snapshot per key, never appended). Offline display only —
// stale-labeled, actions disabled (FR-020); never money-critical.
import type { StorageLike } from "../auth/session.js";

const PREFIX = "kite.v1.snapshots.";

export interface Snapshot<T> {
  model: T;
  fetchedAt: number;
}

export function saveSnapshot<T>(storage: StorageLike, screen: string, model: T): void {
  const snap: Snapshot<T> = { model, fetchedAt: Date.now() };
  storage.setItem(PREFIX + screen, JSON.stringify(snap));
}

export function loadSnapshot<T>(storage: StorageLike, screen: string): Snapshot<T> | null {
  const raw = storage.getItem(PREFIX + screen);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { model?: unknown; fetchedAt?: unknown };
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!parsed.model || typeof parsed.fetchedAt !== "number") return null;
    return { model: parsed.model as T, fetchedAt: parsed.fetchedAt };
  } catch {
    return null; // corrupt bytes are no snapshot — the honest empty state wins
  }
}

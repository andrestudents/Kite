// T016/T017 — the backed-list store (data-model §3): device-local records of
// deals THIS device's backer activated, written at the Dukung confirmation.
// The chain stays the ONLY authority for numbers and status — these records
// supply discovery (the isaIds to reconcile) and warmth (optional label +
// the request's purpose). Device loss loses labels (disclosed, TRUST.md).
import type { StorageLike } from "../auth/session.js";
import { loadSnapshot, saveSnapshot } from "./snapshots.js";

export interface BackedRecord {
  seeker: string;
  isaId: number;
  /** ≤ 40 chars at the input; empty ⇒ the derived label wins (FR-017). */
  nickname?: string;
  /** The request's purpose — rides the share link, never onchain. */
  purpose?: string;
  activatedAt: number;
}

const BACKED_KEY = "backedList";

export function loadBackedRecords(storage: StorageLike): BackedRecord[] {
  return loadSnapshot<BackedRecord[]>(storage, BACKED_KEY)?.model ?? [];
}

export function saveBackedRecord(storage: StorageLike, record: BackedRecord): void {
  const rows = loadBackedRecords(storage).filter((r) => r.isaId !== record.isaId);
  rows.push(record);
  saveSnapshot(storage, BACKED_KEY, rows);
}

/** The derived label (FR-017): the purpose if the backer left the field
 *  empty, else "Petani · <short id>" — DERIVED, never a fabricated name. */
export function derivedLabel(seeker: string, purpose?: string): string {
  const p = (purpose ?? "").trim();
  if (p !== "") return p.slice(0, 40);
  const short = seeker.replace(/^0x/i, "").toLowerCase().slice(0, 6);
  return `Petani · ${short}`;
}

// T014 — device-local records (data-model §3): the purpose rides the share
// link and lives HERE only — never server-side, never onchain (clarify-pass
// default, 2026-10-11). Money is a decimal STRING in storage (JSON cannot
// carry bigint); converters live beside the store. T017 (backedList) and
// T029 (sentRecords) grow beside this file, same discipline.
import type { StorageLike } from "../auth/session.js";
import type { SendRecord } from "./models.js";
import { loadSnapshot, saveSnapshot } from "./snapshots.js";

/** The seeker's request record: anchors the deep link + Riwayat detail. */
export interface PurposeRecord {
  isaId: number;
  /** AUSD base units as a decimal string (constitution VI — no floats). */
  principalAusd: string;
  /** ≤ 140 chars — input-capped at the screen (FR-006). */
  purpose: string;
  createdAt: number;
}

const PURPOSES_KEY = "purposes";

export function loadPurposeRecords(storage: StorageLike): PurposeRecord[] {
  return loadSnapshot<PurposeRecord[]>(storage, PURPOSES_KEY)?.model ?? [];
}

export function savePurposeRecord(storage: StorageLike, record: PurposeRecord): void {
  const rows = loadPurposeRecords(storage).filter((r) => r.isaId !== record.isaId);
  rows.push(record);
  saveSnapshot(storage, PURPOSES_KEY, rows);
}

/** The device-local send records (§3 sentRecords): what THIS device sent,
 *  when, and its proof hash once known. Money is a decimal STRING in storage
 *  (JSON cannot carry bigint); BigInt back on the way out. */
const SENT_KEY = "sent";

interface SentRecordWire {
  to: string;
  valueAusd: string;
  at: number;
  txHash?: string;
}

export function loadSentRecords(storage: StorageLike): SendRecord[] {
  const raw = loadSnapshot<SentRecordWire[]>(storage, SENT_KEY)?.model ?? [];
  const parsed: SendRecord[] = [];
  for (const r of raw) {
    try {
      parsed.push({ to: r.to, valueAusd: BigInt(r.valueAusd), at: r.at, txHash: r.txHash });
    } catch {
      // a corrupted row is skipped, never thrown at the screen
    }
  }
  return parsed;
}

export function saveSentRecord(storage: StorageLike, record: SendRecord): void {
  const rows: SentRecordWire[] = [
    ...loadSentRecords(storage).map((r) => ({
      to: r.to,
      valueAusd: r.valueAusd.toString(),
      at: r.at,
      txHash: r.txHash,
    })),
    { to: record.to, valueAusd: record.valueAusd.toString(), at: record.at, txHash: record.txHash },
  ];
  saveSnapshot(storage, SENT_KEY, rows);
}

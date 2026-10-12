// T015 — the receive code (FR-019): the profile URL IS the code. Rendered as
// a QR image, cached device-side under `kite.v1.receiveCodeCache` so a
// revisit never re-encodes. The QR library rides a port seam — tests inject
// a fake and never load the renderer.
import type { StorageLike } from "../auth/session.js";

export interface QRPort {
  toDataURL(text: string): Promise<string>;
}

/** Lazily wire the real renderer — only the browser path ever awaits this. */
export async function makeDefaultQrPort(): Promise<QRPort> {
  const mod = await import("qrcode");
  return { toDataURL: (text) => mod.default.toDataURL(text) };
}

export const RECEIVE_CODE_KEY = "kite.v1.receiveCodeCache";

export function profileUrl(origin: string, profileId: string): string {
  return `${origin.replace(/\/+$/, "")}/p/${profileId}`;
}

interface CachedCode {
  url: string;
  dataUrl: string;
}

export function loadReceiveCode(storage: StorageLike): CachedCode | null {
  try {
    const raw = storage.getItem(RECEIVE_CODE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCode> | null;
    if (typeof parsed?.url !== "string" || typeof parsed?.dataUrl !== "string") return null;
    return { url: parsed.url, dataUrl: parsed.dataUrl };
  } catch {
    return null; // corrupt bytes are no cache — re-encode wins
  }
}

/** The QR image for this profile URL — cache-first (T015). */
export async function receiveCodeDataUrl(
  storage: StorageLike,
  qr: QRPort,
  origin: string,
  profileId: string,
): Promise<string> {
  const url = profileUrl(origin, profileId);
  const cached = loadReceiveCode(storage);
  if (cached?.url === url) return cached.dataUrl;
  const dataUrl = await qr.toDataURL(url);
  const entry: CachedCode = { url, dataUrl };
  storage.setItem(RECEIVE_CODE_KEY, JSON.stringify(entry));
  return dataUrl;
}

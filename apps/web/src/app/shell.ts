// T038 — the shell's pure wiring helpers: which view a path answers, the
// locale cycle, the persisted locale. Pure on purpose — the machine-
// checkable part of the app wiring is testable without a window (the App
// composition itself is client-only).
import type { MoneyLocale } from "../lib/money.js";

export const LANG_KEY = "kite.v1.lang";
export const LANGS: readonly MoneyLocale[] = ["id", "ms", "en"];

export type AppPath = { kind: "app" } | { kind: "mitra" } | { kind: "profile"; id: string };

/** The two paths the shell answers directly: /mitra (the operator console —
 *  desktop-first, no session) and /p/:id (a public profile deep link — no
 *  session). Everything else is the tabbed app. */
export function parseAppPath(pathname: string): AppPath {
  if (pathname === "/mitra" || pathname.startsWith("/mitra/")) {
    return { kind: "mitra" };
  }
  const m = /^\/p\/([^/?#]+)\/?$/.exec(pathname);
  if (m !== null && m[1] !== undefined && m[1] !== "") {
    return { kind: "profile", id: m[1] };
  }
  return { kind: "app" };
}

/** The toggle cycles id → ms → en → id (FR-002: three catalogs, one shape). */
export function nextLang(current: MoneyLocale): MoneyLocale {
  const i = LANGS.indexOf(current);
  return LANGS[(i + 1) % LANGS.length] ?? "id";
}

/** Corrupt or absent bytes are the primary catalog — never an invented tag. */
export function loadLang(raw: string | null): MoneyLocale {
  return LANGS.find((l) => l === raw) ?? "id";
}

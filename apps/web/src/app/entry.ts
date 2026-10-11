// T017 — the app-entry core, UI-free so both entry paths are testable with a
// mocked adapter (FR-016): an existing passkey yields the EXISTING account —
// straight to Home, never re-onboarding; a new passkey starts onboarding; no
// duplicate accounts. Credential pinning (data-model §2.2) makes the browser
// reuse the same passkey instead of offering a chooser.
import {
  buildSessionMessage,
  defaultUntil,
  isSessionUsable,
  loadSessionBlob,
  type SessionBlob,
  type StorageLike,
  saveSessionBlob,
} from "../auth/session.js";
import type { AccountSession, AuthAdapter, CredentialRef } from "../auth/types.js";

export const CREDENTIAL_KEY = "kite.credential.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadPinnedCredential(storage: StorageLike): CredentialRef | null {
  try {
    const raw = storage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.credentialId !== "string") return null;
    if (parsed.credentialId === "") return null;
    const transports = Array.isArray(parsed.transports)
      ? parsed.transports.filter((t): t is string => typeof t === "string")
      : undefined;
    return {
      credentialId: parsed.credentialId,
      transports: transports && transports.length > 0 ? transports : undefined,
    };
  } catch {
    return null;
  }
}

export function savePinnedCredential(storage: StorageLike, credential: CredentialRef): void {
  storage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
}

export function clearPinnedCredential(storage: StorageLike): void {
  storage.removeItem(CREDENTIAL_KEY);
}

/**
 * Signs the frozen message ONCE with the live session and stores the blob —
 * the only place a fresh session becomes a refresh-surviving proof (FR-007,
 * data-model §2.2: wallet, until, sig — never the key).
 */
export async function establishSession(
  storage: StorageLike,
  session: AccountSession,
  nowSec: number,
): Promise<SessionBlob> {
  const until = defaultUntil(nowSec);
  const sig = await session.signIntent(buildSessionMessage(session.address, until));
  const blob: SessionBlob = { wallet: session.address, until, sig };
  saveSessionBlob(storage, blob);
  return blob;
}

export type EntryResult =
  | {
      route: "home";
      wallet?: string /** Live only when a ceremony just ran. */;
      session?: AccountSession;
    }
  | { route: "signup"; reason?: "fresh" | "signin-failed" };

/**
 * The entry decision (FR-016/SC-001): usable session blob → Home with NO
 * ceremony; pinned credential → ONE assertion ceremony on the SAME passkey →
 * Home; nothing pinned → the T016 onboarding. A failed fast-path sign-in
 * (wiped passkey) falls back to onboarding — the old account is unreachable
 * without its passkey, so a fresh one is the only honest path.
 */
export async function enterApp(deps: {
  storage: StorageLike;
  adapter: AuthAdapter;
  rpId: string;
  nowSec: number;
}): Promise<EntryResult> {
  const { storage, adapter, rpId, nowSec } = deps;
  const blob = loadSessionBlob(storage);
  if (isSessionUsable(blob, nowSec)) {
    return { route: "home", wallet: blob?.wallet };
  }
  const pinned = loadPinnedCredential(storage);
  if (pinned) {
    try {
      const session = await adapter.signIn(rpId, pinned);
      await establishSession(storage, session, nowSec);
      return { route: "home", wallet: session.address, session };
    } catch {
      return { route: "signup", reason: "signin-failed" };
    }
  }
  return { route: "signup", reason: "fresh" };
}

/**
 * The MANUAL sign-in path (the "Masuk" button): for devices the fast path
 * cannot serve — a demo-prepped phone holds a persona vault but no pinned
 * credential, and a wiped-pin device lost its pin. ONE assertion ceremony
 * with no pinned credential: the browser offers its passkey picker (the demo
 * adapter unwraps the vault with the passkey pinned inside it). NEVER
 * creates an account (FR-016); the proof is established exactly once.
 */
export async function signInExisting(deps: {
  storage: StorageLike;
  adapter: AuthAdapter;
  rpId: string;
  nowSec: number;
}): Promise<{ route: "home"; wallet: string; session: AccountSession }> {
  const { storage, adapter, rpId, nowSec } = deps;
  const session = await adapter.signIn(rpId);
  const blob = await establishSession(storage, session, nowSec);
  return { route: "home", wallet: blob.wallet, session };
}

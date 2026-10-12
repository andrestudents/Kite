// T008 — the composition-root seam: the app boots its API client THROUGH
// data/ so the structural rule holds (only data/** imports api/ and chain/).
// Screens and the App import these — never the wire modules directly.

export type {
  ApiClient,
  ApiError,
  MeDto,
  ProfileDto,
  QuoteDto,
  VerificationStatusDto,
  VerificationTriggerDto,
} from "../api/client.js";
export { makeApiClient } from "../api/client.js";

/**
 * The API base is a DEV convenience, never a production input: the deployed
 * client speaks same-origin RELATIVE /api/* (vercel.json rewrite → Render,
 * no CORS). A configured absolute base — a stale dashboard var, a local
 * .env — is honored ONLY in dev builds and DISCARDED in production ones,
 * so a localhost default can never reach the bundle. `dev` is injected
 * (call sites pass import.meta.env.DEV) to keep this pure and testable.
 */
export function resolveApiBase(raw: string | undefined, dev: boolean): string {
  if (!dev) return "";
  if (raw === undefined || raw === "") return "";
  return raw;
}

// T013 — the only fetch wrapper in the app (FR-002/FR-010): every call is
// session-scoped via `x-kite-session` built from the stored SessionBlob,
// money crosses as integral JSON numbers untouched, and a 401 is BOTH
// surfaced as ApiError AND routed to sign-in through onUnauthorized (the App
// wires that to its state machine; the client stays UI-agnostic).
// Contract: specs/006-mera-passkey-onboarding/contracts/web-api.md.
import { headerFromBlob, loadSessionBlob, type StorageLike } from "../auth/session.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** /api/me — integral JSON numbers ONLY (contract §1; display math is lib/money). */
export interface MeDto {
  wallet: string;
  balanceAusd: number;
  identityBound: boolean;
  profile: {
    score: number;
    maxSupportAusd: number;
    totalIsas: number;
    completed: number;
    qualEvents: number;
    distinctBackers: number;
  };
  activeIsa: {
    isaId: number;
    backer: string;
    principalAusd: number;
    shareBps: number;
    capMult: number;
    capAusd: number;
    remainingAusd: number;
    progressBps: number;
    termEnd: number;
    channelId: number;
  } | null;
  recentPurchases: Array<{ purchaseRef: string; [k: string]: unknown }>;
}

export interface VerificationStatusDto {
  identityBound: boolean;
  dripped: boolean;
}

export interface VerificationTriggerDto extends VerificationStatusDto {
  enqueued: string[];
}

export interface QuoteDto {
  pair: string;
  rate: number;
  scale: number;
}

export interface ApiClient {
  me(): Promise<MeDto>;
  verificationGet(): Promise<VerificationStatusDto>;
  verificationPost(identityHash: string): Promise<VerificationTriggerDto>;
  quote(pair: "USD_IDR" | "USD_MYR"): Promise<QuoteDto>;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Session-blob store; defaults to window.localStorage in the browser. */
  storage?: StorageLike;
  /** Injectable transport for tests. */
  fetchImpl?: typeof fetch;
  /** FR-010: called once per 401 response — the app routes to sign-in. */
  onUnauthorized?: () => void;
}

function defaultStorage(): StorageLike | undefined {
  return typeof localStorage !== "undefined" ? localStorage : undefined;
}

export function makeApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const storage = options.storage ?? defaultStorage();

  async function apiFetch(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    const blob = storage ? loadSessionBlob(storage) : null;
    if (blob) {
      headers.set("x-kite-session", headerFromBlob(blob));
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, "network", "could not reach Kite — try again");
    }
    if (res.status === 401) {
      options.onUnauthorized?.();
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body — fall through to the generic mapping below
    }
    if (!res.ok) {
      const envelope = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      throw new ApiError(
        res.status,
        typeof envelope?.code === "string" ? envelope.code : "error",
        typeof envelope?.message === "string"
          ? envelope.message
          : "something went wrong — try again",
      );
    }
    return body;
  }

  return {
    me: () => apiFetch("/api/me") as Promise<MeDto>,
    verificationGet: () => apiFetch("/api/me/verification") as Promise<VerificationStatusDto>,
    verificationPost: (identityHash: string) =>
      apiFetch("/api/me/verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityHash }),
      }) as Promise<VerificationTriggerDto>,
    quote: (pair) => apiFetch(`/api/quote?pair=${encodeURIComponent(pair)}`) as Promise<QuoteDto>,
  };
}

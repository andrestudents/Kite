// T014 — the API→relayer hop. INTERNAL-keyed POST /jobs with DETERMINISTIC
// clientRefs (contract web-api.md §3): replays return the same job, so a
// client-side retry of the trigger can never double-enqueue. Transport
// failures retry exactly once; anything the relayer actually answered (or a
// second transport failure) surfaces as `relayer_unreachable` — 503, safe to
// retry. The key never appears in a message or a log line.
import { KiteError } from "@kite/core";

export interface EnqueueInput {
  kind: string;
  payload: Record<string, unknown>;
  clientRef: string;
}

export interface EnqueueResult {
  jobId: number;
  created: boolean;
}

export interface RelayerClient {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
}

/** Deterministic clientRefs — `<kind>-<wallet>`, wallet lowercased. */
export function jobClientRef(kind: "bind" | "drip", wallet: string): string {
  return `${kind}-${wallet.toLowerCase()}`;
}

const TIMEOUT_MS = 5_000;

export function makeRelayerClient(
  baseUrl: string,
  internalKey: string,
  fetchImpl: typeof fetch = fetch,
): RelayerClient {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
      // One retry on TRANSPORT failure only — a relayer that answered has
      // already spoken; its status is final (idempotency is the clientRef's job).
      for (let attempt = 0; ; attempt += 1) {
        let res: Response;
        try {
          res = await fetchImpl(`${base}/api/jobs`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": internalKey },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {
          if (attempt === 0) {
            continue;
          }
          throw new KiteError(
            "relayer_unreachable",
            "verification trigger is unavailable — try again shortly",
          );
        }
        const body = (await res.json().catch(() => null)) as {
          jobId?: unknown;
          error?: { code?: unknown; message?: unknown };
        } | null;
        if (!res.ok) {
          // Server-side detail only — the caller gets the neutral retry code.
          console.error(
            `[relayer-client] enqueue ${input.clientRef} → ${res.status}`,
            typeof body?.error?.code === "string" ? body.error.code : "no code",
          );
          throw new KiteError(
            "relayer_unreachable",
            "verification trigger is unavailable — try again shortly",
          );
        }
        if (typeof body?.jobId !== "number") {
          throw new KiteError(
            "relayer_unreachable",
            "verification trigger is unavailable — try again shortly",
          );
        }
        return { jobId: body.jobId, created: res.status === 202 };
      }
    },
  };
}

/** Default when no relayer is configured — the trigger is honestly 503. */
export function makeUnreachableRelayerClient(): RelayerClient {
  return {
    async enqueue(): Promise<EnqueueResult> {
      throw new KiteError(
        "relayer_unreachable",
        "verification trigger is unavailable — try again shortly",
      );
    },
  };
}

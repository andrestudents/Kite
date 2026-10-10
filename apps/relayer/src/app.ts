// The relayer's HTTP surface (T021): one INTERNAL key owns enqueue + status.
// Errors leave as {error:{code,message}} exactly like the API side; no
// payload, key, or error detail is ever echoed to a caller.

import { KiteError, verifyApiKey } from "@kite/core";
import type { AnyDb } from "@kite/core/db";
import { Hono } from "hono";
import { enqueue, getJob, toJobDto } from "./queue.js";

export interface RelayerDeps {
  db: AnyDb;
  internalKey: string;
}

const STATUS_BY_CODE: Record<string, 400 | 401 | 404 | 409 | 422> = {
  bad_request: 400,
  unknown_kind: 400,
  unauthorized: 401,
  job_not_found: 404,
  not_found: 404,
  daily_cap_exceeded: 409,
};

export function createRelayerApp(deps: RelayerDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof KiteError) {
      const status = STATUS_BY_CODE[err.code] ?? 500;
      return c.json({ error: { code: err.code, message: err.message } }, status);
    }
    console.error("[relayer]", err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404));

  app.use("/api/jobs*", async (c, next) => {
    if (!verifyApiKey(c.req.header("x-api-key"), deps.internalKey)) {
      throw new KiteError("unauthorized", "missing or invalid key");
    }
    await next();
  });

  // POST /jobs {kind, payload, clientRef?} → 202 {jobId}; the same clientRef
  // returns the ORIGINAL job with 200 (idempotent enqueue, §7.2 rule 1).
  app.post("/api/jobs", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      kind?: unknown;
      payload?: unknown;
      clientRef?: unknown;
    } | null;
    if (!body || typeof body.kind !== "string") {
      throw new KiteError("bad_request", "body must be {kind, payload, clientRef?}");
    }
    if (body.clientRef !== undefined && typeof body.clientRef !== "string") {
      throw new KiteError("bad_request", "clientRef must be a string");
    }
    const { job, created } = await enqueue(deps.db, {
      kind: body.kind,
      payload: body.payload,
      clientRef: body.clientRef,
    });
    return c.json({ jobId: job.id }, created ? 202 : 200);
  });

  app.get("/api/jobs/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const job = await getJob(deps.db, Number.isNaN(id) ? -1 : id);
    return c.json(toJobDto(job));
  });

  return app;
}

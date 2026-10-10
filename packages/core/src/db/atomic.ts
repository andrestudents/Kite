// Atomic multi-write across both drivers. neon-http has no interactive
// transaction (`db.transaction` throws) — its atomic unit is `db.batch`
// (one HTTP round-trip executed as a single transaction server-side).
// PGlite / TCP Postgres take a real transaction. `build` constructs the
// unexecuted statements from the executor it receives, so both branches
// share one statement list.
import type { PgDatabase } from "drizzle-orm/pg-core";

/** Loose db type both drivers satisfy — statement shapes come from the table
 *  objects, never from this parameter. */
// biome-ignore lint/suspicious/noExplicitAny: driver-agnostic executor holder
export type AnyDb = PgDatabase<any, any, any>;

export async function writeAtomic(
  db: AnyDb,
  build: (executor: AnyDb) => Array<Promise<unknown>>,
): Promise<void> {
  const batchable = db as { batch?: (statements: unknown[]) => Promise<unknown> };
  if (typeof batchable.batch === "function") {
    await batchable.batch(build(db));
    return;
  }
  await db.transaction(async (tx) => {
    for (const statement of build(tx as AnyDb)) await statement;
  });
}

// Executor helper across both drivers. neon-http has no interactive
// transaction (`db.transaction` throws) — statements it receives run directly
// on the HTTP driver (demo scale: single writer; the registry's UNIQUE locks
// stay exact regardless). PGlite / TCP Postgres run inside a real transaction.
// Multi-row writes that need one atomic unit build their statements from the
// passed executor; on neon-http prefer pre-computable statements and db.batch
// (see purchases creation — uuid ids make the batch possible).
import type { PgDatabase } from "drizzle-orm/pg-core";

/** Loose db type both drivers satisfy — statement shapes come from the table
 *  objects, never from this parameter. */
// biome-ignore lint/suspicious/noExplicitAny: driver-agnostic executor holder
export type AnyDb = PgDatabase<any, any, any>;

export async function execute<T>(db: AnyDb, fn: (executor: AnyDb) => Promise<T>): Promise<T> {
  const kind = (Object.getPrototypeOf(db).constructor as { entityKind?: string }).entityKind;
  if (kind === "NeonHttpDatabase") {
    return fn(db);
  }
  return db.transaction((tx) => fn(tx as AnyDb));
}

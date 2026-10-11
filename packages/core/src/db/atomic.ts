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

// drizzle tags its classes with a static SYMBOL, not a string property
// (drizzle-orm/entity.js: `Symbol.for("drizzle:entityKind")`) — reading a
// plain `.entityKind` always yields undefined, which pushed neon-http into
// the transaction branch it cannot run. Registry symbol: same key drizzle
// uses, no deep import, no drift.
const DRIZZLE_ENTITY_KIND = Symbol.for("drizzle:entityKind");

export async function execute<T>(db: AnyDb, fn: (executor: AnyDb) => Promise<T>): Promise<T> {
  const kind = (Object.getPrototypeOf(db).constructor as Record<symbol, string | undefined>)[
    DRIZZLE_ENTITY_KIND
  ];
  if (kind === "NeonHttpDatabase") {
    return fn(db);
  }
  return db.transaction((tx) => fn(tx as AnyDb));
}

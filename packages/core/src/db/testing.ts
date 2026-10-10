// Test factory (research D4): in-memory Postgres via PGlite, migrated to the
// latest generated migration — the real Drizzle schema, real UNIQUE
// constraints, no network. bun test at demo scale spins one per test file.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

export type TestDb = ReturnType<typeof makeTestDb> extends Promise<infer T> ? T : never;

export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const folder = new URL("../../drizzle", import.meta.url).pathname;
  await migrate(db, { migrationsFolder: folder });
  return db;
}

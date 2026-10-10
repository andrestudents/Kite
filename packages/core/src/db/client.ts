// Drizzle factories (research D3): Neon HTTP driver for services, PGlite
// in-memory for tests — one schema for both (D4).

import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

export function makeNeonDb(databaseUrl: string) {
  return drizzleNeon(neon(databaseUrl), { schema });
}

export function makePgliteDb(client: PGlite = new PGlite()) {
  return drizzlePglite(client, { schema });
}

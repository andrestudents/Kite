import { defineConfig } from "drizzle-kit";

// `bunx drizzle-kit generate` needs no connection; `push` (via the root
// db:push script) takes --url from DATABASE_URL. Tests use the generated
// migrations against PGlite (src/db/testing.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/kite" },
});

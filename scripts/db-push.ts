// db:push implementation — `bun run <package-script>` does NOT inherit bun's
// automatic .env loading (bun 1.4.2: the spawned script shell sees an empty
// DATABASE_URL even though `bun <file>` sees it), so the URL is read HERE —
// where dotenv is guaranteed — and handed to drizzle-kit explicitly, then the
// recon baseline is stamped. The value is passed by argv, never printed.
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:push: DATABASE_URL is not set (.env or environment)");
  process.exit(2);
}

const push = spawnSync(
  "bunx",
  [
    "drizzle-kit",
    "push",
    "--dialect",
    "postgresql",
    "--schema",
    "./packages/core/src/db/schema.ts",
    "--url",
    url,
  ],
  { stdio: "inherit" },
);
if (push.status !== 0) {
  process.exit(push.status ?? 1);
}

const stamp = spawnSync("bun", ["scripts/stamp-recon-baseline.ts"], { stdio: "inherit" });
process.exit(stamp.status ?? 1);

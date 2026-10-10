// Stamps job_state['recon_baseline_ts'] = now — ONCE (research D15).
// Feature-004's seed settlements predate the backend; the baseline keeps them
// out of recon verdicts while everything after is compared honestly. A second
// db:push must NOT restamp (idempotent ON CONFLICT DO NOTHING).
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("EnvMissing(DATABASE_URL)");
  process.exit(1);
}

const sql = neon(url);
await sql`
  INSERT INTO job_state (key, value)
  VALUES ('recon_baseline_ts', ${new Date().toISOString()})
  ON CONFLICT (key) DO NOTHING
`;
const rows = await sql`SELECT value FROM job_state WHERE key = 'recon_baseline_ts'`;
console.log("recon_baseline_ts =", rows[0]?.value);

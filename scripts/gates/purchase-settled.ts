// T020 — SC-002 gate: one purchase travels the full §7.2 registry and its
// settlement lands in the same run: fresh ref, mill-signed IN-PROCESS with the
// T013 SignIncome encoding, registered (create), marked paid, submitted by the
// T019 Demo-Tool submitter at the published fixed limit, observed by the T018
// watcher pass in-process. Self-contained: needs only the environment
// (DATABASE_URL, MITA_API_KEY, MILL_KEY, ORCHESTRATOR_KEY) — no services to
// start, nothing else to run.
//
//   bun run scripts/gates/purchase-settled.ts [isaId] [grossAusdBaseUnits]
//
// Exit 0 = PASS, 1 = FAIL. Every step prints its evidence.
import { createHash, randomBytes } from "node:crypto";
import { KiteError, requireEnv } from "@kite/core";
import { isas, makeNeonDb, type Purchase, purchases } from "@kite/core/db";
import { eq } from "drizzle-orm";
import { sign } from "viem/accounts";
import { apiEnv } from "../../apps/api/src/env.js";
import { submitSettlement } from "../../apps/api/src/jobs/submit-settlement.js";
import { type IsaOnchain, makeChainClient } from "../../apps/api/src/services/chain.js";
import { incomeDigest } from "../../apps/api/src/services/income-sig.js";
import { entriesFor } from "../../apps/api/src/services/ledger.js";
import { createPurchase, markPurchasePaid } from "../../apps/api/src/services/purchase-service.js";

const GROSS_AUSD = Number(process.argv[3] ?? 1_000_000); // 1 AUSD in base units

let failed = false;
function step(name: string, ok: boolean, evidence: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${evidence}`);
  if (!ok) {
    failed = true;
  }
}

const STATUS_NAMES: Record<number, string> = {
  0: "none",
  1: "drafted",
  2: "active",
  3: "completed_capped",
  4: "completed_at_term",
  5: "cancelled",
};

async function main(): Promise<void> {
  console.log("=== SC-002 gate: purchase settles, DB agrees with the contract ===");
  // The watcher pass below scans a block RANGE: pin the gate's reads to
  // RPC_URL / the default public RPC — Alchemy's free tier caps eth_getLogs
  // at 10 blocks. Empty, not unset: bun re-loads .env and would restore an
  // unset name (optionalEnv treats "" as unset).
  process.env.ALCHEMY_RPC_URL = "";
  requireEnv("DATABASE_URL");
  requireEnv("MITA_API_KEY");
  requireEnv("MILL_KEY");
  requireEnv("ORCHESTRATOR_KEY");

  const env = apiEnv();
  const db = makeNeonDb(env.databaseUrl);
  const chain = makeChainClient();

  // 0. The deal must be live before anything signs. An explicit argv wins;
  //    otherwise discover the first ACTIVE deal — the seeded demo deals cap
  //    out as gates spend them (deal 1 did), so a fixed default would rot.
  const argId = Number(process.argv[2] ?? 0);
  if (Number.isNaN(argId)) {
    throw new KiteError("bad_request", "isaId argument must be a number");
  }
  let ISA_ID = argId;
  if (!ISA_ID) {
    for (let i = 1; i <= 8; i++) {
      try {
        const probe: IsaOnchain = await chain.isaOf(i);
        if (probe.status === 2 && probe.remaining > 0) {
          ISA_ID = i;
          break;
        }
      } catch {
        // unseeded slot — keep scanning
      }
    }
  }
  if (!ISA_ID) {
    throw new KiteError(
      "not_found",
      "no active deal onchain — seed one first: bash contracts/script/seed-demo.sh (Demo Tool)",
    );
  }

  const before: IsaOnchain = await chain.isaOf(ISA_ID);
  step(
    "deal is active",
    before.status === 2,
    `isaId=${ISA_ID} status=${STATUS_NAMES[before.status]} remaining=${before.remaining} channelId=${before.channelId}`,
  );
  if (before.status !== 2) {
    throw new KiteError("not_found", `deal ${ISA_ID} is not active — activate a demo deal first`);
  }

  // 1. Fresh purchase identity + the mill's signature (T013 encoding, in-process).
  const purchaseRef =
    `0x${createHash("sha256").update(randomBytes(32)).digest("hex")}` as `0x${string}`;
  const salt = `0x${createHash("sha256").update(randomBytes(32)).digest("hex")}` as `0x${string}`;
  const channelId = before.channelId;
  const millKey = requireEnv("MILL_KEY") as `0x${string}`;
  const millSig = await sign({
    hash: incomeDigest({ channelId, isaId: ISA_ID, purchaseRef, gross: GROSS_AUSD, salt }),
    privateKey: millKey,
  });
  const intent = {
    channelId,
    isaId: ISA_ID,
    purchaseRef,
    grossAusd: GROSS_AUSD,
    millSig: { salt, v: Number(millSig.v), r: millSig.r, s: millSig.s },
  };
  console.log(`EVIDENCE  purchaseRef=${purchaseRef} salt=${salt} grossAusd=${GROSS_AUSD}`);

  // 2. Register (the same call POST /api/channel/purchases serves).
  const { purchase, created } = await createPurchase(db, chain, intent);
  step(
    "purchase registered",
    created && purchase.status === "PENDING",
    `id=${purchase.id} status=${purchase.status}`,
  );

  // 3. The mill records payment (PENDING → PAID).
  const paid = await markPurchasePaid(db, purchase.id, "gate:purchase-settled");
  step("payment recorded", paid.status === "PAID", `id=${purchase.id} status=${paid.status}`);

  // 4. The Demo-Tool submitter broadcasts; the watcher pass observes in-process.
  const outcome = await submitSettlement(db, chain, purchase.id, { passes: 5 });
  step(
    "settlement observed",
    outcome.status === "SETTLED",
    `status=${outcome.status} settlementTx=${outcome.txHash ?? "-"}`,
  );

  // 5. Post-state assertions.
  const after: IsaOnchain = await chain.isaOf(ISA_ID);
  const rows = await db.select().from(purchases).where(eq(purchases.id, purchase.id)).limit(1);
  const settledRow: Purchase | undefined = rows[0];
  step(
    "purchase row SETTLED with the settlement tx",
    settledRow?.status === "SETTLED" && settledRow?.txHash === outcome.txHash,
    `status=${settledRow?.status} tx=${settledRow?.txHash ?? "-"} settledAt=${settledRow?.settledAt?.toISOString() ?? "-"}`,
  );

  const entries = await entriesFor(db, purchase.id);
  const sum = (side: string) =>
    entries.filter((e) => e.side === side).reduce((acc, e) => acc + e.amountAusd, 0);
  const inSum = sum("in");
  const outSum = sum("out");
  step(
    "ledger balances",
    entries.length === 3 && inSum === GROSS_AUSD && outSum === GROSS_AUSD,
    `rows=${entries.length} in=${inSum} out=${outSum} (gross=${GROSS_AUSD})`,
  );

  // The cap is consumed by the settlement's BACKER SLICE, not the whole
  // gross — KiteScoring.divert: toBacker = min(gross × shareBps / 10000,
  // remaining); toSeeker = gross − toBacker. shareBps comes from the
  // contract read above (constitution IV: the contract states the terms).
  const expectedDrop = Math.floor((GROSS_AUSD * before.shareBps) / 10000);
  step(
    "deal remaining moved by the settlement's backer slice",
    after.remaining === before.remaining - expectedDrop,
    `remaining ${before.remaining} → ${after.remaining} (expected ${before.remaining - expectedDrop}; toBacker = gross ${GROSS_AUSD} × shareBps ${before.shareBps} / 10000) status=${STATUS_NAMES[after.status]}`,
  );

  // The cached copy must equal the contract read (constitution IV).
  const cached = await db.select().from(isas).where(eq(isas.isaId, ISA_ID)).limit(1);
  step(
    "cached deal copy equals the contract read",
    cached[0]?.remaining === after.remaining && cached[0]?.status === STATUS_NAMES[after.status],
    `cached remaining=${cached[0]?.remaining ?? "-"} status=${cached[0]?.status ?? "-"}` +
      ` | contract remaining=${after.remaining} status=${STATUS_NAMES[after.status]}`,
  );

  console.log(
    `=== SC-002 ${failed ? "FAIL" : "PASS"} — deal ${ISA_ID}, purchase ${purchase.id} ===`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("GATE ERROR", err);
  process.exit(1);
});

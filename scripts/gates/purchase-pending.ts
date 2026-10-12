// T035 companion seeder — puts ONE purchase on the §7.2 registry in PENDING
// so the Mitra console has a row to Bayar (quickstart §6 steps 1–2). The
// mill signature is minted HERE, channel-side with MILL_KEY from the env —
// the browser console never signs intents, it only records payment.
// (purchase-settled.ts runs the whole lifecycle in one shot; this one stops
// so a human can act in between.)
//
//   bun run scripts/gates/purchase-pending.ts [isaId] [grossAusdBaseUnits]
//
// Exit 0 = a PENDING row is on the registry; prints its id + the verify curl.
import { createHash, randomBytes } from "node:crypto";
import { KiteError, requireEnv } from "@kite/core";
import { makeNeonDb } from "@kite/core/db";
import { sign } from "viem/accounts";
import { apiEnv } from "../../apps/api/src/env.js";
import { type IsaOnchain, makeChainClient } from "../../apps/api/src/services/chain.js";
import { incomeDigest } from "../../apps/api/src/services/income-sig.js";
import { createPurchase } from "../../apps/api/src/services/purchase-service.js";

const GROSS_AUSD = Number(process.argv[3] ?? 1_000_000); // 1 AUSD in base units

function step(name: string, evidence: string): void {
  console.log(`PASS  ${name}  ${evidence}`);
}

async function main(): Promise<void> {
  console.log("=== T035 seeder: one PENDING purchase for the Mitra console (Demo Tool) ===");
  process.env.ALCHEMY_RPC_URL = "";
  requireEnv("DATABASE_URL");
  requireEnv("MILL_KEY");

  const env = apiEnv();
  const db = makeNeonDb(env.databaseUrl);
  const chain = makeChainClient();

  // Same discovery as the SC-002 gate: explicit argv wins, else the first
  // ACTIVE deal (seeded demo deals cap out as gates spend them).
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

  const deal: IsaOnchain = await chain.isaOf(ISA_ID);
  step("deal is active", `isaId=${ISA_ID} remaining=${deal.remaining} channelId=${deal.channelId}`);

  // The mill signs the intent (T013 encoding) — channel-side, env key only.
  const purchaseRef =
    `0x${createHash("sha256").update(randomBytes(32)).digest("hex")}` as `0x${string}`;
  const salt = `0x${createHash("sha256").update(randomBytes(32)).digest("hex")}` as `0x${string}`;
  const millSig = await sign({
    hash: incomeDigest({
      channelId: deal.channelId,
      isaId: ISA_ID,
      purchaseRef,
      gross: GROSS_AUSD,
      salt,
    }),
    privateKey: requireEnv("MILL_KEY") as `0x${string}`,
  });
  const intent = {
    channelId: deal.channelId,
    isaId: ISA_ID,
    purchaseRef,
    grossAusd: GROSS_AUSD,
    millSig: { salt, v: Number(millSig.v), r: millSig.r, s: millSig.s },
  };

  // The same call POST /api/channel/purchases serves — the registry row the
  // console's list will show. STOP: no paid, no settlement — Bayar does that.
  const { purchase, created } = await createPurchase(db, chain, intent);
  step(
    "purchase registered (PENDING)",
    `id=${purchase.id} status=${purchase.status} created=${created}`,
  );

  console.log(`EVIDENCE  purchaseRef=${purchaseRef} grossAusd=${GROSS_AUSD}`);
  console.log("Next: open /mitra on desktop → Bayar on this row, then verify:");
  console.log(`  curl -s "$API/api/channel/purchases/${purchase.id}" \\`);
  console.log('    -H "x-api-key: $MITA_API_KEY"');
  console.log("Settlement afterwards: bun run scripts/gates/purchase-settled.ts (005 Demo Tool).");
  process.exit(0);
}

main().catch((err) => {
  console.error("SEEDER ERROR", err);
  process.exit(1);
});

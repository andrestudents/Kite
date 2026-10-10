// T026 — SC-001 gate (quickstart §3): a gasless AUSD transfer through the
// RUNNING relayer. Two throwaway accounts are created here; the sender is
// funded with AUSD by a plain ERC-20 transfer from DEPLOYER_KEY and NEVER
// holds MON — the relayer's RELAYER_KEY pays for the broadcast. The sender
// signs EIP-3009 TransferWithAuthorization over the MockAUSD domain
// ("AUSD"/"1", chain 10143); the gate enqueues over HTTP with a clientRef and
// polls until the relayer confirms on its Transfer-log read-back (D7).
//
//   bun run scripts/gates/gasless-send.ts [--replay] [valueAusdBaseUnits]
//
// --replay re-enqueues the SAME clientRef: the relayer must return the SAME
// job (200, not 202) and move nothing further onchain. Exit 0 = PASS, 1 =
// FAIL. Every step prints its evidence. Needs the relayer booted
// (apps/relayer) plus INTERNAL_API_KEY + DEPLOYER_KEY in the environment.
import { randomBytes } from "node:crypto";
import { abis, KITE_DEPLOYMENT, MOCK_AUSD_GAS_LIMITS } from "@kite/contracts";
import { KiteError, optionalEnv, requireEnv, rpcUrl } from "@kite/core";
import { type Abi, createPublicClient, createWalletClient, hexToSignature, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const AUSD = KITE_DEPLOYMENT.ausd as `0x${string}`;
const AUSD_ABI = abis.mockausd as Abi;
const REPLAY = process.argv.includes("--replay");
const VALUE = Number(process.argv.filter((a) => !a.startsWith("--"))[2] ?? 1_000_000); // 1 AUSD

let failed = false;
function step(name: string, ok: boolean, evidence: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${evidence}`);
  if (!ok) {
    failed = true;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JobDto {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  txHash: string | null;
  lastError: string | null;
  terminalAt: string | null;
}

async function main(): Promise<void> {
  console.log("=== SC-001 gate: gasless AUSD transfer through the relayer ===");
  requireEnv("INTERNAL_API_KEY");
  requireEnv("DEPLOYER_KEY");
  const base = optionalEnv("RELAYER_URL") ?? "http://localhost:3001";
  const key = requireEnv("INTERNAL_API_KEY");

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  });
  const deployer = privateKeyToAccount(requireEnv("DEPLOYER_KEY") as `0x${string}`);
  const sender = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey());

  const balanceOfAUSD = (wallet: `0x${string}`) =>
    publicClient.readContract({
      address: AUSD,
      abi: AUSD_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }) as Promise<bigint>;
  const monOf = (wallet: `0x${string}`) => publicClient.getBalance({ address: wallet });

  // 0. The sender starts with nothing at all.
  const senderAusd0 = await balanceOfAUSD(sender.address);
  const senderMon0 = await monOf(sender.address);
  step(
    "sender starts with zero AUSD and zero MON",
    senderAusd0 === 0n && senderMon0 === 0n,
    `ausd=${senderAusd0} monWei=${senderMon0}`,
  );

  // 1. A plain ERC-20 transfer funds the sender — and gives no MON (D-decision:
  //    the gasless sender never needs native currency; only the relayer does).
  const fundHash = await createWalletClient({
    account: deployer,
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  }).writeContract({
    address: AUSD,
    abi: AUSD_ABI,
    functionName: "transfer",
    args: [sender.address, BigInt(VALUE)],
    gas: BigInt(MOCK_AUSD_GAS_LIMITS.transfer.fixedLimit),
  });
  const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
  const senderMonAfterFund = await monOf(sender.address);
  step(
    "funded with AUSD, still zero MON",
    fundReceipt.status === "success" &&
      (await balanceOfAUSD(sender.address)) === BigInt(VALUE) &&
      senderMonAfterFund === 0n,
    `fundTx=${fundHash} ausd=${VALUE} monWei=${senderMonAfterFund}`,
  );

  // 2. The sender signs EIP-3009 over the MockAUSD domain (contract: name
  //    "AUSD"/version "1" via ERC20Permit; standard EIP-3009 typehash).
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60;
  const validBefore = now + 3_600;
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const signature = await sender.signTypedData({
    domain: {
      name: "AUSD",
      version: "1",
      chainId: KITE_DEPLOYMENT.chainId,
      verifyingContract: AUSD,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: sender.address,
      to: recipient.address,
      value: BigInt(VALUE),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });
  const { v, r, s } = hexToSignature(signature);
  const payload = {
    from: sender.address,
    to: recipient.address,
    valueAusd: VALUE,
    validAfter,
    validBefore,
    nonce,
    v,
    r,
    s,
  };
  console.log(
    `EVIDENCE  sender=${sender.address} recipient=${recipient.address} valueAusd=${VALUE} nonce=${nonce}`,
  );

  const postJob = async (
    clientRef: string,
  ): Promise<{ status: number; jobId?: number; error?: string }> => {
    const res = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ kind: "transfer_with_authorization", payload, clientRef }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      jobId?: number;
      error?: { code?: string };
    };
    return { status: res.status, jobId: body.jobId, error: body.error?.code };
  };

  // 3. Enqueue over HTTP with a clientRef (§7.2 rule 1) → 202 {jobId}.
  const clientRef = `sc001-${randomBytes(8).toString("hex")}`;
  const first = await postJob(clientRef);
  const jobId = first.jobId;
  step(
    "enqueued with a clientRef",
    first.status === 202 && typeof jobId === "number",
    `http=${first.status} jobId=${jobId ?? "-"}`,
  );
  if (typeof jobId !== "number") {
    throw new KiteError("internal", `enqueue failed: ${first.status} ${first.error ?? ""}`);
  }

  // 4. Poll until the relayer resolves the job (its read-back, not ours).
  let job: JobDto | undefined;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/jobs/${jobId}`, { headers: { "x-api-key": key } });
    job = (await res.json()) as JobDto;
    if (job.status === "confirmed" || job.terminalAt !== null) {
      break;
    }
    await sleep(1_500);
  }
  step(
    "relayer confirmed the job",
    job?.status === "confirmed",
    `status=${job?.status ?? "-"} tx=${job?.txHash ?? "-"} attempts=${job?.attempts ?? "-"} lastError=${job?.lastError ?? "-"}`,
  );

  // 5. Onchain post-state: the recipient got exactly VALUE; the sender spent
  //    no MON (the relayer's key paid).
  const recipientAusd = await balanceOfAUSD(recipient.address);
  const senderMon1 = await monOf(sender.address);
  step(
    "recipient received exactly the value",
    recipientAusd === BigInt(VALUE),
    `ausd=${recipientAusd} (expected ${VALUE})`,
  );
  step("sender still holds zero MON", senderMon1 === 0n, `monWei=${senderMon1}`);

  // 6. The confirmation followed the read-back: the job's own tx carries the
  //    Transfer(from, to, value) event — the same D7 evidence the handler used.
  let transferSeen = false;
  if (job?.txHash) {
    const receipt = await publicClient.getTransactionReceipt({ hash: job.txHash as `0x${string}` });
    transferSeen = receipt.logs.some((log) => {
      const topics = log.topics ?? [];
      return (
        log.address.toLowerCase() === AUSD.toLowerCase() &&
        topics[0]?.toLowerCase() ===
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && // Transfer(address,address,uint256)
        topics[1]?.toLowerCase().endsWith(sender.address.toLowerCase().slice(2)) &&
        topics[2]?.toLowerCase().endsWith(recipient.address.toLowerCase().slice(2))
      );
    });
  }
  step(
    "confirmation followed the onchain read-back",
    transferSeen,
    `tx=${job?.txHash ?? "-"} emitted Transfer(from,to,value)`,
  );

  // 7. --replay: the same clientRef returns the SAME job with 200 and the
  //    recipient's balance does not move again.
  if (REPLAY) {
    const recipientAusdBefore = await balanceOfAUSD(recipient.address);
    const again = await postJob(clientRef);
    step(
      "replay returned the same job with 200",
      again.status === 200 && again.jobId === jobId,
      `http=${again.status} jobId=${again.jobId ?? "-"}`,
    );
    const recipientAusdAfter = await balanceOfAUSD(recipient.address);
    step(
      "replay moved nothing onchain",
      recipientAusdAfter === recipientAusdBefore,
      `ausd ${recipientAusdBefore} → ${recipientAusdAfter}`,
    );
  }

  console.log(
    `=== SC-001 ${failed ? "FAIL" : "PASS"} — gasless ${VALUE} base units, job ${jobId} ===`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("GATE ERROR", err);
  process.exit(1);
});

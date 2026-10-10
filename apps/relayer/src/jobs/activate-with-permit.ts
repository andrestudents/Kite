// T025 — the activate_with_permit handler (FR-015): relays the seeker's
// activateWithPermit signature at the published 346000 limit (the cold-state
// number — a warm-derived limit OOG'd on Monad, see packages/contracts).
// The D7 proof is isaOf(isaId).status == 2 onchain — the contract is the only
// authority for ISA state (constitution IV).
import { registerHandler } from "../dispatch.js";
import { resendGated } from "../send.js";
import { ACTIVATE_GAS, CORE, CORE_ABI } from "../contracts.js";
import { asPayload, requireSig, requireUint } from "./parse.js";

registerHandler("activate_with_permit", async (ctx, job) => {
  const p = asPayload(job.payloadJson);
  const isaId = requireUint(p, "isaId");
  const deadline = requireUint(p, "deadline");
  const { v, r, s } = requireSig(p);

  const proof = async () => (await ctx.wallet.isaStatusOf(isaId)) === 2;
  return resendGated(
    ctx.db,
    ctx.wallet,
    job,
    {
      address: CORE,
      abi: CORE_ABI,
      functionName: "activateWithPermit",
      args: [BigInt(isaId), BigInt(deadline), v, r, s],
      gasFixedLimit: ACTIVATE_GAS,
    },
    proof,
  );
});

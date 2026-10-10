// T023 — the bind_identity handler (FR-015). Broadcasts
// bindIdentity(wallet, identityHash) at the published 158000 limit; the D7
// proof is identityOf(wallet) equal to the requested hash — it confirms a
// fresh receipt AND gates any resend of a sent job (FR-013).

import { BIND_GAS, CORE, CORE_ABI } from "../contracts.js";
import { registerHandler } from "../dispatch.js";
import { resendGated } from "../send.js";
import { asPayload, requireAddress, requireBytes32 } from "./parse.js";

registerHandler("bind_identity", async (ctx, job) => {
  const p = asPayload(job.payloadJson);
  const wallet = requireAddress(p, "wallet");
  const identityHash = requireBytes32(p, "identityHash");
  const proof = async () =>
    (await ctx.wallet.identityOf(wallet)).toLowerCase() === identityHash.toLowerCase();
  return resendGated(
    ctx.db,
    ctx.wallet,
    job,
    {
      address: CORE,
      abi: CORE_ABI,
      functionName: "bindIdentity",
      args: [wallet, identityHash],
      gasFixedLimit: BIND_GAS,
    },
    proof,
  );
});

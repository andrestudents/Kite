// T025 — the activate_with_permit handler (FR-015): relays the seeker's
// activateWithPermit signature at the published 346000 limit (the cold-state
// number — a warm-derived limit OOG'd on Monad, see packages/contracts).
// The D7 proof is isaOf(isaId).status == 2 onchain — the contract is the only
// authority for ISA state (constitution IV).

import { ACTIVATE_GAS, CORE, CORE_ABI } from "../contracts.js";
import { registerHandler } from "../dispatch.js";
import { resendGated } from "../send.js";
import { asPayload, requireSig, requireUint } from "./parse.js";

/** One parser for BOTH edges: the enqueue validator and the handler itself. */
function parseActivate(raw: unknown) {
  const p = asPayload(raw);
  return {
    isaId: requireUint(p, "isaId"),
    deadline: requireUint(p, "deadline"),
    ...requireSig(p),
  };
}

registerHandler(
  "activate_with_permit",
  async (ctx, job) => {
    const { isaId, deadline, v, r, s } = parseActivate(job.payloadJson);

    const proof = async () => (await ctx.wallet.isaStatusOf(Number(isaId))) === 2;
    return resendGated(
      ctx.db,
      ctx.wallet,
      job,
      {
        address: CORE,
        abi: CORE_ABI,
        functionName: "activateWithPermit",
        args: [isaId, deadline, v, r, s],
        gasFixedLimit: ACTIVATE_GAS,
      },
      proof,
    );
  },
  parseActivate,
);

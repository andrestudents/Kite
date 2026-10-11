// T024 — the transfer_with_authorization handler (FR-015): relays a signed
// EIP-3009 TransferWithAuthorization over MockAUSD (the Demo-Tool money rail)
// at the published 157000 limit. The D7 proof is the receipt's OWN LOGS
// containing AUSD's Transfer(from, to, value): MockAUSD exposes no
// authorizationState view, and a spent/reverting call emits no event — the
// log is the only sound evidence that THIS authorization landed.

import {
  AUSD,
  AUSD_ABI,
  addressTopic,
  TRANSFER_TOPIC,
  TRANSFER_WITH_AUTH_GAS,
} from "../contracts.js";
import { registerHandler } from "../dispatch.js";
import { type MinedReceipt, resendGated } from "../send.js";
import { asPayload, requireAddress, requireBytes32, requireSig, requireUint } from "./parse.js";

/** One parser for BOTH edges: the enqueue validator and the handler itself. */
function parseTransfer(raw: unknown) {
  const p = asPayload(raw);
  return {
    from: requireAddress(p, "from"),
    to: requireAddress(p, "to"),
    // Money rule: value arrives in integer AUSD base units (constitution VI) —
    // an exact BigInt from the wire edge (parse.ts).
    valueAusd: requireUint(p, "valueAusd"),
    validAfter: requireUint(p, "validAfter"),
    validBefore: requireUint(p, "validBefore"),
    nonce: requireBytes32(p, "nonce"),
    ...requireSig(p),
  };
}

function transferLanded(
  receipt: MinedReceipt,
  from: string,
  to: string,
  valueWei: bigint,
): boolean {
  return receipt.logs.some((raw) => {
    const log = raw as { address?: string; topics?: string[]; data?: string };
    return (
      log.address?.toLowerCase() === AUSD.toLowerCase() &&
      log.topics?.[0] === TRANSFER_TOPIC &&
      log.topics[1] === addressTopic(from) &&
      log.topics[2] === addressTopic(to) &&
      BigInt(log.data ?? "0x") === valueWei
    );
  });
}

registerHandler(
  "transfer_with_authorization",
  async (ctx, job) => {
    const { from, to, valueAusd, validAfter, validBefore, nonce, v, r, s } = parseTransfer(
      job.payloadJson,
    );

    const proof = (receipt: MinedReceipt) =>
      Promise.resolve(transferLanded(receipt, from, to, valueAusd));
    return resendGated(
      ctx.db,
      ctx.wallet,
      job,
      {
        address: AUSD,
        abi: AUSD_ABI,
        functionName: "transferWithAuthorization",
        args: [from, to, valueAusd, validAfter, validBefore, nonce, v, r, s],
        gasFixedLimit: TRANSFER_WITH_AUTH_GAS,
      },
      proof,
    );
  },
  parseTransfer,
);

// T023–T025 — the relayer's onchain constants. Addresses come from the
// committed deployment record, ABIs from the committed forge-inspect dumps,
// gas from the PUBLISHED fixed limits (PLAN §6.1) — nothing is estimated.

import { abis, KITE_DEPLOYMENT, KITE_GAS_LIMITS, MOCK_AUSD_GAS_LIMITS } from "@kite/contracts";
import type { Abi } from "viem";
import { keccak256, toHex } from "viem";

export const CORE = KITE_DEPLOYMENT.kiteCore as `0x${string}`;
export const AUSD = KITE_DEPLOYMENT.ausd as `0x${string}`;
export const CORE_ABI = abis.kitecore as Abi;
export const AUSD_ABI = abis.mockausd as Abi;

export const BIND_GAS = KITE_GAS_LIMITS.bindIdentity.fixedLimit;
export const ACTIVATE_GAS = KITE_GAS_LIMITS.activateWithPermit.fixedLimit;
export const TRANSFER_WITH_AUTH_GAS = MOCK_AUSD_GAS_LIMITS.transferWithAuthorization.fixedLimit;

/** keccak256("Transfer(address,address,uint256)") — the T024 transfer proof. */
export const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

/** An indexed address as it appears in a log topic (left-padded to 32 bytes). */
export function addressTopic(addr: string): string {
  return `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

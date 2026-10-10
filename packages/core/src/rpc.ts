// RPC endpoint priority (research D10): ALCHEMY_RPC_URL → RPC_URL → the
// deployment record's rpcUrl. One definition — both apps and every job send
// reads through the same precedence, batching stays OFF at the transport.
import { KITE_DEPLOYMENT } from "@kite/contracts";
import { optionalEnv } from "./env.js";

export function rpcUrl(): string {
  return optionalEnv("ALCHEMY_RPC_URL") ?? optionalEnv("RPC_URL") ?? KITE_DEPLOYMENT.rpcUrl;
}

// T016 — the demo identity hash (data-model §3, research D6): computed
// CLIENT-SIDE once per verification; the documents themselves never leave the
// device. The formula binds the domain, both materials, AND the account.
import { concat, keccak256, toBytes } from "viem";

export function demoIdentityHash(
  wallet: string,
  ktpBytes: Uint8Array,
  selfieBytes: Uint8Array,
): `0x${string}` {
  return keccak256(
    concat([toBytes("kite-demo-v1"), keccak256(ktpBytes), keccak256(selfieBytes), toBytes(wallet)]),
  );
}

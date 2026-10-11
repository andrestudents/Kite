// Shared ChainClient test fixture (chain.ts is never hit under bun test).
// Every method has a neutral default; tests override only what they assert on.
import type { ChainClient, IsaOnchain } from "./chain.js";

export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
export const ZERO_ADDRESS = `0x${"00".repeat(20)}`;

export function fakeChain(overrides: Partial<ChainClient> = {}): ChainClient {
  const base: ChainClient = {
    async chainId() {
      return 10143;
    },
    async blockNumber() {
      return 100n;
    },
    async isaOf(_isaId: number): Promise<IsaOnchain> {
      return {
        principal: 0,
        shareBps: 0,
        capMult: 0,
        termEnd: 0,
        channelId: 1,
        seeker: ZERO_ADDRESS,
        backer: ZERO_ADDRESS,
        remaining: 0,
        activatedAt: 0,
        lastEventAt: 0,
        eventCount: 0,
        status: 0,
      };
    },
    async offerOf() {
      return 600_000_000; // BASE_MAX_P at score 0 (§6.2)
    },
    async scoreOf() {
      return 0;
    },
    async profileOf() {
      return { totalIsas: 0, completed: 0, qualEvents: 0, distinctBackers: 0 };
    },
    async channelOf() {
      return { name: "demo", pubkey: ZERO_BYTES32, active: true };
    },
    async identityOf() {
      return ZERO_BYTES32;
    },
    async walletOfIdentity() {
      return ZERO_ADDRESS;
    },
    async balanceAusd() {
      return 0n;
    },
    async minEventGap() {
      return 60;
    },
    async blockTimestamp() {
      return 1_791_580_000;
    },
    async blockAtOrAfter() {
      return 0n;
    },
    async settlementLogs() {
      return [];
    },
    async channelRegisteredIds() {
      return [];
    },
    async isaEventIds() {
      return [];
    },
  };
  return { ...base, ...overrides };
}

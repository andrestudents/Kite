// Chain reads (constitution IV): the contract is the only authority; this
// service is the typed read surface over the published @kite/contracts ABIs —
// nothing is re-declared. RPC priority (D10): ALCHEMY_RPC_URL → RPC_URL →
// KITE_DEPLOYMENT.rpcUrl. JSON-RPC batching stays OFF (the Foundation RPC
// rejects batches). Tests inject a fake ChainClient — nothing here is hit
// under bun test.
import {
  createPublicClient,
  getAbiItem,
  http,
  type Abi,
  type PublicClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { KITE_DEPLOYMENT, abis } from "@kite/contracts";
import { optionalEnv } from "@kite/core";

export const PROXY = KITE_DEPLOYMENT.kiteCore;
export const AUSD = KITE_DEPLOYMENT.ausd;

const CORE_ABI = abis.kitecore as unknown as Abi;
const AUSD_ABI = abis.mockausd as unknown as Abi;
const INCOME_SETTLED = getAbiItem({ abi: CORE_ABI, name: "IncomeSettled" });
const CHANNEL_REGISTERED = getAbiItem({ abi: CORE_ABI, name: "ChannelRegistered" });
// Any isa lifecycle event reveals its isaId; isaOf() then states the truth.
const ISA_EVENT_NAMES = [
  "ISADrafted",
  "ISAActivated",
  "ISACompletedCapped",
  "ISACompletedAtTerm",
  "ISACancelled",
] as const;
const ISA_EVENTS = ISA_EVENT_NAMES.map((name) => getAbiItem({ abi: CORE_ABI, name }));

/** isaOf() read back — integer money as numbers (D14; ≪ 2^53 at demo scale). */
export interface IsaOnchain {
  principal: number;
  shareBps: number;
  capMult: number;
  termEnd: number;
  channelId: number;
  seeker: string;
  backer: string;
  remaining: number;
  activatedAt: number;
  lastEventAt: number;
  eventCount: number;
  status: number;
}

export interface ProfileOnchain {
  totalIsas: number;
  completed: number;
  qualEvents: number;
  distinctBackers: number;
}

export interface ChannelOnchain {
  name: string;
  pubkey: string;
  active: boolean;
}

/** One IncomeSettled log, decoded (research D9). */
export interface SettlementLog {
  isaId: number;
  channelId: number;
  purchaseRef: string;
  gross: number;
  toBacker: number;
  toSeeker: number;
  remaining: number;
  qualifying: boolean;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
}

export interface ChainClient {
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  isaOf(isaId: number): Promise<IsaOnchain>;
  offerOf(wallet: string): Promise<number>;
  scoreOf(wallet: string): Promise<number>;
  profileOf(wallet: string): Promise<ProfileOnchain>;
  channelOf(id: number): Promise<ChannelOnchain>;
  identityOf(wallet: string): Promise<string>;
  walletOfIdentity(identityHash: string): Promise<string>;
  balanceAusd(wallet: string): Promise<bigint>;
  minEventGap(): Promise<number>;
  blockTimestamp(blockNumber: bigint): Promise<number>;
  /** Smallest block whose timestamp is ≥ the target (binary search) — how the
   *  watcher seed resolves "the deployment block" from KITE_DEPLOYMENT.deployedAt. */
  blockAtOrAfter(timestampSec: number): Promise<bigint>;
  settlementLogs(fromBlock: bigint, toBlock: bigint): Promise<SettlementLog[]>;
  /** Distinct channel ids registered in the range (T017 bootstrap). */
  channelRegisteredIds(fromBlock: bigint, toBlock: bigint): Promise<number[]>;
  /** Distinct isaIds touched by any isa lifecycle event in the range (T017). */
  isaEventIds(fromBlock: bigint, toBlock: bigint): Promise<number[]>;
}

export function rpcUrl(): string {
  return optionalEnv("ALCHEMY_RPC_URL") ?? optionalEnv("RPC_URL") ?? KITE_DEPLOYMENT.rpcUrl;
}

export function makeChainClient(): ChainClient {
  if (KITE_DEPLOYMENT.chainId !== 10143) {
    throw new Error(`unexpected deployment chain ${KITE_DEPLOYMENT.chainId}`);
  }
  const client: PublicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl(), { timeout: 15_000 }),
  });

  const read = (functionName: string, args: unknown[] = []): Promise<unknown> =>
    client.readContract({ address: PROXY, abi: CORE_ABI, functionName, args });

  return {
    async chainId() {
      return Number(await client.getChainId());
    },
    async blockNumber() {
      return client.getBlockNumber();
    },
    async isaOf(isaId) {
      const raw = (await read("isaOf", [BigInt(isaId)])) as {
        terms: {
          principal: bigint;
          shareBps: bigint;
          capMult: bigint;
          termEnd: bigint;
          channelId: bigint;
        };
        seeker: string;
        backer: string;
        remaining: bigint;
        activatedAt: bigint;
        lastEventAt: bigint;
        eventCount: bigint;
        status: number;
      };
      return {
        principal: Number(raw.terms.principal),
        shareBps: Number(raw.terms.shareBps),
        capMult: Number(raw.terms.capMult),
        termEnd: Number(raw.terms.termEnd),
        channelId: Number(raw.terms.channelId),
        seeker: raw.seeker,
        backer: raw.backer,
        remaining: Number(raw.remaining),
        activatedAt: Number(raw.activatedAt),
        lastEventAt: Number(raw.lastEventAt),
        eventCount: Number(raw.eventCount),
        status: Number(raw.status),
      };
    },
    async offerOf(wallet) {
      return Number(await read("offerOf", [wallet]));
    },
    async scoreOf(wallet) {
      return Number(await read("scoreOf", [wallet]));
    },
    async profileOf(wallet) {
      const raw = (await read("profileOf", [wallet])) as {
        totalISAs: bigint;
        completed: bigint;
        qualEvents: bigint;
        distinctBackers: bigint;
      };
      return {
        totalIsas: Number(raw.totalISAs),
        completed: Number(raw.completed),
        qualEvents: Number(raw.qualEvents),
        distinctBackers: Number(raw.distinctBackers),
      };
    },
    async channelOf(id) {
      const raw = (await read("channelOf", [BigInt(id)])) as [string, string, boolean];
      return { name: raw[0], pubkey: raw[1], active: raw[2] };
    },
    async identityOf(wallet) {
      return (await read("identityOf", [wallet])) as string;
    },
    async walletOfIdentity(identityHash) {
      return (await read("walletOfIdentity", [identityHash])) as string;
    },
    async balanceAusd(wallet) {
      return client.readContract({
        address: AUSD,
        abi: AUSD_ABI,
        functionName: "balanceOf",
        args: [wallet],
      }) as Promise<bigint>;
    },
    async minEventGap() {
      return Number(await read("minEventGap"));
    },
    async blockTimestamp(blockNumber) {
      const block = await client.getBlock({ blockNumber });
      return Number(block.timestamp);
    },
    async blockAtOrAfter(target) {
      const timestampOf = async (n: bigint) =>
        Number((await client.getBlock({ blockNumber: n })).timestamp);
      let lo = 0n;
      let hi = await client.getBlockNumber();
      if ((await timestampOf(hi)) < target) {
        return hi; // chain head is older than the target — nothing to find later
      }
      while (lo < hi) {
        const mid = (lo + hi) / 2n;
        if ((await timestampOf(mid)) < target) {
          lo = mid + 1n;
        } else {
          hi = mid;
        }
      }
      return lo;
    },
    async settlementLogs(fromBlock, toBlock) {
      // JSON-imported ABI keeps viem's log typing broad — decode explicitly.
      const logs = (await client.getLogs({
        address: PROXY,
        event: INCOME_SETTLED as never,
        fromBlock,
        toBlock,
      })) as unknown as Array<{
        args: {
          isaId: bigint;
          channelId: bigint;
          purchaseRef: string;
          gross: bigint;
          toBacker: bigint;
          toSeeker: bigint;
          remaining: bigint;
          qualifying: boolean;
        };
        blockNumber: bigint;
        logIndex: number;
        transactionHash: string;
      }>;
      return logs.map((log) => ({
        isaId: Number(log.args.isaId),
        channelId: Number(log.args.channelId),
        purchaseRef: String(log.args.purchaseRef),
        gross: Number(log.args.gross),
        toBacker: Number(log.args.toBacker),
        toSeeker: Number(log.args.toSeeker),
        remaining: Number(log.args.remaining),
        qualifying: Boolean(log.args.qualifying),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
      }));
    },
    async channelRegisteredIds(fromBlock, toBlock) {
      const logs = (await client.getLogs({
        address: PROXY,
        event: CHANNEL_REGISTERED as never,
        fromBlock,
        toBlock,
      })) as unknown as Array<{ args: { id: bigint } }>;
      return [...new Set(logs.map((log) => Number(log.args.id)))];
    },
    async isaEventIds(fromBlock, toBlock) {
      const ids = new Set<number>();
      for (const event of ISA_EVENTS) {
        const logs = (await client.getLogs({
          address: PROXY,
          event: event as never,
          fromBlock,
          toBlock,
        })) as unknown as Array<{ args: { isaId: bigint } }>;
        for (const log of logs) {
          ids.add(Number(log.args.isaId));
        }
      }
      return [...ids];
    },
  };
}

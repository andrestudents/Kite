// T006 — direct read-only chain reads (research D4): alongside 005's API the
// app re-derives the numbers that authorize actions — offerOf for the Dukung
// cap, isaOf for live deal state, balanceOf for Kirim — straight from the
// contract through the public RPC. PURE READS ONLY: every state-changing path
// rides FR-011's seam (jobs route or the drip-funded draft); nothing here
// signs or broadcasts. Money is bigint base units; `status` stays the
// contract's machine value (ISA.sol: 0 None · 1 Drafted · 2 Active ·
// 3 CompletedCapped · 4 CompletedAtTerm · 5 Cancelled) — only data/ may
// translate it.
import { abis, KITE_DEPLOYMENT } from "@kite/contracts";
import { createPublicClient, http, isAddress, type PublicClient } from "viem";
import { monadTestnet } from "viem/chains";

export const ISA_STATUS = {
  none: 0,
  drafted: 1,
  active: 2,
  completedCapped: 3,
  completedAtTerm: 4,
  cancelled: 5,
} as const;

/** The contract's status machine value, verbatim (data/ interprets it). */
export type IsaStatusCode = (typeof ISA_STATUS)[keyof typeof ISA_STATUS];

export type HexAddress = `0x${string}`;

/** isaOf's return, mapped field-for-field (data-model §1 read-seams). */
export interface IsaOnChain {
  isaId: bigint;
  principal: bigint;
  shareBps: number;
  capMult: number;
  termEnd: bigint;
  channelId: bigint;
  seeker: HexAddress;
  backer: HexAddress;
  remaining: bigint;
  activatedAt: bigint;
  lastEventAt: bigint;
  eventCount: bigint;
  status: IsaStatusCode;
}

/** profileOf's return — counts only; the score lives in scoreOf. */
export interface ProfileOnChain {
  totalIsas: number;
  completed: number;
  qualEvents: number;
  distinctBackers: number;
}

/** The public Monad endpoint (non-secret; VITE_RPC_URL may point elsewhere). */
export function chainRpcUrl(): string {
  return import.meta.env.VITE_RPC_URL ?? KITE_DEPLOYMENT.rpcUrl;
}

/** One shared read client (research D4: direct public-RPC reads). */
export function makeChainClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl ?? chainRpcUrl()),
  });
}

/** The single module client — screens reach it only through data/. */
export const chainClient: PublicClient = makeChainClient();

function assertAddress(value: unknown, what: string): HexAddress {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${what} is not a valid address`);
  }
  return value.toLowerCase() as HexAddress;
}

/** viem's decoded ISA struct → IsaOnChain (pure — fixture-testable). */
export function decodeIsa(isaId: bigint, raw: unknown): IsaOnChain {
  const isa = raw as {
    terms: {
      principal: bigint;
      shareBps: number;
      capMult: number;
      termEnd: bigint;
      channelId: bigint;
    };
    seeker: HexAddress;
    backer: HexAddress;
    remaining: bigint;
    activatedAt: bigint;
    lastEventAt: bigint;
    eventCount: bigint;
    status: number;
  };
  if (!Number.isInteger(isa.status) || isa.status < 0 || isa.status > 5) {
    throw new Error(`unknown status machine value: ${String(isa.status)}`);
  }
  return {
    isaId,
    principal: isa.terms.principal,
    shareBps: isa.terms.shareBps,
    capMult: isa.terms.capMult,
    termEnd: isa.terms.termEnd,
    channelId: isa.terms.channelId,
    seeker: isa.seeker,
    backer: isa.backer,
    remaining: isa.remaining,
    activatedAt: isa.activatedAt,
    lastEventAt: isa.lastEventAt,
    eventCount: isa.eventCount,
    status: isa.status as IsaStatusCode,
  };
}

/** viem's decoded Profile struct → ProfileOnChain (pure). */
export function decodeProfile(raw: unknown): ProfileOnChain {
  const p = raw as {
    totalISAs: bigint;
    completed: bigint;
    qualEvents: bigint;
    distinctBackers: bigint;
  };
  return {
    totalIsas: Number(p.totalISAs),
    completed: Number(p.completed),
    qualEvents: Number(p.qualEvents),
    distinctBackers: Number(p.distinctBackers),
  };
}

/** The read surface data/ consumes. `client` is injectable for tests. */
export interface ChainReader {
  /** Max supportable principal (cap base units) for a seeker's next deal. */
  offerOf(seeker: HexAddress): Promise<bigint>;
  /** The deal's full live state; machine status untouched. */
  isaOf(isaId: bigint): Promise<IsaOnChain>;
  /** Track-record counts (constitution IX's live inputs). */
  profileOf(seeker: HexAddress): Promise<ProfileOnChain>;
  /** The wallet's AUSD balance in base units. */
  balanceAusd(holder: HexAddress): Promise<bigint>;
  /** The guidance rule's input (PLAN §6.3): share = 2000 − 8×score bps. */
  scoreOf(seeker: HexAddress): Promise<number>;
  /** The channel registry row — a draft must name an ACTIVE channel. */
  channelOf(id: number): Promise<{ name: string; pubkey: `0x${string}`; active: boolean }>;
  /** The AUSD permit nonce for an owner (ERC-2612) — Dukung's signature. */
  ausdNonces(owner: HexAddress): Promise<bigint>;
}

export function makeChainReader(client: PublicClient = chainClient): ChainReader {
  const core = {
    abi: abis.kitecore,
    address: KITE_DEPLOYMENT.kiteCore as HexAddress,
  } as const;
  const ausd = {
    abi: abis.mockausd,
    address: KITE_DEPLOYMENT.ausd as HexAddress,
  } as const;

  return {
    offerOf(seeker) {
      return client.readContract({
        ...core,
        functionName: "offerOf",
        args: [assertAddress(seeker, "seeker")],
      }) as Promise<bigint>;
    },
    async isaOf(isaId) {
      const raw = await client.readContract({
        ...core,
        functionName: "isaOf",
        args: [isaId],
      });
      return decodeIsa(isaId, raw);
    },
    async profileOf(seeker) {
      const raw = await client.readContract({
        ...core,
        functionName: "profileOf",
        args: [assertAddress(seeker, "seeker")],
      });
      return decodeProfile(raw);
    },
    balanceAusd(holder) {
      return client.readContract({
        ...ausd,
        functionName: "balanceOf",
        args: [assertAddress(holder, "holder")],
      }) as Promise<bigint>;
    },
    async scoreOf(seeker) {
      const raw = await client.readContract({
        ...core,
        functionName: "scoreOf",
        args: [assertAddress(seeker, "seeker")],
      });
      return Number(raw);
    },
    async channelOf(id) {
      const raw = await client.readContract({
        ...core,
        functionName: "channelOf",
        args: [BigInt(id)],
      });
      const row = raw as [string, `0x${string}`, boolean];
      const name = row[0];
      const pubkey = row[1];
      return { name: name ?? "", pubkey: pubkey ?? "0x", active: row[2] === true };
    },
    async ausdNonces(owner) {
      const raw = await client.readContract({
        ...ausd,
        functionName: "nonces",
        args: [assertAddress(owner, "owner")],
      });
      return raw as bigint;
    },
  };
}

/** The module-level reader data/ uses. */
export const chainReader: ChainReader = makeChainReader();

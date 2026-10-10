// Shared DTO shapes (contracts/http-api.md) — imported by both services.
// Money is integral JSON numbers in AUSD base units (D14); timestamps are
// ISO-8601 strings; status values are uppercase machine states (data, not
// copy — D18).
import type { PurchaseStatus } from "./db/schema.js";

export interface PurchaseDto {
  id: string;
  channelId: number;
  isaId: number;
  purchaseRef: string;
  grossAusd: number;
  status: PurchaseStatus;
  txHash: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface RelayerJobDto {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  txHash: string | null;
  lastError: string | null;
  terminalAt: string | null;
}

export interface ProfileField {
  score: number;
  maxSupportAusd: number;
  totalIsas: number;
  completed: number;
  qualEvents: number;
  distinctBackers: number;
}

export interface ActiveIsa {
  isaId: number;
  backer: string;
  principalAusd: number;
  shareBps: number;
  capMult: number;
  capAusd: number;
  remainingAusd: number;
  progressBps: number;
  termEnd: number;
  channelId: number;
}

export interface RecentPurchase {
  purchaseRef: string;
  grossAusd: number;
  status: PurchaseStatus;
  txHash: string | null;
  settledAt: string | null;
}

export interface MeDto {
  wallet: string;
  balanceAusd: number;
  identityBound: boolean;
  profile: ProfileField;
  activeIsa: ActiveIsa | null;
  recentPurchases: RecentPurchase[];
}

export interface ProfileDealEvent {
  grossAusd: number;
  toBackerAusd: number;
  toSeekerAusd: number;
  remainingAusd: number;
  txHash: string;
  blockTime: string;
}

export interface ProfileDeal {
  isaId: number;
  principalAusd: number;
  shareBps: number;
  capAusd: number;
  totalDivertedAusd: number;
  status: string;
  events: ProfileDealEvent[];
}

export interface ProfileDto {
  id: string;
  wallet: string;
  reputation: { score: number; completedDeals: number; qualEvents: number };
  deals: ProfileDeal[];
  explorerBaseUrl: string;
}

export interface QuoteDto {
  pair: string;
  rate: number;
  scale: number;
  expiresAt: string;
  source: string;
}

export interface HealthDependency {
  ok: boolean;
  detail: string;
  chainId?: number;
  blockNumber?: number;
}

export interface HealthDto {
  status: "ok" | "degraded";
  db: HealthDependency;
  rpc: HealthDependency;
  time: string;
}

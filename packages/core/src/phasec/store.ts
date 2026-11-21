import type { PassCoin, PassPosition } from "./pass.js";
import type { ResolvedReturn } from "./paper.js";
import type { Stage } from "./protocol.js";
import type { TierWallet } from "./risk.js";

export interface PhaseCStore {
  protocol(): Promise<{ fingerprint: string; body: string; registeredAt: Date } | null>;
  saveProtocol(fingerprint: string, body: string, at: Date): Promise<void>;
  coins(limit: number): Promise<PassCoin[]>;
  mentionCounts(mints: readonly string[]): Promise<Map<string, number>>;
  positions(): Promise<PassPosition[]>;
  closedBetween(start: Date, end: Date): Promise<Array<{ sizePct: number; netReturn: number }>>;
  isPaused(day: string): Promise<boolean>;
  pause(day: string, reason: string, at: Date): Promise<void>;
  alerted(): Promise<Array<{ mint: string; stage: Stage }>>;
  recentEntryCount(since: Date): Promise<number>;
  held(): Promise<Array<{ id: string; text: string }>>;
  insertEntry(input: {
    mint: string;
    stage: Stage;
    arm: string;
    sizePct: number;
    strength: number;
    exitPlan: string;
    text: string;
    held: boolean;
    heldReason?: "quiet" | "control" | null;
    fingerprint?: string | null;
    tradableInFomo?: boolean | null;
    alertAt: Date;
    entryAfter: Date;
  }): Promise<string>;
  markDelivered(ids: readonly string[], at: Date): Promise<void>;
  openPosition(
    id: string,
    quote: number,
    impactPct: number,
    feeUsd: number,
    sizeUsd: number,
    outAmount: string,
    fomoFeeUsd: number,
    quoteSource: string,
    at: Date,
  ): Promise<void>;
  markSellWarned(ids: readonly string[]): Promise<void>;
  markScaled(ids: readonly string[], at: Date): Promise<void>;
  saveMintCache(
    rows: readonly {
      mint: string;
      mintAuthorityActive: boolean | null;
      freezeAuthorityActive: boolean | null;
      top10Pct: number | null;
      sniperPct: number | null;
      curveLiquidityUsd: number | null;
      exitImpactPct: number | null;
    }[],
    at: Date,
  ): Promise<void>;
  recentCandidates(days: number): Promise<number>;
  secondWaveMints(
    limit: number,
  ): Promise<Array<{ mint: string; createdAt: Date; graduatedAt: Date }>>;
  pruneSnapshots(olderThan: Date): Promise<void>;
  saveSnapshots(
    rows: readonly {
      mint: string;
      at: Date;
      priceUsd: number | null;
      liquidityUsd: number | null;
      volume1h: number | null;
      volume24h?: number | null;
    }[],
  ): Promise<void>;
  waveHistory(mints: readonly string[]): Promise<
    Map<
      string,
      {
        volume7dUsd: number | null;
        rangeHigh: number | null;
        liquidityGrowthPct: number | null;
      }
    >
  >;
  recordScreenCredits(credits: number, at: Date): Promise<void>;
  voidPaperWindow(at: Date): Promise<void>;
  clearProtocol(): Promise<void>;
  tradableCounts(): Promise<{ yes: number; no: number; unknown: number }>;
  scoreShadow(): Promise<{
    rankedCount: number;
    lookbackStart: string | null;
    lookbackEnd: string | null;
    cutoff: string | null;
    entryCount: number;
    scoringVersion: number;
  } | null>;
  markPaperClosed(): Promise<void>;
  closePosition(input: {
    id: string;
    quote: number;
    net: number;
    net2x: number;
    reason: string;
    impactPct: number | null;
    feeUsd: number | null;
    failure: string | null;
    fomoFeeUsd?: number;
    quoteSource?: string | null;
    at: Date;
  }): Promise<void>;
  wallets(): Promise<TierWallet[]>;
  pendingTiers(): Promise<string[]>;
  insertTier(wallet: string, at: Date): Promise<void>;
  activeAddresses(): Promise<string[]>;
  snapshot(): Promise<string[]>;
  replaceSnapshot(addresses: readonly string[]): Promise<void>;
  weeklyExists(week: string): Promise<boolean>;
  saveWeekly(week: string, body: string, at: Date): Promise<void>;
  resolvedReturns(): Promise<ResolvedReturn[]>;
  graduatedMints(limit: number): Promise<string[]>;
}

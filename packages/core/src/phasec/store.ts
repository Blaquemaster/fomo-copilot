import type { CandidateLogRow } from "./outcomes.js";
import type {
  PassCoin,
  PassPosition,
  PlannedQuoteFailure,
  PlannedScale,
  PlannedStreak,
} from "./pass.js";
import type { ResolvedReturn } from "./paper.js";
import type { Stage } from "./protocol.js";
import type { TierWallet } from "./risk.js";

export interface WalletSignalRules {
  /** A tracked wallet that touched more distinct mints than this in a day is a flip bot. */
  maxMintsPerDay: number;
  /** A tracked buy counts only if the wallet is still a net buyer and bought this recently. */
  freshMinutes: number;
  /** Wallets selected after this time are not on the frozen list. Null uses every active row. */
  freezeAt?: Date | null;
}

export const DEFAULT_WALLET_SIGNAL: WalletSignalRules = {
  maxMintsPerDay: 40,
  freshMinutes: 60,
  freezeAt: null,
};

export interface PhaseCStore {
  protocol(): Promise<{ fingerprint: string; body: string; registeredAt: Date } | null>;
  saveProtocol(fingerprint: string, body: string, at: Date): Promise<void>;
  coins(limit: number, signal?: WalletSignalRules): Promise<PassCoin[]>;
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
    sniperUnmeasured?: boolean;
    alertAt: Date;
    entryAfter: Date;
    alertPriceUsd?: number | null;
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
  markScaled(rows: readonly PlannedScale[], at: Date): Promise<void>;
  saveQuoteFailures(rows: readonly PlannedQuoteFailure[], at: Date): Promise<void>;
  insertCandidates(rows: readonly CandidateLogRow[], at: Date): Promise<void>;
  recordWalletList(
    listHash: string,
    walletCount: number,
    at: Date,
    freezeAt: Date | null,
  ): Promise<void>;
  dueObservations(
    now: Date,
    limit: number,
  ): Promise<
    Array<{ mint: string; label: string; role: string; dueAt: Date; entryOutAmount: string | null }>
  >;
  observationBacklog(now: Date): Promise<{ due: number; pending: number }>;
  claimObservation(mint: string, label: string, now: Date): Promise<boolean>;
  saveObservation(input: {
    mint: string;
    label: string;
    observedAt: Date;
    late: boolean;
    priceUsd: number | null;
    status: "priced" | "missing" | "late";
    outAmount?: string | null;
  }): Promise<void>;
  dueCandidates(
    now: Date,
    limit: number,
  ): Promise<Array<{ id: string; mint: string; alertPriceUsd: number | null }>>;
  saveCandidateOutcome(
    id: string,
    status: "priced" | "missing",
    priceUsd: number | null,
    net: number | null,
  ): Promise<void>;
  saveNoRouteStreaks(rows: readonly PlannedStreak[]): Promise<void>;
  openPools(
    mints: readonly string[],
  ): Promise<Array<{ mint: string; pool: string; poolType: string | null }>>;
  saveMintCache(
    rows: readonly {
      mint: string;
      mintAuthorityActive: boolean | null;
      freezeAuthorityActive: boolean | null;
      top10Pct: number | null;
      sniperPct: number | null;
      curveLiquidityUsd: number | null;
      exitImpactPct: number | null;
      entryImpactPct?: number | null;
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
    net: number | null;
    net2x: number | null;
    reason: string;
    impactPct: number | null;
    feeUsd: number | null;
    failure: string | null;
    fomoFeeUsd?: number | null;
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
  saveAutobuyIntents(
    rows: readonly {
      kind: "entry" | "exit";
      mint: string;
      arm: string;
      stage: string;
      sizeUsd: number | null;
      quotePrice: number | null;
      expectedOut: string | null;
      slippageBps: number | null;
      reason: string;
      simulated: "ok" | "err" | "skipped";
    }[],
    at: Date,
  ): Promise<void>;
  autobuySpentSince(start: Date): Promise<number>;
  autobuyReview(): Promise<{ entries: number; exits: number }>;
}

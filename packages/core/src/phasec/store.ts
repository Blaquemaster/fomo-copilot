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
    alertAt: Date;
    entryAfter: Date;
  }): Promise<string>;
  markDelivered(ids: readonly string[], at: Date): Promise<void>;
  openPosition(id: string, quote: number, at: Date): Promise<void>;
  closePosition(id: string, quote: number, net: number, reason: string, at: Date): Promise<void>;
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

import {
  QUOTE_MINTS,
  WALLET_SUB_CHUNK,
  WALLET_TRACK_PROGRAMS,
  WALLET_TRADE_NAMES,
  venueForProgram,
} from "./programs.js";

/**
 * Registered before the first build, and before any Phase D window exists.
 * A winner is a mint that later graduated (pump migrate, LaunchLab migrate, or
 * DBC migration). An early buy is a non-creator buy already stored in pump_trade,
 * which only keeps the short window after create. Lookback is all of that stored
 * history. The list must be frozen before Phase D and is not tuned on a paper window.
 */
/** Bump when the scoring rules change enough that the live list must be rebuilt. */
export const SCORING_VERSION = 2;

export const LOSS_AGE_MS = {
  pump: 2 * 60 * 60 * 1000,
  launchlab: 2 * 60 * 60 * 1000,
  meteora: 60 * 60 * 1000,
} as const;

export const PROVEN_WALLET_RULE = {
  minEntries: 5,
  minLosses: 1,
  botMaxEntries: 80,
  /** Beta(1, 1). Shrunk rate is (wins + 1) / (entries + 2). */
  minShrunkRate: 0.6,
  priorWins: 1,
  priorLosses: 1,
  lookback: "all stored history before Phase D",
  earlyWindow: "non-creator buys on coins whose outcome is known",
  winner: "mint with a stored graduation",
} as const;

export interface EarlyBuy {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  graduated: boolean;
  /** False when this mint is neither graduated nor a finished backfill loss. */
  outcomeKnown?: boolean;
  slot?: number | null;
  createdSlot?: number | null;
  createdAt?: Date | string | null;
  venue?: string | null;
}

export interface ScoreOptions {
  minEntries?: number;
  minLosses?: number;
  botMaxEntries?: number;
  minShrunkRate?: number;
  priorWins?: number;
  priorLosses?: number;
}

export interface ScoredWallet {
  address: string;
  earlyEntries: number;
  earlyWins: number;
  hitRate: number;
  derivation: string;
}

export function shrunkHitRate(
  wins: number,
  entries: number,
  priorWins = 1,
  priorLosses = 1,
): number {
  const safeEntries = Math.max(0, entries);
  const safeWins = Math.max(0, Math.min(wins, safeEntries));
  return (safeWins + priorWins) / (safeEntries + priorWins + priorLosses);
}

export function scoreProvenWallets(
  rows: readonly EarlyBuy[],
  maxWallets: number,
  options: ScoreOptions = {},
): ScoredWallet[] {
  const minEntries = options.minEntries ?? PROVEN_WALLET_RULE.minEntries;
  const minLosses = options.minLosses ?? PROVEN_WALLET_RULE.minLosses;
  const botMaxEntries = options.botMaxEntries ?? PROVEN_WALLET_RULE.botMaxEntries;
  const minShrunkRate = options.minShrunkRate ?? PROVEN_WALLET_RULE.minShrunkRate;
  const priorWins = options.priorWins ?? PROVEN_WALLET_RULE.priorWins;
  const priorLosses = options.priorLosses ?? PROVEN_WALLET_RULE.priorLosses;
  const byWallet = new Map<
    string,
    {
      buys: Map<string, EarlyBuy>;
      sells: Map<string, EarlyBuy>;
      graduated: Set<string>;
    }
  >();
  for (const row of rows) {
    if (!row.wallet || row.outcomeKnown === false) continue;
    const bucket = byWallet.get(row.wallet) ?? {
      buys: new Map<string, EarlyBuy>(),
      sells: new Map<string, EarlyBuy>(),
      graduated: new Set<string>(),
    };
    if (row.side === "buy") keepEarliest(bucket.buys, row);
    else keepEarliest(bucket.sells, row);
    if (row.graduated) bucket.graduated.add(row.mint);
    byWallet.set(row.wallet, bucket);
  }
  const scored: ScoredWallet[] = [];
  for (const [address, bucket] of byWallet) {
    if (bucket.buys.size > botMaxEntries) continue;
    const counted = [...bucket.buys.values()].filter(
      (row) => !isSniper(row) && !isScalp(row, bucket.sells),
    );
    const earlyEntries = counted.length;
    if (earlyEntries < minEntries) continue;
    const earlyWins = counted.filter((row) => bucket.graduated.has(row.mint)).length;
    const earlyLosses = earlyEntries - earlyWins;
    if (earlyWins < 1 || earlyLosses < minLosses) continue;
    const winnerSells = [...bucket.sells.values()].filter((row) => {
      const buy = bucket.buys.get(row.mint);
      if (buy && isScalp(buy, bucket.sells)) return false;
      return bucket.graduated.has(row.mint);
    }).length;
    if (winnerSells >= earlyWins) continue;
    const snipes = [...bucket.buys.values()].filter((row) => isSniper(row)).length;
    const scalps = [...bucket.buys.values()].filter((row) => isScalp(row, bucket.sells)).length;
    if (snipes > earlyEntries || scalps > earlyEntries) continue;
    const hitRate = shrunkHitRate(earlyWins, earlyEntries, priorWins, priorLosses);
    if (hitRate < minShrunkRate) continue;
    scored.push({
      address,
      earlyEntries,
      earlyWins,
      hitRate,
      derivation:
        "shrunk hit rate on covered coins, wins and losers; same-slot snipes and same-slot round trips are left out; funding source unknown so each address counts once",
    });
  }
  scored.sort((left, right) => {
    if (right.hitRate !== left.hitRate) return right.hitRate - left.hitRate;
    if (right.earlyWins !== left.earlyWins) return right.earlyWins - left.earlyWins;
    return left.address < right.address ? -1 : 1;
  });
  return scored.slice(0, Math.max(0, maxWallets));
}

function keepEarliest(bucket: Map<string, EarlyBuy>, row: EarlyBuy): void {
  const previous = bucket.get(row.mint);
  if (!previous || earlierSlot(row, previous)) bucket.set(row.mint, row);
}

function earlierSlot(next: EarlyBuy, previous: EarlyBuy): boolean {
  if (next.slot == null) return false;
  if (previous.slot == null) return true;
  return next.slot < previous.slot;
}

function isSniper(row: EarlyBuy): boolean {
  return row.slot != null && row.createdSlot != null && row.slot === row.createdSlot;
}

/** A non-graduated coin is a loss only after it is old enough that graduation was likely. */
export function applyLossMaturity(
  rows: readonly EarlyBuy[],
  now: Date,
  ages: { pumpMs: number; meteoraMs: number } = {
    pumpMs: LOSS_AGE_MS.pump,
    meteoraMs: LOSS_AGE_MS.meteora,
  },
): EarlyBuy[] {
  return rows.map((row) => {
    if (row.graduated) return { ...row, outcomeKnown: true };
    const created =
      row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : typeof row.createdAt === "string"
          ? new Date(row.createdAt).getTime()
          : null;
    if (created === null || Number.isNaN(created)) return { ...row, outcomeKnown: false };
    const wait = row.venue === "meteora" ? ages.meteoraMs : ages.pumpMs;
    return { ...row, outcomeKnown: now.getTime() - created >= wait };
  });
}

function isScalp(row: EarlyBuy, sells: ReadonlyMap<string, EarlyBuy>): boolean {
  const sell = sells.get(row.mint);
  return sell?.slot != null && row.slot != null && sell.slot === row.slot;
}

export function chunkWallets(addresses: readonly string[], size = WALLET_SUB_CHUNK): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < addresses.length; index += size) {
    chunks.push(addresses.slice(index, index + size));
  }
  return chunks;
}

export function walletCreditCapMicros(allowanceMicros: bigint, budgetPct: number): bigint {
  const pct = Number.isFinite(budgetPct) ? Math.max(0, Math.min(100, Math.floor(budgetPct))) : 0;
  return (allowanceMicros * BigInt(pct)) / 100n;
}

export function walletBudgetOpen(spentMicros: bigint, capMicros: bigint): boolean {
  return spentMicros < capMicros;
}

export interface WalletRefresh {
  keep: string[];
  upsert: ScoredWallet[];
  replaced: number;
  added: number;
}

/**
 * Daily refresh. An empty live set may fill up to maxWallets. After that, at most
 * maxChurnPct of the current addresses are replaced. Empty slots under the cap
 * may still be filled. Wallets that fell out of the ranked set are dropped first.
 * An empty ranking leaves the live set untouched, except when reset is set.
 */
export function nextTrackedSet(input: {
  ranked: readonly ScoredWallet[];
  active: readonly string[];
  maxWallets: number;
  maxChurnPct: number;
  /** Replace the whole live set. Used once when scoring_version changes. */
  reset?: boolean;
}): WalletRefresh {
  const maxWallets = Math.max(0, Math.floor(input.maxWallets));
  if (input.reset) {
    const upsert = input.ranked.slice(0, maxWallets);
    const keep = upsert.map((row) => row.address);
    const kept = new Set(keep);
    return {
      keep,
      upsert,
      replaced: input.active.filter((address) => !kept.has(address)).length,
      added: keep.filter((address) => !input.active.includes(address)).length,
    };
  }
  if (input.ranked.length === 0 || maxWallets === 0) {
    return { keep: [...input.active], upsert: [], replaced: 0, added: 0 };
  }
  if (input.active.length === 0) {
    const upsert = input.ranked.slice(0, maxWallets);
    return {
      keep: upsert.map((row) => row.address),
      upsert,
      replaced: 0,
      added: upsert.length,
    };
  }
  const pct = Number.isFinite(input.maxChurnPct)
    ? Math.max(0, Math.min(100, Math.floor(input.maxChurnPct)))
    : 0;
  const maxReplace = Math.floor((input.active.length * pct) / 100);
  const rank = new Map(input.ranked.map((row, index) => [row.address, index]));
  const activeSet = new Set(input.active);
  const fallen = input.active.filter((address) => {
    const place = rank.get(address);
    return place === undefined || place >= maxWallets;
  });
  fallen.sort((left, right) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank === undefined && rightRank !== undefined) return -1;
    if (rightRank === undefined && leftRank !== undefined) return 1;
    if (leftRank === undefined && rightRank === undefined) return left < right ? 1 : -1;
    return (rightRank ?? 0) - (leftRank ?? 0);
  });
  const dropped = new Set(fallen.slice(0, maxReplace));
  const kept = input.active.filter((address) => !dropped.has(address));
  const room = Math.max(0, maxWallets - kept.length);
  const added = input.ranked.filter((row) => !activeSet.has(row.address)).slice(0, room);
  const keep = [...kept, ...added.map((row) => row.address)];
  const upsert = keep
    .map((address) => input.ranked.find((row) => row.address === address))
    .filter((row): row is ScoredWallet => row !== undefined);
  return { keep, upsert, replaced: dropped.size, added: added.length };
}

export interface WalletFillDraft {
  signature: string;
  eventIndex: number;
  slot: number;
  mint: string;
  wallet: string;
  side: "buy" | "sell" | "swap";
  venue: string;
}

const MINT_ACCOUNT_NAMES = new Set([
  "mint",
  "basemint",
  "tokenmint",
  "basetokenmint",
  "tokenamint",
]);
const WALLET_ACCOUNT_NAMES = new Set(["user", "payer", "buyer", "seller", "trader", "owner"]);

/**
 * A tracked wallet's trade on a watched venue. Mint and wallet come from named
 * accounts on the parsed instruction. Direction is buy, sell, or swap when the
 * instruction name does not say which way.
 */
export function walletFillsFromParsed(
  message: unknown,
  tracked: ReadonlySet<string>,
): WalletFillDraft[] {
  if (tracked.size === 0) return [];
  const root = asRecord(message);
  if (root?.["method"] !== "parsedTransactionNotification") return [];
  const params = asRecord(root["params"]);
  const result = asRecord(params?.["result"]);
  const value = asRecord(result?.["value"]);
  const transaction = asRecord(value?.["transaction"]);
  const context = asRecord(result?.["context"]);
  const signature =
    typeof transaction?.["signature"] === "string" ? transaction["signature"] : null;
  const slot =
    typeof transaction?.["slot"] === "number"
      ? transaction["slot"]
      : typeof context?.["slot"] === "number"
        ? context["slot"]
        : null;
  if (signature === null || slot === null || transaction?.["error"] != null) return [];
  const instructions = Array.isArray(value?.["instructions"]) ? value["instructions"] : [];
  const tradeNames = new Set(WALLET_TRADE_NAMES.map((name) => normalizeName(name)));
  const programs = new Set<string>(WALLET_TRACK_PROGRAMS);
  const fills: WalletFillDraft[] = [];
  instructions.forEach((instruction, eventIndex) => {
    const record = asRecord(instruction);
    if (record === null || typeof record["instructionName"] !== "string") return;
    const programId = typeof record["programId"] === "string" ? record["programId"] : "";
    if (!programs.has(programId)) return;
    if (!tradeNames.has(normalizeName(record["instructionName"]))) return;
    const venue = venueForProgram(programId);
    if (venue === null) return;
    const named = namedAccounts(record);
    const mint = mintFromNamed(named);
    const wallet = walletFromNamed(named, tracked);
    if (mint === null || wallet === null) return;
    fills.push({
      signature,
      eventIndex,
      slot,
      mint,
      wallet,
      side: tradeSide(record["instructionName"]),
      venue,
    });
  });
  return fills;
}

function tradeSide(name: string): "buy" | "sell" | "swap" {
  const normalized = normalizeName(name);
  if (normalized.includes("sell")) return "sell";
  if (normalized.includes("buy")) return "buy";
  return "swap";
}

function mintFromNamed(named: ReadonlyMap<string, string>): string | null {
  for (const key of MINT_ACCOUNT_NAMES) {
    const mint = named.get(key);
    if (mint && !QUOTE_MINTS.has(mint)) return mint;
  }
  return null;
}

function walletFromNamed(
  named: ReadonlyMap<string, string>,
  tracked: ReadonlySet<string>,
): string | null {
  for (const key of WALLET_ACCOUNT_NAMES) {
    const wallet = named.get(key);
    if (wallet && tracked.has(wallet)) return wallet;
  }
  for (const wallet of named.values()) {
    if (tracked.has(wallet)) return wallet;
  }
  return null;
}

function namedAccounts(instruction: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const decoded = asRecord(instruction["decoded"]);
  const accounts = decoded?.["accounts"];
  if (!Array.isArray(accounts)) return out;
  for (const account of accounts) {
    const record = asRecord(account);
    if (record && typeof record["name"] === "string" && typeof record["pubkey"] === "string") {
      out.set(normalizeName(record["name"]), record["pubkey"]);
    }
  }
  return out;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replaceAll("_", "").replaceAll(" ", "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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
export const PROVEN_WALLET_RULE = {
  minEntries: 2,
  lookback: "all stored history before Phase D",
  earlyWindow: "pump_trade rows, non-creator buys",
  winner: "mint with a stored graduation",
} as const;

export interface EarlyBuy {
  wallet: string;
  mint: string;
  side: "buy" | "sell";
  graduated: boolean;
}

export interface ScoredWallet {
  address: string;
  earlyEntries: number;
  earlyWins: number;
  hitRate: number;
  derivation: string;
}

export function scoreProvenWallets(rows: readonly EarlyBuy[], maxWallets: number): ScoredWallet[] {
  const byWallet = new Map<
    string,
    { buys: Set<string>; sells: Set<string>; graduated: Set<string> }
  >();
  for (const row of rows) {
    if (!row.wallet) continue;
    const bucket = byWallet.get(row.wallet) ?? {
      buys: new Set<string>(),
      sells: new Set<string>(),
      graduated: new Set<string>(),
    };
    if (row.side === "buy") bucket.buys.add(row.mint);
    else bucket.sells.add(row.mint);
    if (row.graduated) bucket.graduated.add(row.mint);
    byWallet.set(row.wallet, bucket);
  }
  const scored: ScoredWallet[] = [];
  for (const [address, bucket] of byWallet) {
    const earlyEntries = bucket.buys.size;
    if (earlyEntries < PROVEN_WALLET_RULE.minEntries) continue;
    const earlyWins = [...bucket.buys].filter((mint) => bucket.graduated.has(mint)).length;
    if (earlyWins < 1) continue;
    const winnerSells = [...bucket.sells].filter((mint) => bucket.graduated.has(mint)).length;
    if (winnerSells >= earlyWins) continue;
    scored.push({
      address,
      earlyEntries,
      earlyWins,
      hitRate: earlyWins / earlyEntries,
      derivation:
        "non-creator early buy in stored pump_trade; win = that mint later graduated; funding source unknown so each address counts once",
    });
  }
  scored.sort((left, right) => {
    if (right.hitRate !== left.hitRate) return right.hitRate - left.hitRate;
    if (right.earlyWins !== left.earlyWins) return right.earlyWins - left.earlyWins;
    return left.address < right.address ? -1 : 1;
  });
  return scored.slice(0, Math.max(0, maxWallets));
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

import { decodeBase58 } from "./base58.js";
import { decodeRpcTransaction } from "./decode.js";
import {
  DBC_PROGRAM_ID,
  DBC_SWAP_ACCOUNTS,
  DISC,
  LAUNCHLAB_PROGRAM_ID,
  LAUNCHLAB_TRADE_ACCOUNTS,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
} from "./programs.js";
import { historyPageCredits } from "./budget.js";

/** One oldest-first page. 1–100 full transactions cost 10 credits. */
export const EARLY_BUYER_PAGE_LIMIT = 100;
/** Stop after this many pages even if fewer than N non-creator buys were found. */
export const EARLY_BUYER_MAX_PAGES = 3;
export const WALLET_BACKFILL_FEATURE = "wallet_backfill";

export interface EarlyBuyerRow {
  signature: string;
  eventIndex: number;
  slot: number;
  mint: string;
  wallet: string;
  side: "buy" | "sell";
  venue: string;
  isCreator: boolean;
}

export interface BackfillTarget {
  mint: string;
  venue: string;
  account: string;
  creator: string | null;
  paginationToken: string | null;
  buysKept: number;
  pages: number;
}

export interface HistoryPage {
  transactions: unknown[];
  paginationToken: string | null;
}

export interface BackfillCheckpoint {
  mint: string;
  venue: string;
  account: string;
  status: "open" | "done";
  paginationToken: string | null;
  buysKept: number;
  pages: number;
  creditDelta: number;
}

/**
 * Oldest-first full transactions on the bonding curve or pool.
 * Cheaper than walking getSignaturesForAddress to the start and then
 * calling getTransaction once per signature.
 */
export function earlyBuyerHistoryParams(
  account: string,
  paginationToken: string | null,
): unknown[] {
  const config: Record<string, unknown> = {
    transactionDetails: "full",
    sortOrder: "asc",
    limit: EARLY_BUYER_PAGE_LIMIT,
    commitment: "confirmed",
    encoding: "json",
    maxSupportedTransactionVersion: 1,
    filters: { status: "succeeded" },
  };
  if (paginationToken) config["paginationToken"] = paginationToken;
  return [account, config];
}

export function earlyBuyersFromHistory(
  entry: unknown,
  target: { mint: string; venue: string; creator: string | null },
): EarlyBuyerRow[] {
  const record = asRecord(entry);
  if (record === null) return [];
  const transaction = asRecord(record["transaction"]);
  const signatures = transaction?.["signatures"];
  const signature =
    (Array.isArray(signatures) && typeof signatures[0] === "string" ? signatures[0] : null) ??
    (typeof record["signature"] === "string" ? record["signature"] : null);
  const slot = typeof record["slot"] === "number" ? record["slot"] : 0;
  if (signature === null) return [];
  const version = transactionVersion(record["version"] ?? transaction?.["version"]);
  if (version === "unsupported") return [];
  const decoded = decodeRpcTransaction(record, signature);
  const rows: EarlyBuyerRow[] = [];
  for (const observation of decoded.observations) {
    if (observation.mint !== target.mint || observation.creatorWallet === null) continue;
    const side = tradeSide(observation.kind);
    if (side === null) continue;
    pushBuyer(rows, {
      signature,
      eventIndex: rows.length,
      slot: observation.slot || slot,
      mint: target.mint,
      wallet: observation.creatorWallet,
      side,
      venue: target.venue,
      isCreator: observation.creatorWallet === target.creator,
    });
  }
  const message = asRecord(transaction?.["message"]);
  const meta = asRecord(record["meta"]);
  const keys = accountKeys(message, meta, version);
  for (const instruction of instructionsOf(message, meta, keys)) {
    const found = venueBuyer(instruction, target, meta, keys);
    if (found === null) continue;
    pushBuyer(rows, {
      signature,
      eventIndex: rows.length,
      slot,
      mint: target.mint,
      wallet: found.wallet,
      side: found.side,
      venue: target.venue,
      isCreator: found.wallet === target.creator,
    });
  }
  return rows.filter((row) => !row.isCreator);
}

function tradeSide(kind: string): "buy" | "sell" | null {
  if (kind === "pump_buy" || kind === "pumpswap_buy") return "buy";
  if (kind === "pump_sell" || kind === "pumpswap_sell") return "sell";
  return null;
}

function pushBuyer(rows: EarlyBuyerRow[], row: EarlyBuyerRow): void {
  if (rows.some((existing) => existing.wallet === row.wallet && existing.side === row.side)) return;
  rows.push(row);
}

function venueBuyer(
  instruction: { programId: string; data: Uint8Array; accounts: string[] },
  target: { mint: string; creator: string | null },
  meta: Record<string, unknown> | null,
  keys: readonly string[],
): { wallet: string; side: "buy" | "sell" } | null {
  if (instruction.programId === LAUNCHLAB_PROGRAM_ID) {
    const side = launchlabSide(instruction.data);
    const wallet = instruction.accounts[LAUNCHLAB_TRADE_ACCOUNTS.indexOf("payer")];
    const mint = instruction.accounts[LAUNCHLAB_TRADE_ACCOUNTS.indexOf("base_token_mint")];
    if (side === null || wallet === undefined || mint !== target.mint) return null;
    return { wallet, side };
  }
  if (instruction.programId === DBC_PROGRAM_ID && isDbcSwap(instruction.data)) {
    const wallet = instruction.accounts[DBC_SWAP_ACCOUNTS.indexOf("payer")];
    const mint = instruction.accounts[DBC_SWAP_ACCOUNTS.indexOf("base_mint")];
    if (wallet === undefined || mint !== target.mint) return null;
    const delta = tokenDelta(meta, wallet, mint);
    if (delta !== null && delta !== 0n) return { wallet, side: delta > 0n ? "buy" : "sell" };
    const inputMint = tokenMintAt(
      meta,
      keys.indexOf(instruction.accounts[DBC_SWAP_ACCOUNTS.indexOf("input_token_account")] ?? ""),
    );
    if (inputMint === null) return null;
    return { wallet, side: inputMint === mint ? "sell" : "buy" };
  }
  if (instruction.programId === PUMP_PROGRAM_ID || instruction.programId === PUMP_AMM_PROGRAM_ID) {
    return null;
  }
  return null;
}

function launchlabSide(data: Uint8Array): "buy" | "sell" | null {
  if (sameDisc(data, DISC.ixLaunchlabBuyExactIn) || sameDisc(data, DISC.ixLaunchlabBuyExactOut)) {
    return "buy";
  }
  if (sameDisc(data, DISC.ixLaunchlabSellExactIn) || sameDisc(data, DISC.ixLaunchlabSellExactOut)) {
    return "sell";
  }
  return null;
}

function isDbcSwap(data: Uint8Array): boolean {
  return (
    sameDisc(data, DISC.ixDbcSwap) ||
    sameDisc(data, DISC.ixDbcSwap2) ||
    sameDisc(data, DISC.ixDbcSwap2Hook)
  );
}

function tokenDelta(
  meta: Record<string, unknown> | null,
  owner: string,
  mint: string,
): bigint | null {
  const pre = tokenAmount(meta?.["preTokenBalances"], owner, mint);
  const post = tokenAmount(meta?.["postTokenBalances"], owner, mint);
  if (pre === null && post === null) return null;
  return (post ?? 0n) - (pre ?? 0n);
}

function tokenAmount(value: unknown, owner: string, mint: string): bigint | null {
  if (!Array.isArray(value)) return null;
  let total: bigint | null = null;
  for (const entry of value) {
    const record = asRecord(entry);
    if (record?.["owner"] !== owner || record["mint"] !== mint) continue;
    const ui = asRecord(record["uiTokenAmount"]);
    const raw = ui?.["amount"] ?? ui?.["uiAmountString"];
    const amount =
      typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw).toString() : raw;
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) continue;
    total = (total ?? 0n) + BigInt(amount);
  }
  return total;
}

function instructionsOf(
  message: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
  keys: readonly string[],
): Array<{ programId: string; data: Uint8Array; accounts: string[] }> {
  const out: Array<{ programId: string; data: Uint8Array; accounts: string[] }> = [];
  const push = (value: unknown): void => {
    const row = asRecord(value);
    if (row === null) return;
    const programId =
      typeof row["programId"] === "string"
        ? row["programId"]
        : typeof row["programIdIndex"] === "number"
          ? (keys[row["programIdIndex"]] ?? "")
          : "";
    if (!programId) return;
    const data = instructionData(row["data"]);
    const accounts = (Array.isArray(row["accounts"]) ? row["accounts"] : [])
      .map((account) =>
        typeof account === "string"
          ? account
          : typeof account === "number"
            ? keys[account]
            : undefined,
      )
      .filter((account): account is string => typeof account === "string" && account.length > 0);
    out.push({ programId, data, accounts });
  };
  const top = message?.["instructions"];
  if (Array.isArray(top)) for (const instruction of top) push(instruction);
  const inner = meta?.["innerInstructions"];
  if (Array.isArray(inner)) {
    for (const group of inner) {
      const instructions = asRecord(group)?.["instructions"];
      if (Array.isArray(instructions)) for (const instruction of instructions) push(instruction);
    }
  }
  return out;
}

function instructionData(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length === 0) return new Uint8Array();
  try {
    return decodeBase58(value);
  } catch {
    try {
      return Uint8Array.from(Buffer.from(value, "base64"));
    } catch {
      return new Uint8Array();
    }
  }
}

/** Legacy, v0, and v1. Anything else is left for a later decoder. */
function transactionVersion(value: unknown): "legacy" | 0 | 1 | "unsupported" {
  if (value === undefined || value === null || value === "legacy") return "legacy";
  if (value === 0 || value === 1) return value;
  return "unsupported";
}

function accountKeys(
  message: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
  version: "legacy" | 0 | 1,
): string[] {
  const raw = message?.["accountKeys"];
  const staticKeys = Array.isArray(raw)
    ? raw
        .map((key) => {
          if (typeof key === "string") return key;
          const record = asRecord(key);
          return typeof record?.["pubkey"] === "string" ? record["pubkey"] : null;
        })
        .filter((key): key is string => key !== null)
    : [];
  if (version === "legacy") return staticKeys;
  const loaded = asRecord(meta?.["loadedAddresses"]);
  const writable = stringList(loaded?.["writable"]);
  const readonly = stringList(loaded?.["readonly"]);
  return [...staticKeys, ...writable, ...readonly];
}

function tokenMintAt(meta: Record<string, unknown> | null, accountIndex: number): string | null {
  if (accountIndex < 0) return null;
  for (const field of ["postTokenBalances", "preTokenBalances"]) {
    const list = meta?.[field];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const record = asRecord(entry);
      if (record?.["accountIndex"] === accountIndex && typeof record["mint"] === "string") {
        return record["mint"];
      }
    }
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sameDisc(data: Uint8Array, disc: Uint8Array): boolean {
  if (data.length < disc.length) return false;
  for (let index = 0; index < disc.length; index += 1) {
    if (data[index] !== disc[index]) return false;
  }
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function collectEarlyBuyers(input: {
  mints: readonly BackfillTarget[];
  buysPerMint: number;
  runCreditsLeft: number;
  fetchPage: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  save: (rows: readonly EarlyBuyerRow[]) => Promise<void>;
  checkpoint: (row: BackfillCheckpoint) => Promise<void>;
}): Promise<{
  credits: number;
  buyers: number;
  mintsDone: number;
  stopped: boolean;
  errored: boolean;
}> {
  let credits = 0;
  let buyers = 0;
  let mintsDone = 0;
  const buysPerMint = Math.max(1, Math.floor(input.buysPerMint));
  for (const mint of input.mints) {
    if (credits + historyPageCredits(1) > input.runCreditsLeft) {
      return { credits, buyers, mintsDone, stopped: true, errored: false };
    }
    let pages = mint.pages;
    let buysKept = mint.buysKept;
    let token = mint.paginationToken;
    if (buysKept >= buysPerMint || pages >= EARLY_BUYER_MAX_PAGES) {
      await input.checkpoint({
        mint: mint.mint,
        venue: mint.venue,
        account: mint.account,
        status: "done",
        paginationToken: null,
        buysKept,
        pages,
        creditDelta: 0,
      });
      mintsDone += 1;
      continue;
    }
    let finished = false;
    while (pages < EARLY_BUYER_MAX_PAGES && buysKept < buysPerMint) {
      if (credits + historyPageCredits(1) > input.runCreditsLeft) {
        return { credits, buyers, mintsDone, stopped: true, errored: false };
      }
      const page = await input.fetchPage(mint.account, token);
      if (page === null) return { credits, buyers, mintsDone, stopped: true, errored: true };
      const cost = historyPageCredits(page.transactions.length);
      credits += cost;
      const stored: EarlyBuyerRow[] = [];
      for (const entry of page.transactions) {
        for (const row of earlyBuyersFromHistory(entry, mint)) {
          if (row.side === "buy" && buysKept >= buysPerMint) continue;
          if (row.side === "buy") buysKept += 1;
          stored.push(row);
        }
      }
      if (stored.length > 0) await input.save(stored);
      buyers += stored.length;
      pages += 1;
      finished =
        buysKept >= buysPerMint || page.paginationToken === null || pages >= EARLY_BUYER_MAX_PAGES;
      token = finished ? null : page.paginationToken;
      await input.checkpoint({
        mint: mint.mint,
        venue: mint.venue,
        account: mint.account,
        status: finished ? "done" : "open",
        paginationToken: token,
        buysKept,
        pages,
        creditDelta: cost,
      });
      if (finished) break;
    }
    if (finished) mintsDone += 1;
  }
  return { credits, buyers, mintsDone, stopped: false, errored: false };
}

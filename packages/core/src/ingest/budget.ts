/** 2 credits per 0.1 MB = 20 credits per 1_000_000 bytes = 1 credit per 50_000 bytes. */
export const BYTES_PER_CREDIT = 50_000n;
export const MICROS_PER_CREDIT = 1_000_000n;

export const PLAN_CREDITS = {
  free: 1_000_000n,
  developer: 10_000_000n,
} as const;

export type HeliusPlan = keyof typeof PLAN_CREDITS;
export type WsMode = "auto" | "standard" | "enhanced";
/** parsed = instruction-filtered parsedTransactionSubscribe. enhanced is the full-program firehose. */
export type ResolvedWsMethod = "parsed" | "enhanced";

export function selectWsMethod(plan: HeliusPlan, mode: WsMode): ResolvedWsMethod {
  if (mode === "enhanced" && plan === "developer") return "enhanced";
  return "parsed";
}

export function allowanceCredits(plan: HeliusPlan, override: number | undefined): bigint {
  if (override !== undefined) return BigInt(override);
  return PLAN_CREDITS[plan];
}

/**
 * Documented Helius costs (https://www.helius.dev/docs/billing/credits):
 * standard RPC, including getSlot, getTransaction, and getSignaturesForAddress, is 1 credit.
 * Methods listed separately on that page (getProgramAccounts, DAS, and so on) are not called here.
 * The credits page does not bill a socket-open fee. LaserStream data is 2 credits per 0.1 MB,
 * which is BYTES_PER_CREDIT. Parsed streams are 1 credit per delivered event, not per byte.
 */
export const RPC_CREDITS: Readonly<Record<string, number>> = {
  getSlot: 1,
  getTransaction: 1,
  getSignaturesForAddress: 1,
  getBlock: 1,
  getBlockTime: 1,
  getSignatureStatuses: 1,
};

export function rpcCredits(method: string): number {
  return RPC_CREDITS[method] ?? 1;
}

export function rpcCreditMicros(method: string, calls = 1): bigint {
  return BigInt(rpcCredits(method) * calls) * MICROS_PER_CREDIT;
}

export function parsedEventMicros(events: number): bigint {
  return BigInt(events) * MICROS_PER_CREDIT;
}

/**
 * Parsed Events scan is 10 credits per request plus 1 per history page of up to 1,000
 * transactions. https://www.helius.dev/docs/api-reference/parsed-events/scan
 * One scanned transaction is one page (11). Two thousand scanned transactions are two pages (12).
 */
export function parsedScanCredits(transactionsScanned: number): number {
  const safe = Number.isFinite(transactionsScanned)
    ? Math.max(0, Math.floor(transactionsScanned))
    : 0;
  const pages = Math.ceil(safe / 1000);
  return 10 + pages;
}

/** Scan cost for each program window, plus one getTransaction credit per matched signature. */
export function startupScanCredits(input: {
  transactionsInWindow: readonly number[];
  matches: number;
}): number {
  const scans = input.transactionsInWindow.reduce(
    (sum, count) => sum + parsedScanCredits(count),
    0,
  );
  return scans + Math.max(0, Math.floor(input.matches));
}

export function usageMicros(input: {
  streamedBytes: bigint;
  rpcCalls: number;
  /** Accepted for older call sites. The credits page does not bill opening a socket. */
  socketOpens?: number;
  rpcMethod?: string;
}): bigint {
  void input.socketOpens;
  const perCall = rpcCredits(input.rpcMethod ?? "getTransaction");
  return (
    input.streamedBytes * (MICROS_PER_CREDIT / BYTES_PER_CREDIT) +
    BigInt(input.rpcCalls * perCall) * MICROS_PER_CREDIT
  );
}

export type BudgetLevel = "ok" | "warn60" | "warn80" | "pause";

export function budgetLevel(usedMicros: bigint, allowanceCreditsValue: bigint): BudgetLevel {
  if (allowanceCreditsValue <= 0n) return "ok";
  const allowanceMicros = allowanceCreditsValue * MICROS_PER_CREDIT;
  const pct = (usedMicros * 100n) / allowanceMicros;
  if (pct >= 90n) return "pause";
  if (pct >= 80n) return "warn80";
  if (pct >= 60n) return "warn60";
  return "ok";
}

/** Project 30 days from credits observed since soak start, not since UTC midnight. */
export function projectMonthlyCredits(input: {
  creditsTodayMicros: bigint;
  elapsedMs: number;
}): string {
  if (input.elapsedMs < 60_000) return "warming up";
  const dayFraction = input.elapsedMs / 86_400_000;
  if (dayFraction <= 0) return "warming up";
  const projected = (Number(input.creditsTodayMicros) / 1_000_000 / dayFraction) * 30;
  if (!Number.isFinite(projected)) return "unavailable";
  return projected.toFixed(1);
}

export function formatCredits(micros: bigint): string {
  const whole = micros / MICROS_PER_CREDIT;
  const frac = micros % MICROS_PER_CREDIT;
  const hundredths = (frac * 100n) / MICROS_PER_CREDIT;
  return `${whole.toString()}.${hundredths.toString().padStart(2, "0")}`;
}

export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

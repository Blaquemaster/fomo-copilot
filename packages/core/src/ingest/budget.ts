/** 2 credits per 0.1 MB = 20 credits per 1_000_000 bytes = 1 credit per 50_000 bytes. */
export const BYTES_PER_CREDIT = 50_000n;
export const MICROS_PER_CREDIT = 1_000_000n;

export const PLAN_CREDITS = {
  free: 1_000_000n,
  developer: 10_000_000n,
} as const;

export type HeliusPlan = keyof typeof PLAN_CREDITS;
export type WsMode = "auto" | "standard" | "enhanced";
export type ResolvedWsMethod = "standard" | "enhanced";

export function selectWsMethod(plan: HeliusPlan, mode: WsMode): ResolvedWsMethod {
  if (mode === "standard") return "standard";
  if (mode === "enhanced") return plan === "developer" ? "enhanced" : "standard";
  return plan === "developer" ? "enhanced" : "standard";
}

export function allowanceCredits(plan: HeliusPlan, override: number | undefined): bigint {
  if (override !== undefined) return BigInt(override);
  return PLAN_CREDITS[plan];
}

export function usageMicros(input: {
  streamedBytes: bigint;
  rpcCalls: number;
  socketOpens: number;
}): bigint {
  return (
    input.streamedBytes * (MICROS_PER_CREDIT / BYTES_PER_CREDIT) +
    BigInt(input.rpcCalls + input.socketOpens) * MICROS_PER_CREDIT
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

export function projectMonthlyCredits(input: {
  creditsTodayMicros: bigint;
  elapsedMs: number;
  now?: Date;
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

export function planExit(input: {
  openedAt: Date;
  now: Date;
  entryQuote: number;
  latestQuote: number | null;
  stopPct: number;
  horizonMs: number;
  screenFailed: boolean;
}): { exit: false } | { exit: true; reason: "invalidation" | "stop" | "horizon" } {
  if (input.screenFailed) return { exit: true, reason: "invalidation" };
  if (
    input.latestQuote !== null &&
    input.entryQuote > 0 &&
    input.latestQuote <= input.entryQuote * (1 - input.stopPct / 100)
  ) {
    return { exit: true, reason: "stop" };
  }
  if (
    input.now.getTime() >= input.openedAt.getTime() + input.horizonMs &&
    input.latestQuote !== null
  ) {
    return { exit: true, reason: "horizon" };
  }
  return { exit: false };
}

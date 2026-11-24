import type { SizeBid } from "./quote.js";

/**
 * A missing quote is not a loss. A confirmed empty recovery is.
 * Provider and routing failures stay unresolved for the primary mean.
 */
export type ExitState =
  | "priced"
  | "provider_failure"
  | "routing_failure"
  | "transfer_restriction"
  | "near_zero_recovery"
  | "unresolved";

export function exitStateFor(input: {
  bid: SizeBid | undefined;
  horizonReached: boolean;
  onChainUntradable: boolean;
  transferRestricted: boolean;
  netIfPriced: number | null;
}): { state: ExitState; net: number | null } {
  if (input.transferRestricted) return { state: "transfer_restriction", net: -1 };
  if (input.bid?.ok) {
    const net = input.netIfPriced;
    if (net !== null && net <= -0.99) return { state: "near_zero_recovery", net };
    return { state: "priced", net };
  }
  const reason = input.bid && !input.bid.ok ? input.bid.reason : "no_quote";
  if (
    reason === "http_400" ||
    reason === "http_404" ||
    reason === "api_error" ||
    reason === "rate_limited" ||
    reason === "transient"
  ) {
    return { state: "provider_failure", net: null };
  }
  if ((reason === "no_route" || reason === "no_liquidity") && input.onChainUntradable) {
    return { state: "near_zero_recovery", net: -1 };
  }
  if (reason === "no_route" || reason === "no_liquidity") {
    return input.horizonReached
      ? { state: "routing_failure", net: null }
      : { state: "unresolved", net: null };
  }
  return { state: "unresolved", net: null };
}

export interface ArmRow {
  arm: string;
  state: ExitState;
  net: number | null;
}

/** Primary mean uses priced, near-zero, and transfer-restriction rows. Unresolved stays in the count. */
export function missingnessReport(rows: readonly ArmRow[]): {
  byArm: Array<{ arm: string; trials: number; missing: number; primaryMean: number | null }>;
  primaryGap: number | null;
  conservativeGap: number | null;
  decisionFlips: boolean;
} {
  const arms = [...new Set(rows.map((row) => row.arm))];
  const byArm = arms.map((arm) => {
    const mine = rows.filter((row) => row.arm === arm);
    const priced = mine.filter((row) => row.net !== null && economic(row.state));
    const missing = mine.filter((row) => !economic(row.state)).length;
    const primaryMean =
      priced.length === 0
        ? null
        : priced.reduce((sum, row) => sum + (row.net ?? 0), 0) / priced.length;
    return { arm, trials: mine.length, missing, primaryMean };
  });
  const gap = (useConservative: boolean) => {
    const mean = (arm: string) => {
      const mine = rows.filter((row) => row.arm === arm);
      const values = mine.map((row) =>
        economic(row.state) ? (row.net ?? 0) : useConservative ? -1 : null,
      );
      const kept = values.filter((value): value is number => value !== null);
      if (kept.length === 0) return null;
      return kept.reduce((sum, value) => sum + value, 0) / kept.length;
    };
    const wallet = mean("wallet");
    const control = mean("control");
    if (wallet === null || control === null) return null;
    return wallet - control;
  };
  const primaryGap = gap(false);
  const conservativeGap = gap(true);
  const decisionFlips =
    primaryGap !== null &&
    conservativeGap !== null &&
    Math.sign(primaryGap) !== Math.sign(conservativeGap) &&
    primaryGap !== 0 &&
    conservativeGap !== 0;
  return { byArm, primaryGap, conservativeGap, decisionFlips };
}

function economic(state: ExitState): boolean {
  return state === "priced" || state === "near_zero_recovery" || state === "transfer_restriction";
}

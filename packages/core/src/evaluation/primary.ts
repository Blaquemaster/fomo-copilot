export const PRIMARY_COMPARISON = {
  population: "freshly graduated pools",
  venuePaths: 1,
  cohort: "frozen wallet list",
  control: "contemporaneous screened no-wallet",
  cashUsd: 20,
  entryDelaySec: 180,
  exit: "fixed 60 minutes",
  scaleOut: false,
  stop: false,
  takeProfit: false,
  social: false,
  worthwhileAdvantage: 0.05,
  endpointDays: 60,
  inferentialGoEnabled: false,
} as const;

export interface PrimaryRow {
  enrolled: boolean;
  filled: boolean;
  outcome: number | null;
}

export const EXECUTION_ASSUMPTIONS = {
  version: "2026-11-28.3",
  costBasis: "jupiter",
  latency: "measured_automated",
  sensitivities: ["fomo_fees", "entry_delay_180s"],
} as const;

export interface StageCoverage {
  stage: "trench" | "near_graduation" | "post_graduation" | "second_wave";
  buy: "available" | "unavailable" | "unknown";
  sell: "available" | "unavailable" | "unknown";
}

export function evaluationRunner(input: {
  assumptionsVersion: string;
  rows: readonly PrimaryRow[];
  coverage: readonly StageCoverage[];
}):
  | { scored: false; reason: "assumptions_version_mismatch" }
  | {
      scored: true;
      report: ReturnType<typeof primaryReport>;
      assumptions: typeof EXECUTION_ASSUMPTIONS;
      buyAndSellRecorded: boolean;
    } {
  if (input.assumptionsVersion !== EXECUTION_ASSUMPTIONS.version) {
    return { scored: false, reason: "assumptions_version_mismatch" };
  }
  return {
    scored: true,
    report: primaryReport(input.rows),
    assumptions: EXECUTION_ASSUMPTIONS,
    buyAndSellRecorded: input.coverage.every(
      (row) => row.buy !== "unknown" && row.sell !== "unknown",
    ),
  };
}

export function primaryReport(rows: readonly PrimaryRow[]): {
  comparison: typeof PRIMARY_COMPARISON;
  enrolled: number;
  missing: number;
  mean: number | null;
} {
  const enrolled = rows.filter((row) => row.enrolled);
  const missing = enrolled.filter((row) => row.outcome === null).length;
  if (missing > 0) {
    return { comparison: PRIMARY_COMPARISON, enrolled: enrolled.length, missing, mean: null };
  }
  const filled = enrolled.filter((row) => row.filled && row.outcome !== null);
  const mean =
    filled.length === 0
      ? null
      : filled.reduce((sum, row) => sum + (row.outcome ?? 0), 0) / filled.length;
  return { comparison: PRIMARY_COMPARISON, enrolled: enrolled.length, missing, mean };
}

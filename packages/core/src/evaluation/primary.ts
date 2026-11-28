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

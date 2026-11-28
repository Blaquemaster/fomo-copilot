import { describe, expect, it } from "vitest";

import {
  EXECUTION_ASSUMPTIONS,
  PRIMARY_COMPARISON,
  evaluationRunner,
  primaryReport,
} from "./primary.js";

describe("primary comparison", () => {
  it("stays frozen and treats a missing outcome as unknown", () => {
    expect(PRIMARY_COMPARISON.inferentialGoEnabled).toBe(false);
    expect(PRIMARY_COMPARISON.social).toBe(false);
    expect(PRIMARY_COMPARISON.cashUsd).toBe(20);
    const report = primaryReport([
      { enrolled: true, filled: true, outcome: 0.1 },
      { enrolled: true, filled: false, outcome: null },
    ]);
    expect(report.mean).toBeNull();
    expect(report.missing).toBe(1);
  });

  it("refuses a score until the execution assumptions version matches", () => {
    const rows = [{ enrolled: true, filled: true, outcome: 0.1 }];
    const coverage = [
      {
        stage: "post_graduation" as const,
        buy: "available" as const,
        sell: "unavailable" as const,
      },
    ];
    expect(evaluationRunner({ assumptionsVersion: "old", rows, coverage }).scored).toBe(false);
    const scored = evaluationRunner({
      assumptionsVersion: EXECUTION_ASSUMPTIONS.version,
      rows,
      coverage,
    });
    expect(scored.scored).toBe(true);
    if (scored.scored) {
      expect(scored.assumptions.sensitivities).toEqual(["fomo_fees", "entry_delay_180s"]);
      expect(scored.assumptions.costBasis).toBe("jupiter");
      expect(scored.buyAndSellRecorded).toBe(true);
    }
  });
});

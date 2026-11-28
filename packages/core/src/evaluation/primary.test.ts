import { describe, expect, it } from "vitest";

import { PRIMARY_COMPARISON, primaryReport } from "./primary.js";

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
});

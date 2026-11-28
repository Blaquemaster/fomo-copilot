import { describe, expect, it } from "vitest";

import { executionEconomics } from "./economics.js";

describe("execution economics", () => {
  it("does not add a quote, a held simulation, and a missing fill", () => {
    const report = executionEconomics({ estimatedFee: null });
    expect(report.fill).toBeNull();
    expect(report.simulation.state).toBe("held");
    expect(report.combined).toBeNull();
  });
});

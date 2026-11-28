import { describe, expect, it } from "vitest";

import { catalogClaimsNoEdge, runEvaluationCatalog } from "./catalog.js";

describe("evaluation catalog", () => {
  it("writes a fixture report and does not claim an edge", () => {
    const report = runEvaluationCatalog();
    expect(report.scenarios.every((row) => row.passed)).toBe(true);
    expect(report.inferentialGoEnabled).toBe(false);
    expect(catalogClaimsNoEdge()).toBe(true);
  });
});

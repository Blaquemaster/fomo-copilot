import { describe, expect, it } from "vitest";

import { collectAdmittedMints, collectSocial } from "./socialCollect.js";

describe("social collector", () => {
  it("does not call a live provider when the cap is zero", () => {
    const result = collectSocial({
      mint: "mint-a",
      budget: { liveCap: 0, liveUsed: 0 },
      liveMentions: 4,
      now: new Date("2026-11-28T00:00:00Z"),
      staleAfterMs: 60_000,
    });
    expect(result.observation).toEqual({
      mint: "mint-a",
      status: "unknown",
      mentions: null,
      source: "none",
    });
    expect(result.budget.liveUsed).toBe(0);
  });

  it("treats a stale fixture as unknown", () => {
    const result = collectSocial({
      mint: "mint-a",
      budget: { liveCap: 0, liveUsed: 0 },
      fixtureMentions: 2,
      fetchedAt: new Date("2026-11-28T00:00:00Z"),
      now: new Date("2026-11-28T00:05:00Z"),
      staleAfterMs: 60_000,
    });
    expect(result.observation.status).toBe("unknown");
    expect(result.observation.mentions).toBeNull();
  });

  it("collects admitted mints without calling a provider", () => {
    const rows = collectAdmittedMints(["mint-a", "mint-b"], new Date("2026-11-28T00:00:00Z"));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.observation.source === "none")).toBe(true);
    expect(rows.every((row) => row.readiness.state === "unavailable")).toBe(true);
    expect(rows.every((row) => row.budget.liveUsed === 0)).toBe(true);
  });
});

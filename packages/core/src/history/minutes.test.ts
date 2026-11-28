import { describe, expect, it } from "vitest";

import { minuteAggregates } from "./minutes.js";

describe("minute aggregates", () => {
  it("keeps a missing minute as a gap", () => {
    const bars = minuteAggregates({
      mint: "mint-a",
      from: new Date("2026-11-28T00:00:00Z"),
      to: new Date("2026-11-28T00:02:00Z"),
      trades: [{ at: new Date("2026-11-28T00:00:10Z"), volume: 2 }],
    });
    expect(bars.map((bar) => bar.gap)).toEqual([false, true, true]);
    expect(bars[0]?.volume).toBe(2);
    expect(bars[1]?.volume).toBeNull();
  });
});

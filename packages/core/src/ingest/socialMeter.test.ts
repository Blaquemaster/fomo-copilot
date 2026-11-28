import { describe, expect, it } from "vitest";

import { PLANNED_MONTHLY_READS, SocialMeter, pricedWorkload } from "./socialMeter.js";

describe("social meter", () => {
  it("prices the planned month and charges only new bounded reads", () => {
    expect(pricedWorkload()).toBe(1_920);
    expect(PLANNED_MONTHLY_READS).toBe(384_000);
    const meter = new SocialMeter(2);
    const first = meter.read({
      endpoint: "search",
      mint: "mint-a",
      posts: ["p1", "p2", "p3"],
      now: 0,
      cacheMs: 1_000,
    });
    expect(first.posts).toEqual(["p1", "p2"]);
    expect(first.chargedReads).toBe(2);
    expect(first.usd).toBe(0.01);
    const cached = meter.read({
      endpoint: "search",
      mint: "mint-a",
      posts: ["p1", "p2"],
      now: 500,
      cacheMs: 1_000,
    });
    expect(cached.cached).toBe(true);
    expect(cached.chargedReads).toBe(0);
    const incremental = meter.read({
      endpoint: "search",
      mint: "mint-b",
      posts: ["p2", "p4"],
      now: 2_000,
      cacheMs: 1_000,
    });
    expect(incremental.chargedReads).toBe(1);
    expect(meter.readsByEndpoint.search).toBe(3);
  });
});

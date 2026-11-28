import { describe, expect, it } from "vitest";

import { dashboardView } from "./view.js";

const base = {
  token: "owner-token",
  authorization: "Bearer owner-token",
  now: new Date("2026-11-28T00:10:00Z"),
  observedAt: new Date("2026-11-28T00:00:00Z"),
  staleAfterMs: 60_000,
  services: [],
  feeds: [],
  decisions: [],
  positions: [],
  spend: null,
};

describe("dashboard view", () => {
  it("rejects a missing token and shows empty, stale, and unavailable", () => {
    expect(dashboardView({ ...base, authorization: undefined }).status).toBe(401);
    const view = dashboardView(base);
    expect(view.body.services).toBe("empty");
    expect(view.body.spend).toBe("unavailable");
    expect(view.body.freshness).toBe("stale");
    expect(view.body.alerts).toBe("held");
    expect(JSON.stringify(view.body)).not.toContain("owner-token");
  });
});

import { describe, expect, it } from "vitest";

import { sizedFromRoute } from "./readiness.js";

describe("data readiness", () => {
  it("does not size a stage whose route is unavailable", () => {
    expect(sizedFromRoute({ route: "unavailable", amount: 5 })).toEqual({
      state: "unavailable",
      value: null,
    });
    expect(sizedFromRoute({ route: "available", amount: 5 })).toEqual({ state: "ready", value: 5 });
  });
});

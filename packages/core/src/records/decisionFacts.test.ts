import { describe, expect, it } from "vitest";

import {
  FROZEN_LIST_VERSION,
  PARSER_VERSION,
  decisionTimes,
  eventVisibleToDecision,
  listUsable,
  stageAdmission,
} from "./decisionFacts.js";

describe("decision facts", () => {
  it("keeps chain, observation, and decision time separate and hides a late backfill", () => {
    const decisionAt = new Date("2026-11-28T00:00:00Z");
    const times = decisionTimes({
      chainAt: new Date("2026-11-27T23:59:00Z"),
      observedAt: decisionAt,
      decisionAt,
    });
    expect(times.parserVersion).toBe(PARSER_VERSION);
    expect(times.chainAt).not.toBe(times.decisionAt);
    expect(eventVisibleToDecision(new Date("2026-11-28T00:01:00Z"), decisionAt)).toBe(false);
    expect(eventVisibleToDecision(decisionAt, decisionAt)).toBe(true);
  });

  it("names the earlier list and refuses a later one", () => {
    expect(listUsable(FROZEN_LIST_VERSION, FROZEN_LIST_VERSION)).toBe(true);
    expect(listUsable(FROZEN_LIST_VERSION, "v4")).toBe(false);
  });

  it("does not open an unknown stage or an unready included stage", () => {
    expect(stageAdmission("excluded", true)).toEqual({ open: false, readiness: "unavailable" });
    expect(stageAdmission("post_graduation", false)).toEqual({
      open: false,
      readiness: "unavailable",
    });
    expect(stageAdmission("post_graduation", true).open).toBe(true);
  });
});

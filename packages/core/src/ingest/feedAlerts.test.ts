import { describe, expect, it } from "vitest";

import { blockLagAlert, inUnrecoveredGap, venueStaleAlert } from "./feedAlerts.js";

describe("feed telemetry", () => {
  it("alerts when a venue is stale and when block-to-record lag is high", () => {
    const now = new Date("2026-11-24T06:00:00.000Z");
    expect(
      venueStaleAlert({
        venue: "pump",
        lastEventAt: new Date("2026-11-24T05:40:00.000Z"),
        now,
      }),
    ).toContain("pump feed stale");
    expect(
      venueStaleAlert({
        venue: "pump",
        lastEventAt: new Date("2026-11-24T05:55:00.000Z"),
        now,
      }),
    ).toBeNull();
    expect(
      blockLagAlert({
        venue: "pump",
        blockTimeMs: now.getTime() - 120_000,
        recordedAt: now,
      }),
    ).toContain("block-to-record lag");
  });

  it("flags an entry that falls inside an unrecovered gap", () => {
    const gap = {
      start: new Date("2026-11-23T12:56:58.000Z"),
      end: new Date("2026-11-23T13:15:33.000Z"),
    };
    expect(inUnrecoveredGap(new Date("2026-11-23T13:00:00.000Z"), [gap])).toBe(true);
    expect(inUnrecoveredGap(new Date("2026-11-23T14:00:00.000Z"), [gap])).toBe(false);
  });
});

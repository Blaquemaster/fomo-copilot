import { describe, expect, it } from "vitest";

import {
  OverflowLog,
  UsageLedger,
  admitTxBytes,
  diffSignatures,
  isAlertableSource,
  oldPolicyWouldDrop,
  planAuditWindow,
  recallLoss,
  recallShouldAlert,
  FrameStats,
  TX_QUEUE_BYTE_CAP,
} from "./frameStats.js";

describe("transaction queue", () => {
  it("keeps frames until the byte cap and shadows the old two-frame drop", () => {
    expect(admitTxBytes(0, 100)).toBe("keep");
    expect(admitTxBytes(TX_QUEUE_BYTE_CAP - 10, 100)).toBe("overflow");
    expect(oldPolicyWouldDrop(1)).toBe(false);
    expect(oldPolicyWouldDrop(2)).toBe(true);
    const stats = new FrameStats();
    const now = new Date("2026-11-16T03:00:00.000Z");
    stats.noteReceived("tx", 100, now);
    stats.noteShadow(2, now);
    stats.noteHandleMs(40, now);
    stats.noteSlot(10, now);
    stats.noteSlot(12, now);
    for (let slot = 13; slot <= 28; slot += 1) stats.noteSlot(slot, now);
    const rows = stats.drain(now);
    expect(rows.find((row) => row.kind === "tx")?.received).toBe(1);
    expect(rows.find((row) => row.kind === "meta")).toEqual(
      expect.objectContaining({ shadowDropped: 1, slotGaps: 1, slotsSeen: 18, p99HandleMs: 40 }),
    );
    expect(stats.drain(now)).toEqual([]);
  });

  it("bounds overflow slots and can flush them later", () => {
    const log = new OverflowLog();
    expect(log.empty).toBe(true);
    log.note("program", 10);
    log.note("program", 12);
    const spans = log.drain();
    expect(log.empty).toBe(true);
    expect(spans).toEqual([
      { programId: "program", fromSlot: 10, toSlot: 12, frames: 2, collapsed: false },
    ]);
  });
});

describe("usage ledger", () => {
  it("returns the counters and then zeroes them", () => {
    const ledger = new UsageLedger();
    ledger.add({ messages: 2, streamedBytes: 10n, storedEvents: 1, creditMicros: 5n });
    expect(ledger.drain()).toEqual({
      messages: 2,
      streamedBytes: 10n,
      storedEvents: 1,
      creditMicros: 5n,
      venueCredits: {},
      venueStored: {},
    });
    expect(ledger.drain().messages).toBe(0);
  });
});

describe("recall audit", () => {
  it("picks a stable 15-minute window and alerts on the loss rules", () => {
    const nowMs = Date.parse("2026-11-16T12:00:00.000Z");
    const first = planAuditWindow({ nowMs, tipSlot: 470_000_000, programId: "dbc" });
    const second = planAuditWindow({ nowMs, tipSlot: 470_000_000, programId: "dbc" });
    expect(second).toEqual(first);
    expect(first.toSlot - first.fromSlot).toBeGreaterThan(4_000);
    expect(first.toSlot).toBeLessThan(470_000_000 - 7_000);
    expect(diffSignatures(["a", "b", "a"], new Set(["b"]))).toEqual({
      matched: ["b"],
      missed: ["a"],
    });
    expect(recallLoss(2, 200)).toBe(0.01);
    expect(
      recallShouldAlert({ windowMissed: 3, sevenDayMissed: 1, sevenDayExpected: 1000 }).window,
    ).toBe(true);
    expect(
      recallShouldAlert({ windowMissed: 1, sevenDayMissed: 11, sevenDayExpected: 1000 }).week,
    ).toBe(true);
    expect(isAlertableSource("stream")).toBe(true);
    expect(isAlertableSource("audit")).toBe(false);
  });
});

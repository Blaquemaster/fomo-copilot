import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  BoundedSet,
  DisposableBag,
  SignatureWindow,
  backoffDelayMs,
  livenessLevel,
  measureReconnectGap,
  nextReconnectAlert,
  nextTransactionVersion,
  planBackfillPage,
  signaturesToRecover,
} from "./reliability.js";

describe("backoff", () => {
  it("doubles until the cap and adds jitter", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(1_000);
    expect(backoffDelayMs(2, () => 0)).toBe(2_000);
    expect(backoffDelayMs(3, () => 0)).toBe(4_000);
    expect(backoffDelayMs(8, () => 0)).toBe(30_000);
    expect(backoffDelayMs(2, () => 1)).toBe(2_400);
  });
});

describe("liveness", () => {
  it("stays healthy through a quiet event stream when slots or pongs are fresh", () => {
    expect(
      livenessLevel({
        nowMs: 120_000,
        connectedAtMs: 0,
        lastEvidenceAtMs: 119_000,
      }),
    ).toBe("ok");
  });

  it("warns and then goes critical when neither pongs nor slots arrive", () => {
    expect(
      livenessLevel({ nowMs: 29_999, connectedAtMs: 0, lastEvidenceAtMs: null, warnMs: 30_000 }),
    ).toBe("ok");
    expect(
      livenessLevel({ nowMs: 30_000, connectedAtMs: 0, lastEvidenceAtMs: null, warnMs: 30_000 }),
    ).toBe("warn");
    expect(
      livenessLevel({
        nowMs: 90_000,
        connectedAtMs: 0,
        lastEvidenceAtMs: 0,
        warnMs: 30_000,
        criticalMs: 90_000,
      }),
    ).toBe("critical");
  });

  it("alerts only the first failed reconnect of an outage", () => {
    expect(nextReconnectAlert({ opened: true, outageAlerted: false })).toEqual({
      alert: false,
      outageAlerted: false,
    });
    expect(nextReconnectAlert({ opened: false, outageAlerted: false })).toEqual({
      alert: true,
      outageAlerted: true,
    });
    expect(nextReconnectAlert({ opened: false, outageAlerted: true })).toEqual({
      alert: false,
      outageAlerted: true,
    });
  });

  it("measures the reconnect gap in seconds and slots", () => {
    expect(
      measureReconnectGap({
        nowMs: 10_500,
        lastLiveAtMs: 5_000,
        lastSlot: 100,
        currentSlot: 140,
      }),
    ).toEqual({ gapSeconds: 6, gapSlots: 40, untilSlot: 100 });
    expect(
      measureReconnectGap({
        nowMs: 1,
        lastLiveAtMs: null,
        lastSlot: null,
        currentSlot: 3,
      }),
    ).toEqual({ gapSeconds: null, gapSlots: null, untilSlot: null });
  });
});

describe("gap detection", () => {
  it("returns signatures newer than the checkpoint and asks for another page when the checkpoint is missing", () => {
    const first = planBackfillPage({
      newestFirst: ["d", "c", "b"],
      checkpoint: "a",
      pageWasFull: true,
      pagesFetched: 1,
      maxPages: 3,
    });
    expect(first.missing).toEqual(["d", "c", "b"]);
    expect(first.fetchAnotherPage).toBe(true);
    expect(first.gapRemains).toBe(false);

    const found = planBackfillPage({
      newestFirst: ["d", "c", "b", "a", "z"],
      checkpoint: "a",
      pageWasFull: true,
      pagesFetched: 2,
      maxPages: 3,
    });
    expect(found.missing).toEqual(["d", "c", "b"]);
    expect(found.fetchAnotherPage).toBe(false);
    expect(found.gapRemains).toBe(false);

    const exhausted = planBackfillPage({
      newestFirst: ["d", "c"],
      checkpoint: "a",
      pageWasFull: true,
      pagesFetched: 3,
      maxPages: 3,
    });
    expect(exhausted.fetchAnotherPage).toBe(false);
    expect(exhausted.gapRemains).toBe(true);
  });
});

describe("getTransaction version retry", () => {
  it("retries once after rpc -32015 and otherwise stops", () => {
    expect(nextTransactionVersion(-32015, 0)).toBe(1);
    expect(nextTransactionVersion(-32015, 1)).toBeNull();
    expect(nextTransactionVersion(-32602, 0)).toBeNull();
  });
});

describe("dedupe", () => {
  it("accepts a signature once and drops the repeat", () => {
    const window = new SignatureWindow(2);
    expect(window.add("sig", 0)).toBe(true);
    expect(window.add("sig", 0)).toBe(false);
    expect(window.add("sig", 1)).toBe(true);
    expect(window.add("other", 0)).toBe(true);
    expect(window.add("sig", 1)).toBe(false);
  });

  it("never grows past its cap", () => {
    const window = new SignatureWindow(3);
    for (let index = 0; index < 20; index += 1) {
      window.add(`sig-${index.toString()}`, 0);
      expect(window.size).toBeLessThanOrEqual(3);
    }
    expect(window.size).toBe(3);
    expect(window.add("sig-19", 0)).toBe(false);
    expect(window.add("sig-0", 0)).toBe(true);
  });
});

describe("bounded notes", () => {
  it("forgets the oldest notification name past the cap", () => {
    const notes = new BoundedSet(2);
    expect(notes.add("slotNotification")).toBe(true);
    expect(notes.add("slotNotification")).toBe(false);
    notes.add("other");
    notes.add("third");
    expect(notes.size).toBe(2);
    expect(notes.add("slotNotification")).toBe(true);
  });
});

describe("disposables", () => {
  it("stops timers and runs listener cleanups once", () => {
    vi.useFakeTimers();
    try {
      const bag = new DisposableBag();
      let ticks = 0;
      let cleaned = 0;
      bag.interval(() => {
        ticks += 1;
      }, 10);
      bag.add(() => {
        cleaned += 1;
      });
      vi.advanceTimersByTime(25);
      expect(ticks).toBe(2);
      bag.dispose();
      bag.dispose();
      vi.advanceTimersByTime(50);
      expect(ticks).toBe(2);
      expect(cleaned).toBe(1);
      expect(bag.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("short reconnect gaps", () => {
  it("stops at the last live slot instead of searching for an older event signature", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/backfill-gap-1s.json", import.meta.url), "utf8"),
    ) as {
      untilSlot: number;
      checkpoint: { signature: string; slot: number };
      page: Array<{ signature: string; slot: number }>;
    };
    const step = planBackfillPage({
      newestFirst: fixture.page,
      checkpoint: fixture.checkpoint.signature,
      checkpointSlot: fixture.checkpoint.slot,
      untilSlot: fixture.untilSlot,
      pageWasFull: true,
      pagesFetched: 1,
      maxPages: 40,
    });
    expect(step.missing).toEqual(["gap-1", "gap-2"]);
    expect(step.fetchAnotherPage).toBe(false);
    expect(step.gapRemains).toBe(false);
    expect(fixture.page.map((row) => row.signature)).not.toContain(fixture.checkpoint.signature);
  });
});

describe("backfill recovery", () => {
  it("still returns the signatures it already found when the page cap is hit", () => {
    const exhausted = planBackfillPage({
      newestFirst: ["d", "c"],
      checkpoint: "a",
      pageWasFull: true,
      pagesFetched: 3,
      maxPages: 3,
    });
    expect(exhausted.gapRemains).toBe(true);
    const recovered = signaturesToRecover({
      missingNewestFirst: ["e", "d", "c"],
      txCap: 2,
    });
    expect(recovered.signatures).toEqual(["e", "d"]);
    expect(recovered.truncated).toBe(true);
    expect(signaturesToRecover({ missingNewestFirst: ["e"], txCap: 5 }).truncated).toBe(false);
  });
});

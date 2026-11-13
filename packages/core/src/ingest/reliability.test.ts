import { describe, expect, it } from "vitest";

import {
  backoffDelayMs,
  nextTransactionVersion,
  planBackfillPage,
  silenceExceeded,
  SignatureWindow,
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

describe("silence", () => {
  it("alerts once after 60 seconds without a socket message", () => {
    expect(silenceExceeded({ lastMessageAtMs: 0, nowMs: 60_000, alreadyAlerted: false })).toBe(
      false,
    );
    expect(silenceExceeded({ lastMessageAtMs: 0, nowMs: 60_001, alreadyAlerted: false })).toBe(
      true,
    );
    expect(silenceExceeded({ lastMessageAtMs: 0, nowMs: 120_000, alreadyAlerted: true })).toBe(
      false,
    );
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
});

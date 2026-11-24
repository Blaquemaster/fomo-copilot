import { describe, expect, it } from "vitest";

import { fetchSignaturePage, reconcileWideGap, walkSignatureGap } from "./wideRecovery.js";

describe("wide recovery", () => {
  it("pages the public RPC and does not call Helius", async () => {
    const urls: string[] = [];
    const rows = await fetchSignaturePage({
      programId: "prog",
      before: null,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      fetchImpl: (async (url: string) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: [{ signature: "sig", slot: 10 }] }),
        };
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual(["https://api.mainnet-beta.solana.com"]);
    expect(urls.join(" ")).not.toMatch(/helius/i);
    expect(rows).toEqual([{ signature: "sig", slot: 10 }]);
  });

  it("stops past the slot bound without calling the scan a recovery", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    const pages = [
      [
        { signature: "new", slot: 5_000 },
        { signature: "mid", slot: 4_000 },
      ],
      [{ signature: "old", slot: 100 }],
    ];
    const walked = await walkSignatureGap({
      programId: "prog",
      fromSlot: 200,
      toSlot: 5_000,
      now,
      pageSize: 2,
      fetchPage: async () => pages.shift() ?? [],
    });
    expect(walked.finished).toBe(true);
    expect(walked.checkpoints[1]?.scanComplete).toBe(true);
    expect(walked.checkpoints.every((row) => row.recoveryCompletedAt === null)).toBe(true);
    expect(walked.signatures.map((row) => row.signature)).toEqual(["new", "mid", "old"]);
  });
});

describe("wide recovery reconcile", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");
  const pages = [
    [
      { signature: "a", slot: 2_000 },
      { signature: "b", slot: 2_000 },
    ],
    [{ signature: "c", slot: 100 }],
  ];

  function run(
    overrides: {
      failFetch?: string;
      failPersist?: string;
      already?: string[];
      pages?: Array<Array<{ signature: string; slot: number }>>;
      pageSize?: number;
    } = {},
  ) {
    const source = (overrides.pages ?? pages).map((page) => page);
    const stored: string[] = [];
    return reconcileWideGap({
      programId: "prog",
      fromSlot: 1_000,
      toSlot: 2_000,
      now,
      pageSize: overrides.pageSize ?? 2,
      alreadyStored: new Set(overrides.already ?? []),
      fetchPage: async () => source.shift() ?? [],
      fetchTransaction: async (signature) => {
        if (signature === overrides.failFetch) return { ok: false };
        return { ok: true, blockTime: new Date("2026-11-24T11:00:00.000Z") };
      },
      persist: async (event) => {
        if (event.signature === overrides.failPersist) throw new Error("persist");
        stored.push(event.signature);
      },
    }).then((result) => ({ result, stored }));
  }

  it("stores a gap wider than 600 slots into the event pipeline", async () => {
    const { result, stored } = await run();
    expect(2_000 - 1_000).toBeGreaterThan(600);
    expect(result.recoveryComplete).toBe(true);
    expect(result.recoveryCompletedAt?.toISOString()).toBe(now.toISOString());
    expect(stored).toEqual(["a", "b"]);
    expect(
      result.stored.every((event) => event.liveSignal === false && event.source === "backfill"),
    ).toBe(true);
    expect(result.stored[0]?.receivedAt.toISOString()).toBe(now.toISOString());
    expect(result.stored[0]?.blockTime?.toISOString()).not.toBe(now.toISOString());
  });

  it("keeps both transactions when one slot spans a page boundary", async () => {
    const { stored } = await run({
      pages: [
        [{ signature: "first", slot: 1_000 }],
        [{ signature: "second", slot: 1_000 }],
        [{ signature: "older", slot: 10 }],
      ],
      pageSize: 1,
    });
    expect(stored).toEqual(["first", "second"]);
  });

  it("does not mark an empty or truncated page as covered", async () => {
    const empty = await run({ pages: [[]], pageSize: 2 });
    expect(empty.result.scanComplete).toBe(false);
    expect(empty.result.recoveryCompletedAt).toBeNull();
    const truncated = await run({
      pages: [[{ signature: "only", slot: 5_000 }]],
      pageSize: 2,
    });
    expect(truncated.result.recoveryComplete).toBe(false);
    expect(truncated.result.incompleteReason).toBe("scan_incomplete");
  });

  it("leaves coverage incomplete when fetch or persist fails", async () => {
    const fetched = await run({ failFetch: "b" });
    expect(fetched.result.recoveryComplete).toBe(false);
    expect(fetched.result.incompleteReason).toBe("decode_failed");
    const persisted = await run({ failPersist: "b" });
    expect(persisted.result.incompleteReason).toBe("persist_failed");
    expect(persisted.result.recoveryCompletedAt).toBeNull();
  });

  it("resumes after a crash without storing the same signature twice", async () => {
    const first = await run({ failPersist: "b" });
    expect(first.stored).toEqual(["a"]);
    const second = await run({ already: ["a"] });
    expect(second.stored).toEqual(["b"]);
  });
});

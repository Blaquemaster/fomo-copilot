import { describe, expect, it } from "vitest";

import { FLAP_LAUNCHPAD, TOPIC_TAX_SET } from "@fomo/core";
import type { IngestRepository } from "@fomo/core";

import {
  BSC_SWEEP_MS,
  bscLogStall,
  enrichRetryDelayMs,
  handlePortalLog,
  logBlockPages,
  portalLogFilter,
  runBscIngest,
} from "./bsc.js";

describe("bsc flap intake", () => {
  it("does not open a socket when BSC_WSS_URL is unset", async () => {
    let opened = false;
    await runBscIngest({
      env: { BSC_WSS_URL: undefined } as never,
      logger: { error() {}, info() {}, warn() {}, debug() {} } as never,
      repo: {} as IngestRepository,
      signal: new AbortController().signal,
      deps: {
        openSocket: () => {
          opened = true;
          throw new Error("should not connect");
        },
      },
    });
    expect(opened).toBe(false);
  });

  it("subscribes only to create, tax, graduation, and CL pool logs", () => {
    const filter = portalLogFilter();
    expect(filter.address).toBe("0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0");
    expect(filter.topics[0]).toContain(TOPIC_TAX_SET);
    expect(filter.topics[0]?.join(" ")).not.toContain("TokenBought");
  });

  it("stores a tax rate on the asset and does not screen it", async () => {
    const assets: Array<{ launchpad: string; taxBps: number | null }> = [];
    const repo = {
      rememberAsset: async (input: { launchpad: string; taxBps: number | null }) => {
        assets.push(input);
      },
      insertChainEvent: async () => true,
    };
    await handlePortalLog(
      repo as unknown as IngestRepository,
      {
        topics: [TOPIC_TAX_SET],
        data:
          "0x" +
          "2222222222222222222222222222222222222222".padStart(64, "0") +
          (150).toString(16).padStart(64, "0"),
        blockNumber: 10,
        txHash: "0xabc",
        logIndex: 1,
      },
      async () => {
        throw new Error("screen");
      },
    );
    expect(assets).toEqual([
      expect.objectContaining({ launchpad: FLAP_LAUNCHPAD, taxBps: 150, chain: "bsc" }),
    ]);
  });

  it("does not apply a log that was already stored", async () => {
    let remembered = 0;
    const repo = {
      rememberAsset: async () => {
        remembered += 1;
      },
      insertChainEvent: async () => false,
    };
    const outcome = await handlePortalLog(repo as unknown as IngestRepository, {
      topics: [TOPIC_TAX_SET],
      data:
        "0x" +
        "2222222222222222222222222222222222222222".padStart(64, "0") +
        (150).toString(16).padStart(64, "0"),
      blockNumber: 10,
      txHash: "0xabc",
      logIndex: 1,
    });
    expect(outcome.stored).toBe(false);
    expect(remembered).toBe(0);
  });

  it("pages a long gap from the saved block, including the boundary", () => {
    expect(logBlockPages(100, 100)).toEqual([{ fromBlock: 100, toBlock: 100 }]);
    expect(logBlockPages(1, 1000)).toEqual([
      { fromBlock: 1, toBlock: 500 },
      { fromBlock: 500, toBlock: 999 },
      { fromBlock: 999, toBlock: 1000 },
    ]);
    expect(enrichRetryDelayMs(0)).toBe(30_000);
    expect(enrichRetryDelayMs(1)).toBe(120_000);
    expect(enrichRetryDelayMs(2)).toBe(600_000);
    expect(enrichRetryDelayMs(3)).toBeNull();
  });

  it("reconnects only when the head moved and the sweep found logs the subscription missed", () => {
    expect(BSC_SWEEP_MS).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(BSC_SWEEP_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(bscLogStall({ head: 900, checkpoint: 100, missedLogs: 0 })).toBe(false);
    expect(bscLogStall({ head: 100, checkpoint: 100, missedLogs: 4 })).toBe(false);
    expect(bscLogStall({ head: 900, checkpoint: 100, missedLogs: 4 })).toBe(true);
  });
});

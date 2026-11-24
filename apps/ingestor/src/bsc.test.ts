import { describe, expect, it } from "vitest";

import { FLAP_LAUNCHPAD, TOPIC_TAX_SET } from "@fomo/core";
import type { IngestRepository } from "@fomo/core";

import {
  BSC_SWEEP_MS,
  auditBscLogs,
  bscLogStall,
  catchUpBscLogs,
  clampLogRange,
  enrichRetryDelayMs,
  handlePortalLog,
  logBlockPages,
  portalLogFilter,
  nextBscAuditDelay,
  runBscIngest,
} from "./bsc.js";

describe("bsc flap intake", () => {
  it("keeps the 6 hour recall clock across a reconnect", () => {
    const every = 6 * 60 * 60 * 1000;
    expect(nextBscAuditDelay(0, 1_000, every)).toBe(every);
    const started = 0;
    const afterThreeHours = 3 * 60 * 60 * 1000;
    expect(nextBscAuditDelay(started + 1, afterThreeHours, every)).toBe(every - afterThreeHours + 1);
  });

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
    expect(clampLogRange(10, 21, 20)).toEqual({ fromBlock: 10, toBlock: 20 });
    expect(clampLogRange(21, 22, 20)).toBeNull();
  });

  it("checkpoints the served head when the node is behind the page, then continues", async () => {
    const logger = { error() {}, info() {}, warn() {}, debug() {} };
    const saved: number[] = [];
    const requested: Array<{ fromBlock: number; toBlock: number }> = [];
    const repo = {
      saveChainCheckpoint: async (input: { blockNumber: number }) => {
        saved.push(input.blockNumber);
      },
    };
    const send = (head: number) => async (method: string, params: unknown[]) => {
      if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string; toBlock: string };
        const fromBlock = Number.parseInt(filter.fromBlock, 16);
        const toBlock = Number.parseInt(filter.toBlock, 16);
        requested.push({ fromBlock, toBlock });
        return [];
      }
      throw new Error(method);
    };
    await catchUpBscLogs(
      { repo: repo as never, logger: logger as never },
      send(20),
      10,
      1_000,
      null,
    );
    expect(saved).toEqual([20]);
    expect(requested).toEqual([{ fromBlock: 10, toBlock: 20 }]);
    requested.length = 0;
    await catchUpBscLogs(
      { repo: repo as never, logger: logger as never },
      send(1_000),
      saved[saved.length - 1] ?? 20,
      1_000,
      null,
    );
    expect(saved[saved.length - 1]).toBe(1_000);
    expect(requested.every((range) => range.toBlock <= 1_000)).toBe(true);
    for (let block = 21; block <= 1_000; block += 1) {
      expect(requested.some((range) => range.fromBlock <= block && block <= range.toBlock)).toBe(
        true,
      );
    }
  });

  it("ends the recall window at the served head instead of the planned page", async () => {
    const logger = { error() {}, info() {}, warn() {}, debug() {} };
    const requested: Array<{ fromBlock: number; toBlock: number }> = [];
    const keyRanges: Array<{ fromBlock: number; toBlock: number }> = [];
    const audits: Array<{ fromBlock: number; toBlock: number }> = [];
    let headReads = 0;
    const send = async (method: string, params: unknown[]) => {
      if (method === "eth_blockNumber") {
        headReads += 1;
        const head = headReads === 1 ? 1_000 : 150;
        return `0x${head.toString(16)}`;
      }
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string; toBlock: string };
        requested.push({
          fromBlock: Number.parseInt(filter.fromBlock, 16),
          toBlock: Number.parseInt(filter.toBlock, 16),
        });
        return [];
      }
      throw new Error(method);
    };
    const repo = {
      chainCheckpoint: async () => ({ blockNumber: 100, coverageBlock: 100, reconnects: 0 }),
      chainEventKeys: async (_chain: string, fromBlock: number, toBlock: number) => {
        keyRanges.push({ fromBlock, toBlock });
        return new Set<string>();
      },
      insertChainAudit: async (input: { fromBlock: number; toBlock: number }) => {
        audits.push(input);
      },
    };
    await auditBscLogs({ repo: repo as never, logger: logger as never }, send);
    expect(requested).toEqual([{ fromBlock: 100, toBlock: 150 }]);
    expect(keyRanges).toEqual([{ fromBlock: 100, toBlock: 150 }]);
    expect(audits).toEqual([expect.objectContaining({ fromBlock: 100, toBlock: 150 })]);
  });
});

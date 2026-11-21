import { type Env, type IngestRepository } from "@fomo/core";
import { describe, expect, it, vi } from "vitest";

import { HeliusRpcError } from "./helius.js";
import { historyRetryDelayMs, runWalletMaintenance, walletRefreshIntervalMs } from "./walletJob.js";

const env = {
  NODE_ENV: "test",
  LOG_LEVEL: "error",
  POSTGRES_USER: "fomo",
  POSTGRES_PASSWORD: "password1",
  POSTGRES_DB: "fomo",
  DATABASE_URL: "postgres://fomo:password1@localhost:5432/fomo",
  TELEGRAM_BOT_TOKEN: "123456789:AAAAAAAAAA_test_token",
  TELEGRAM_ADMIN_CHAT_ID: "1",
  HELIUS_API_KEY: "test-helius-key",
  HELIUS_PLAN: "developer",
  HELIUS_WS_MODE: "auto",
  INGEST_MODE: "dry-run",
  INGEST_VENUE: "pump",
  PUMP_SUBSCRIBE_TRADES: false,
  PUMP_SUBSCRIBE_CREATE_POOL: false,
  PUMP_TRADE_DETAIL_SLOTS: 150,
  BACKFILL_SLOT_MARGIN: 0,
  BSC_WSS_URL: "wss://bsc-rpc.publicnode.com",
  HELIUS_MONTHLY_CREDITS: 10_000_000,
} as Env;

describe("early-buyer history retry", () => {
  it("runs every four hours by default and still caps each run", () => {
    expect(walletRefreshIntervalMs(undefined)).toBe(4 * 60 * 60 * 1000);
    expect(walletRefreshIntervalMs(4)).toBe(4 * 60 * 60 * 1000);
  });

  it("backs off within minutes and does not mark the job finished after an rpc error", async () => {
    expect(historyRetryDelayMs(1)).toBe(60_000);
    expect(historyRetryDelayMs(2)).toBe(120_000);
    expect(historyRetryDelayMs(8)).toBe(600_000);
    const controller = new AbortController();
    const sleeps: number[] = [];
    const markWalletJob = vi.fn(async () => undefined);
    const logged: Array<{ code?: number }> = [];
    let fetches = 0;
    await runWalletMaintenance({
      env,
      logger: {
        info() {},
        error() {},
        debug() {},
        fatal() {},
        trace() {},
        warn(obj: unknown) {
          logged.push(obj as { code?: number });
        },
      } as never,
      repo: {
        walletJobFinishedAt: async () => null,
        featureMonthMicros: async () => 0n,
        nextBackfillMints: async () => [
          {
            mint: "mint",
            venue: "pump",
            account: "curve",
            creator: null,
            graduated: true,
            paginationToken: null,
            buysKept: 0,
            pages: 0,
            failures: 0,
          },
        ],
        saveEarlyBuyers: async () => 0,
        saveBackfillCheckpoint: async () => undefined,
        recordFeatureSpend: async () => undefined,
        earlyBuys: async () => [],
        activeTrackedWallets: async () => [],
        applyWalletRefresh: async () => undefined,
        markWalletJob,
      } as unknown as IngestRepository,
      signal: controller.signal,
      fetchPage: async () => {
        fetches += 1;
        throw new HeliusRpcError("Transaction version (1) is not supported", -32015);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        controller.abort();
      },
    });
    expect(fetches).toBe(1);
    expect(markWalletJob).not.toHaveBeenCalled();
    expect(sleeps).toEqual([60_000]);
    expect(logged.some((entry) => entry.code === -32015)).toBe(true);
  });

  it("does not churn the wallet list while a paper protocol row exists", async () => {
    const controller = new AbortController();
    const applyWalletRefresh = vi.fn(async () => undefined);
    await runWalletMaintenance({
      env,
      logger: {
        info() {},
        error() {},
        debug() {},
        fatal() {},
        trace() {},
        warn() {},
      } as never,
      repo: {
        walletJobFinishedAt: async () => null,
        featureMonthMicros: async () => 0n,
        nextBackfillMints: async () => [],
        saveEarlyBuyers: async () => 0,
        saveBackfillCheckpoint: async () => undefined,
        recordFeatureSpend: async () => undefined,
        earlyBuys: async () => [],
        activeTrackedWallets: async () => ["kept-wallet"],
        paperTestOpen: async () => true,
        applyWalletRefresh,
        markWalletJob: async () => undefined,
      } as unknown as IngestRepository,
      signal: controller.signal,
      fetchPage: async () => ({ raw: [], paginationToken: null, credits: 0 }),
      sleep: async () => {
        controller.abort();
      },
    });
    expect(applyWalletRefresh).not.toHaveBeenCalled();
  });
});

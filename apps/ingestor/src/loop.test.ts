import { readFileSync } from "node:fs";
import { Writable } from "node:stream";

import { createLogger, sendTelegramMessage, type Env, type IngestRepository } from "@fomo/core";
import { describe, expect, it, vi } from "vitest";

import { backfillProgram, recordHeapSample, runIngestLoop, type SocketLike } from "./loop.js";

vi.mock("@fomo/core", async () => {
  const actual = await vi.importActual<typeof import("@fomo/core")>("@fomo/core");
  return { ...actual, sendTelegramMessage: vi.fn(async () => undefined) };
});

const env: Env = {
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
  INGEST_VENUE: "meteora",
  PUMP_SUBSCRIBE_TRADES: false,
  PUMP_SUBSCRIBE_CREATE_POOL: false,
  PUMP_TRADE_DETAIL_SLOTS: 150,
  BACKFILL_SLOT_MARGIN: 0,
  BSC_WSS_URL: "wss://bsc-rpc.publicnode.com",
};

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  ping: () => void = () => undefined;

  constructor(private readonly failOpen = false) {
    super();
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      if (this.failOpen) {
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

function asSocket(socket: FakeSocket): SocketLike {
  return socket as unknown as SocketLike;
}

function logger() {
  return createLogger({
    level: "error",
    app: "ingestor",
    destination: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
}

function repo(overrides: Partial<IngestRepository> = {}): IngestRepository {
  const base = {
    addUsage: vi.fn(async () => undefined),
    writeStatus: vi.fn(async () => undefined),
    insertRaw: vi.fn(async () => true),
    saveCheckpoint: vi.fn(async () => undefined),
    earliestFirstSeenMs: vi.fn(async () => null),
    insertCandidate: vi.fn(async () => undefined),
    markCurve: vi.fn(async () => undefined),
    markGraduation: vi.fn(async () => undefined),
    monthUsage: vi.fn(async () => ({
      creditMicros: 0n,
      alerted60: false,
      alerted80: false,
      paused: false,
    })),
    markBudgetAlert: vi.fn(async () => undefined),
    clearPause: vi.fn(async () => undefined),
    checkpoint: vi.fn(async () => ({ signature: "ckpt", slot: 1 })),
    insertDecodeFailure: vi.fn(async () => undefined),
    insertBackfill: vi.fn(async () => undefined),
    knownSignatures: vi.fn(async () => new Set<string>()),
    lastLiveSlot: vi.fn(async () => null),
    ingestCursor: vi.fn(async () => ({ slot: null, venue: null, coverageSlot: null })),
    venueCoverages: vi.fn(async () => new Map<string, number>()),
    recordVenueCoverage: vi.fn(async () => undefined),
    clearCheckpoint: vi.fn(async () => undefined),
    rememberCoin: vi.fn(async () => undefined),
    insertHeapSample: vi.fn(async () => undefined),
    flushAccounting: vi.fn(async () => undefined),
    persistEvent: vi.fn(async () => true),
    insertRecall: vi.fn(async () => undefined),
    recallTotals: vi.fn(async () => ({ missed: 0, expected: 0, windows: 0 })),
    creationUnseen: vi.fn(async () => 0),
    alertableCandidates: vi.fn(async () => []),
    earlyBuys: vi.fn(async () => []),
    activeTrackedWallets: vi.fn(async () => []),
    paperTestOpen: vi.fn(async () => false),
    activeScoringVersion: vi.fn(async () => null),
    saveTrackedWallets: vi.fn(async () => undefined),
    insertWalletFill: vi.fn(async () => undefined),
    insertXMentions: vi.fn(async () => 0),
    featureMonthMicros: vi.fn(async () => 0n),
  };
  return { ...base, ...overrides } as unknown as IngestRepository;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const liveFrame = JSON.stringify({
  jsonrpc: "2.0",
  method: "parsedTransactionNotification",
  params: {
    result: {
      context: { slot: 9 },
      value: {
        transaction: { signature: "live-sig", slot: 9, error: null, blockTime: 1700000000 },
        instructions: [
          {
            programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
            instructionName: "initialize_virtual_pool_with_spl_token",
            decoded: {
              accounts: [
                { name: "base_mint", pubkey: "base-mint" },
                { name: "pool", pubkey: "dbc-pool" },
              ],
            },
          },
        ],
      },
    },
  },
});

describe("ingest loop", () => {
  it("handles live frames that arrive while backfill is still paging", async () => {
    const socket = new FakeSocket();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const store = repo({
      persistEvent: vi.fn(async () => {
        order.push("insert");
        return true;
      }),
    });
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: store,
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        callRpc: (method) => {
          if (method === "getSlot") return Promise.resolve(20);
          if (method === "getSignaturesForAddress") {
            order.push("backfill");
            return gate.then(() => [{ signature: "ckpt", slot: 1 }]);
          }
          return Promise.resolve(null);
        },
      },
    });
    await vi.waitFor(() => {
      expect(order).toContain("backfill");
    });
    socket.dispatchEvent(new MessageEvent("message", { data: liveFrame }));
    await vi.waitFor(() => {
      expect(order).toContain("insert");
    });
    expect(order.indexOf("insert")).toBeGreaterThan(order.indexOf("backfill"));
    expect(socket.sent.some((frame) => frame.includes("parsedTransactionSubscribe"))).toBe(true);
    expect(socket.sent.some((frame) => frame.includes("slotSubscribe"))).toBe(true);
    release();
    controller.abort();
    await done;
  });

  it("does not reconnect when the event stream is quiet but slots keep advancing", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    let slot = 10;
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 40,
        criticalMs: 80,
        livenessTickMs: 15,
        callRpc: (method) =>
          Promise.resolve(
            method === "getSlot" ? 30 : method === "getSignaturesForAddress" ? [] : null,
          ),
      },
    });
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(1);
    });
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ jsonrpc: "2.0", id: 1, result: 11 }),
      }),
    );
    const beats = setInterval(() => {
      slot += 1;
      socket.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            jsonrpc: "2.0",
            method: "slotNotification",
            params: { result: { slot }, subscription: 1 },
          }),
        }),
      );
    }, 20);
    await delay(180);
    clearInterval(beats);
    expect(socket.readyState).toBe(1);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("reconnects when slots and pongs both stop, and alerts only if the next open fails", async () => {
    const first = new FakeSocket();
    const opens: FakeSocket[] = [];
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => {
          const next = opens.length === 0 ? first : new FakeSocket(true);
          opens.push(next);
          return asSocket(next);
        },
        warnMs: 30,
        criticalMs: 70,
        livenessTickMs: 10,
        callRpc: (method) =>
          Promise.resolve(
            method === "getSlot" ? 4 : method === "getSignaturesForAddress" ? [] : null,
          ),
      },
    });
    await vi.waitFor(() => {
      expect(first.readyState).toBe(3);
    });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    await vi.waitFor(
      () => {
        expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 2_000 },
    );
    await delay(1_200);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    controller.abort();
    await done;
  });

  it("writes a websocket ping and a json-rpc ping before the server's idle close", async () => {
    const socket = new FakeSocket();
    let pings = 0;
    socket.ping = () => {
      pings += 1;
    };
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        pingMs: 30,
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        callRpc: (method) =>
          Promise.resolve(
            method === "getSlot" ? 30 : method === "getSignaturesForAddress" ? [] : null,
          ),
      },
    });
    await vi.waitFor(() => {
      expect(pings).toBeGreaterThanOrEqual(1);
    });
    expect(socket.sent.some((frame) => frame.includes('"method":"ping"'))).toBe(true);
    expect(socket.readyState).toBe(1);
    controller.abort();
    await done;
  });

  it("keeps every transaction in a 50-frame burst against a slow database", async () => {
    const socket = new FakeSocket();
    const stored = vi.fn(async () => {
      await delay(500);
      return true;
    });
    const flushed = vi.fn(async () => undefined);
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo({ persistEvent: stored, flushAccounting: flushed }),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: (method) =>
          Promise.resolve(
            method === "getSlot" ? 20 : method === "getSignaturesForAddress" ? [] : null,
          ),
      },
    });
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(1);
    });
    for (let index = 0; index < 50; index += 1) {
      const frame = liveFrame.replaceAll("live-sig", `burst-${index.toString()}`);
      socket.dispatchEvent(new MessageEvent("message", { data: frame }));
    }
    await vi.waitFor(
      () => {
        expect(stored).toHaveBeenCalledTimes(50);
      },
      { timeout: 40_000 },
    );
    controller.abort();
    await done;
    const frames = (
      flushed.mock.calls as unknown as Array<
        [
          {
            frames: Array<{
              kind: string;
              dropReason: string;
              received: number;
              dropped: number;
              shadowDropped: number;
            }>;
          },
        ]
      >
    ).flatMap((call) => call[0].frames);
    const dropped = frames
      .filter((row) => row.kind === "tx" && row.dropReason === "queue_overflow")
      .reduce((sum, row) => sum + row.dropped, 0);
    const shadow = frames
      .filter((row) => row.kind === "meta")
      .reduce((sum, row) => sum + row.shadowDropped, 0);
    const received = frames
      .filter((row) => row.kind === "tx" && row.dropReason === "")
      .reduce((sum, row) => sum + row.received, 0);
    expect(dropped).toBe(0);
    expect(received).toBe(50);
    expect(shadow).toBeGreaterThan(0);
  }, 45_000);

  it("reconnects and alerts when the transaction subscription is not confirmed", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        confirmTimeoutMs: 40,
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 10,
        usageFlushMs: 60_000,
        callRpc: () => Promise.resolve([]),
      },
    });
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(3);
    });
    expect(sendTelegramMessage).toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("reconnects and alerts when the subscription is rejected", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        confirmTimeoutMs: 60_000,
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        callRpc: () => Promise.resolve([]),
      },
    });
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(1);
    });
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "subscription rejected" },
        }),
      }),
    );
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(3);
    });
    expect(sendTelegramMessage).toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("fetches an oversized transaction instead of discarding it", async () => {
    const socket = new FakeSocket();
    const signature = "2".repeat(64);
    const methods: string[] = [];
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: (method) => {
          methods.push(method);
          return Promise.resolve(null);
        },
      },
    });
    await vi.waitFor(() => {
      expect(socket.readyState).toBe(1);
    });
    const signatureJson = `"signature":"${signature}"`;
    const frame = `{${signatureJson},"method":"parsedTransactionNotification","slot":5}${" ".repeat(100_001)}`;
    socket.dispatchEvent(new MessageEvent("message", { data: frame }));
    await vi.waitFor(() => {
      expect(methods).toContain("getTransaction");
    });
    controller.abort();
    await done;
  });

  it("subscribes to Pump.fun creates and not to every trade when trades are off", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env: { ...env, INGEST_VENUE: "pump", PUMP_SUBSCRIBE_TRADES: false },
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes("parsedTransactionSubscribe"))).toBe(true);
    });
    const subscribe =
      socket.sent.find((frame) => frame.includes("parsedTransactionSubscribe")) ?? "";
    expect(subscribe).toContain("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    expect(subscribe).toContain("create_v2");
    expect(subscribe).not.toContain("create_pool");
    expect(subscribe).not.toContain("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
    expect(subscribe).not.toContain("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    const body = JSON.parse(subscribe) as {
      params: Array<{ instructionNames?: string[] }>;
    };
    expect(body.params[0]?.instructionNames).not.toContain("buy");
    controller.abort();
    await done;
  });

  it("does not backfill PumpSwap when create_pool is off", async () => {
    const scanned: string[] = [];
    const cleared: string[] = [];
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env: { ...env, INGEST_VENUE: "pump" },
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => ({ signature: "ckpt", slot: 1 })),
        ingestCursor: vi.fn(async () => ({ slot: 80, venue: "pump", coverageSlot: 80 })),
        clearCheckpoint: vi.fn(async (programId: string) => {
          cleared.push(programId);
        }),
      }),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        scanHistory: (request) => {
          scanned.push(request.programId);
          return Promise.resolve({ matches: [], creditsCharged: 11, complete: true });
        },
        callRpc: (method) => Promise.resolve(method === "getSlot" ? 80 : []),
      },
    });
    await vi.waitFor(() => {
      expect(scanned).toContain("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    });
    expect(scanned).not.toContain("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
    expect(cleared).toContain("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
    controller.abort();
    await done;
  });

  it("subscribes to Pump, LaunchLab, and Meteora creates together", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env: { ...env, INGEST_VENUES: "pump,launchlab,meteora" },
      logger: logger(),
      repo: repo(),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes("parsedTransactionSubscribe"))).toBe(true);
    });
    const subscribe =
      socket.sent.find((frame) => frame.includes("parsedTransactionSubscribe")) ?? "";
    expect(subscribe).toContain("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    expect(subscribe).toContain("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
    expect(subscribe).toContain("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    expect(subscribe).toContain("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
    expect(subscribe).toContain("initialize_with_token_2022");
    expect(subscribe).toContain("migrate_to_cpswap");
    expect(subscribe).not.toContain("buy_exact_in");
    expect(subscribe).not.toContain("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
    controller.abort();
    await done;
  });

  it("subscribes only the tracked wallets and meters a fill as wallet_subscribe", async () => {
    vi.mocked(sendTelegramMessage).mockClear();
    const socket = new FakeSocket();
    const controller = new AbortController();
    const store = repo({
      activeTrackedWallets: vi.fn(async () => ["tracked-wallet"]),
    });
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: store,
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 20,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes('"id":10'))).toBe(true);
    });
    const walletFrame = socket.sent.find((frame) => frame.includes('"id":10')) ?? "";
    const body = JSON.parse(walletFrame) as {
      method: string;
      params: Array<{
        programs: string[];
        instructionNames: string[];
        accounts: { include: string[] };
      }>;
    };
    expect(body.method).toBe("parsedTransactionSubscribe");
    expect(body.params[0]?.accounts.include).toEqual(["tracked-wallet"]);
    expect(body.params[0]?.programs).toContain("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
    expect(body.params[0]?.programs).toContain("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
    expect(body.params[0]?.instructionNames).toContain("buy_exact_in");
    expect(body.params[0]?.instructionNames).toContain("swap");
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", id: 10, result: 77 }) }),
    );
    await delay(20);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          method: "parsedTransactionNotification",
          params: {
            subscription: 77,
            result: {
              context: { slot: 12 },
              value: {
                transaction: { signature: "fill-sig", slot: 12, error: null },
                instructions: [
                  {
                    programId: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
                    instructionName: "buy_exact_in",
                    decoded: {
                      accounts: [
                        { name: "user", pubkey: "tracked-wallet" },
                        { name: "base_mint", pubkey: "coin-mint" },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      }),
    );
    await vi.waitFor(() => {
      expect(store.insertWalletFill).toHaveBeenCalledWith(
        expect.objectContaining({
          signature: "fill-sig",
          wallet: "tracked-wallet",
          mint: "coin-mint",
          side: "buy",
          venue: "launchlab",
        }),
      );
    });
    await vi.waitFor(() => {
      const calls = vi.mocked(store.flushAccounting).mock.calls;
      expect(
        calls.some((call) => call[0].featureCredits?.["wallet_subscribe"] === 1_000_000n),
      ).toBe(true);
    });
    expect(vi.mocked(sendTelegramMessage)).not.toHaveBeenCalled();
    expect(store.persistEvent).not.toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("unsubscribes wallet trades when the feature cap is reached and does not store them as raw events", async () => {
    vi.mocked(sendTelegramMessage).mockClear();
    const socket = new FakeSocket();
    const controller = new AbortController();
    const store = repo({
      activeTrackedWallets: vi.fn(async () => ["tracked-wallet"]),
      featureMonthMicros: vi.fn(async () => 2_499_999_000_000n),
    });
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: store,
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes('"id":10'))).toBe(true);
    });
    socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", id: 10, result: 77 }) }),
    );
    await delay(20);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          method: "parsedTransactionNotification",
          params: {
            subscription: 77,
            result: {
              context: { slot: 12 },
              value: {
                transaction: { signature: "fill-sig", slot: 12, error: null },
                instructions: [
                  {
                    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
                    instructionName: "buy",
                    decoded: {
                      accounts: [
                        { name: "user", pubkey: "tracked-wallet" },
                        { name: "mint", pubkey: "coin-mint" },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      }),
    );
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes("parsedTransactionUnsubscribe"))).toBe(
        true,
      );
    });
    const unsub = JSON.parse(
      socket.sent.find((frame) => frame.includes("parsedTransactionUnsubscribe")) ?? "{}",
    ) as { params: number[] };
    expect(unsub.params).toEqual([77]);
    expect(store.persistEvent).not.toHaveBeenCalled();
    expect(store.insertWalletFill).toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("does not store the x mention fixture in production", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const store = repo();
    const done = runIngestLoop({
      env: { ...env, NODE_ENV: "production", X_MENTION_SOURCE: "fixture" },
      logger: logger(),
      repo: store,
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes("parsedTransactionSubscribe"))).toBe(true);
    });
    expect(store.insertXMentions).not.toHaveBeenCalled();
    controller.abort();
    await done;
  });

  it("does not open the wallet subscription once the feature cap is spent", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: repo({
        activeTrackedWallets: vi.fn(async () => ["tracked-wallet"]),
        featureMonthMicros: vi.fn(async () => 2_500_000_000_000n),
      }),
      signal: controller.signal,
      deps: {
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(socket.sent.some((frame) => frame.includes("parsedTransactionSubscribe"))).toBe(true);
    });
    expect(socket.sent.some((frame) => frame.includes('"id":10'))).toBe(false);
    controller.abort();
    await done;
  });

  it("backfills early buyers on a schedule and does not alert Telegram", async () => {
    vi.mocked(sendTelegramMessage).mockClear();
    const socket = new FakeSocket();
    const controller = new AbortController();
    const store = repo({
      walletJobFinishedAt: vi.fn(async () => null),
      nextBackfillMints: vi.fn(async () => [
        {
          mint: "coin-mint",
          venue: "launchlab",
          account: "pool",
          creator: null,
          graduated: true,
          paginationToken: null,
          buysKept: 0,
          pages: 0,
          failures: 0,
        },
      ]),
      saveEarlyBuyers: vi.fn(async () => 0),
      saveBackfillCheckpoint: vi.fn(async () => undefined),
      recordFeatureSpend: vi.fn(async () => undefined),
      applyWalletRefresh: vi.fn(async () => undefined),
      markWalletJob: vi.fn(async () => undefined),
    });
    const done = runIngestLoop({
      env,
      logger: logger(),
      repo: store,
      signal: controller.signal,
      deps: {
        walletMaintenance: true,
        fetchEarlyBuyerPage: async () => ({ transactions: [], paginationToken: null }),
        openSocket: () => asSocket(socket),
        warnMs: 60_000,
        criticalMs: 120_000,
        livenessTickMs: 60_000,
        usageFlushMs: 60_000,
        confirmTimeoutMs: 60_000,
        callRpc: () => Promise.resolve(1),
      },
    });
    await vi.waitFor(() => {
      expect(store.recordFeatureSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: "wallet_backfill",
          creditMicros: 10_000_000n,
        }),
      );
    });
    await vi.waitFor(() => {
      expect(store.markWalletJob).toHaveBeenCalled();
    });
    expect(vi.mocked(sendTelegramMessage)).not.toHaveBeenCalled();
    controller.abort();
    await done;
  });
});

describe("short backfill", () => {
  it("fetches only the signatures inside a 1-2 second slot gap", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../packages/core/src/ingest/fixtures/backfill-gap-1s.json", import.meta.url),
        "utf8",
      ),
    ) as {
      untilSlot: number;
      checkpoint: { signature: string; slot: number };
      page: Array<{ signature: string; slot: number }>;
    };
    const methods: string[] = [];
    const fetched: string[] = [];
    await backfillProgram({
      env,
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => fixture.checkpoint),
        knownSignatures: vi.fn(async () => new Set(["gap-1"])),
      }),
      programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
      paused: false,
      gap: {
        gapSeconds: 2,
        gapSlots: 6,
        untilSlot: fixture.untilSlot,
        tipSlot: fixture.untilSlot + 6,
      },
      deps: {
        scanHistory: () => Promise.reject(new Error("offline")),
        callRpc: (method, params) => {
          methods.push(method);
          if (method === "getSignaturesForAddress") {
            return Promise.resolve(fixture.page.map((row) => ({ ...row, err: null })));
          }
          if (method === "getTransaction") {
            fetched.push(String(params[0]));
            return Promise.resolve(null);
          }
          return Promise.resolve(null);
        },
      },
    });
    expect(methods.filter((method) => method === "getSignaturesForAddress")).toEqual([
      "getSignaturesForAddress",
    ]);
    expect(fetched).toEqual(["gap-2"]);
    expect(methods.filter((method) => method === "getTransaction")).toHaveLength(1);
  });

  it("records an unrecovered gap when the transaction cap stops before the slot bound", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../packages/core/src/ingest/fixtures/backfill-gap-1s.json", import.meta.url),
        "utf8",
      ),
    ) as {
      untilSlot: number;
      checkpoint: { signature: string; slot: number };
      page: Array<{ signature: string; slot: number }>;
    };
    const inserted = vi.fn(async () => undefined);
    const warns: string[] = [];
    await backfillProgram({
      env,
      logger: {
        debug() {
          return undefined;
        },
        info() {
          return undefined;
        },
        warn(first: string | Record<string, unknown>, message?: string) {
          warns.push(typeof first === "string" ? first : (message ?? ""));
        },
        error() {
          return undefined;
        },
      },
      repo: repo({
        checkpoint: vi.fn(async () => fixture.checkpoint),
        insertBackfill: inserted,
      }),
      programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
      paused: false,
      gap: { gapSeconds: 2, gapSlots: 6, untilSlot: fixture.untilSlot, tipSlot: fixture.untilSlot },
      deps: {
        txCap: 1,
        scanHistory: () => Promise.reject(new Error("offline")),
        callRpc: (method) => {
          if (method === "getSignaturesForAddress") {
            return Promise.resolve(fixture.page.map((row) => ({ ...row, err: null })));
          }
          return Promise.resolve(null);
        },
      },
    });
    expect(warns).toContain("backfill unrecovered gap");
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({
        unrecovered: true,
        gapFromSlot: fixture.untilSlot,
        gapToSlot: fixture.page[0]?.slot,
        reason: "cap_hit",
      }),
    );
  });

  it("scans DAMM initialize instructions instead of fetching every swap", async () => {
    const methods: string[] = [];
    const fetched: string[] = [];
    const scanned: Array<{ instructionNames: readonly string[]; slotGt: number }> = [];
    await backfillProgram({
      env,
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => ({ signature: "checkpoint", slot: 100 })),
      }),
      programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
      paused: false,
      gap: { gapSeconds: 28, gapSlots: 82, untilSlot: 200, tipSlot: 282 },
      deps: {
        scanHistory: (request) => {
          scanned.push({ instructionNames: request.instructionNames, slotGt: request.slotGt });
          return Promise.resolve({
            matches: [{ signature: "init-1", slot: 250 }],
            creditsCharged: 12,
            complete: true,
          });
        },
        callRpc: (method, params) => {
          methods.push(method);
          if (method === "getTransaction") fetched.push(String(params[0]));
          return Promise.resolve(null);
        },
      },
    });
    expect(methods).not.toContain("getSignaturesForAddress");
    expect(fetched).toEqual(["init-1"]);
    expect(scanned[0]?.instructionNames).toEqual([
      "initialize_pool",
      "initialize_customizable_pool",
      "initialize_pool_with_dynamic_config",
    ]);
    expect(scanned[0]?.slotGt).toBe(200);
  });

  it("scans DBC without the transfer-hook name the parsed scan rejects", async () => {
    const scanned: string[][] = [];
    await backfillProgram({
      env,
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => ({ signature: "checkpoint", slot: 100 })),
      }),
      programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
      paused: false,
      gap: { gapSeconds: 28, gapSlots: 82, untilSlot: 200, tipSlot: 282 },
      deps: {
        scanHistory: (request) => {
          scanned.push([...request.instructionNames]);
          return Promise.resolve({ matches: [], creditsCharged: 11, complete: true });
        },
        callRpc: () => Promise.resolve(null),
      },
    });
    expect(scanned[0]).toEqual([
      "initialize_virtual_pool_with_spl_token",
      "initialize_virtual_pool_with_token2022",
      "migration_damm_v2",
    ]);
  });

  it("records high_volume_skipped when the parsed scan is unavailable", async () => {
    const methods: string[] = [];
    const inserted = vi.fn(async () => undefined);
    await backfillProgram({
      env,
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => ({ signature: "checkpoint", slot: 100 })),
        insertBackfill: inserted,
      }),
      programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
      paused: false,
      gap: { gapSeconds: 28, gapSlots: 82, untilSlot: 200, tipSlot: 282 },
      deps: {
        scanHistory: () => Promise.reject(new Error("scan down")),
        callRpc: (method) => {
          methods.push(method);
          return Promise.resolve(null);
        },
      },
    });
    expect(methods).toEqual([]);
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({
        unrecovered: true,
        reason: "high_volume_skipped",
        transactionsFetched: 0,
      }),
    );
  });

  it("does not list DAMM signatures when the persisted slot is too old", async () => {
    const methods: string[] = [];
    const inserted = vi.fn(async () => undefined);
    await backfillProgram({
      env,
      logger: logger(),
      repo: repo({
        checkpoint: vi.fn(async () => ({ signature: "checkpoint", slot: 100 })),
        insertBackfill: inserted,
      }),
      programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
      paused: false,
      gap: {
        gapSeconds: null,
        gapSlots: null,
        untilSlot: null,
        tipSlot: 1_000_000,
        staleFromSlot: 100,
      },
      deps: {
        callRpc: (method) => {
          methods.push(method);
          return Promise.resolve(null);
        },
      },
    });
    expect(methods).toEqual([]);
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({ unrecovered: true, reason: "too_old", gapFromSlot: 100 }),
    );
  });
});

describe("heap sample", () => {
  it("logs heapUsed and stores the process age", async () => {
    const inserted = vi.fn(async () => undefined);
    const lines: string[] = [];
    await recordHeapSample(repo({ insertHeapSample: inserted }), {
      debug() {
        return undefined;
      },
      info(first: string | Record<string, unknown>, message?: string) {
        lines.push(typeof first === "string" ? first : (message ?? ""));
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
    });
    expect(lines).toEqual(["ingest heap sample"]);
    expect(inserted).toHaveBeenCalledWith(
      expect.objectContaining({
        heapUsedBytes: expect.any(Number),
        rssBytes: expect.any(Number),
        uptimeSec: expect.any(Number),
      }),
    );
  });
});

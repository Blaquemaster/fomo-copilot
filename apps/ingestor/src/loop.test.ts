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
  BACKFILL_SLOT_MARGIN: 0,
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
    insertHeapSample: vi.fn(async () => undefined),
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
      insertRaw: vi.fn(async () => {
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
      }),
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

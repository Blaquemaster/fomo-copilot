import { Writable } from "node:stream";

import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DLMM_PROGRAM_ID,
  createLogger,
  sendTelegramMessage,
  type Env,
  type IngestRepository,
} from "@fomo/core";
import { describe, expect, it, vi } from "vitest";

import { auditScanErrorReason, runRecallAudit } from "./audit.js";

vi.mock("@fomo/core", async () => {
  const actual = await vi.importActual<typeof import("@fomo/core")>("@fomo/core");
  return { ...actual, sendTelegramMessage: vi.fn(async () => undefined) };
});

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
  INGEST_VENUE: "meteora",
  PUMP_SUBSCRIBE_TRADES: false,
  PUMP_SUBSCRIBE_CREATE_POOL: false,
  PUMP_TRADE_DETAIL_SLOTS: 150,
  BACKFILL_SLOT_MARGIN: 0,
} as Env;

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

describe("recall audit", () => {
  it("names an HTTP 400 as a rejected scan", () => {
    expect(auditScanErrorReason(new Error("helius parsed-events scan HTTP 400"))).toBe(
      "scan_rejected",
    );
    expect(auditScanErrorReason(new Error("helius parsed-events scan request failed"))).toBe(
      "scan_failed",
    );
  });

  it("records a rejected DBC scan and continues with the other programs", async () => {
    const inserted = vi.fn(async () => undefined);
    const scanned: string[] = [];
    await runRecallAudit({
      env,
      logger: logger(),
      now: () => Date.parse("2026-11-16T12:00:00.000Z"),
      tipSlot: 470_000_000,
      repo: {
        monthUsage: vi.fn(async () => ({
          creditMicros: 0n,
          alerted60: false,
          alerted80: false,
          paused: false,
        })),
        addUsage: vi.fn(async () => undefined),
        insertRecall: inserted,
        ingestCursor: vi.fn(async () => ({ slot: 1, venue: "meteora", coverageSlot: 0 })),
        knownSignatures: vi.fn(async () => new Set<string>()),
        persistEvent: vi.fn(async () => true),
        recallTotals: vi.fn(async () => ({ missed: 0, expected: 0, windows: 0 })),
        creationUnseen: vi.fn(async () => 0),
      } as unknown as IngestRepository,
      scan: (request) => {
        scanned.push(request.programId);
        expect(request.instructionNames).not.toContain(
          "initialize_virtual_pool_with_token2022_transfer_hook",
        );
        if (request.programId === DBC_PROGRAM_ID) {
          return Promise.reject(new Error("helius parsed-events scan HTTP 400"));
        }
        return Promise.resolve({ matches: [], creditsCharged: 11, complete: true });
      },
    });
    expect(scanned).toEqual([DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID, DLMM_PROGRAM_ID]);
    expect(inserted).toHaveBeenCalledTimes(3);
    expect(inserted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        programId: DBC_PROGRAM_ID,
        errored: true,
        errorReason: "scan_rejected",
        missed: 0,
      }),
    );
    expect(inserted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ programId: DAMM_V2_PROGRAM_ID, errored: false }),
    );
    expect(inserted).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ programId: DLMM_PROGRAM_ID, errored: false }),
    );
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("records a pre-coverage window as skipped and does not alert", async () => {
    vi.mocked(sendTelegramMessage).mockClear();
    const inserted = vi.fn(async () => undefined);
    const scanned: string[] = [];
    await runRecallAudit({
      env,
      logger: logger(),
      now: () => Date.parse("2026-11-16T12:00:00.000Z"),
      tipSlot: 470_000_000,
      repo: {
        monthUsage: vi.fn(async () => ({
          creditMicros: 0n,
          alerted60: false,
          alerted80: false,
          paused: false,
        })),
        addUsage: vi.fn(async () => undefined),
        insertRecall: inserted,
        knownSignatures: vi.fn(async () => new Set<string>()),
        persistEvent: vi.fn(async () => true),
        recallTotals: vi.fn(async () => ({ missed: 0, expected: 0, windows: 0 })),
        creationUnseen: vi.fn(async () => 0),
        ingestCursor: vi.fn(async () => ({
          slot: 470_000_000,
          venue: "meteora",
          coverageSlot: 470_000_000,
        })),
      } as unknown as IngestRepository,
      scan: () => {
        scanned.push("scanned");
        return Promise.resolve({ matches: [], creditsCharged: 11, complete: true });
      },
    });
    expect(scanned).toEqual([]);
    expect(inserted.mock.calls.length).toBeGreaterThan(0);
    const rows = inserted.mock.calls as unknown as Array<
      [{ skipped: boolean; missed: number; errorReason: string }]
    >;
    for (const call of rows) {
      expect(call[0].skipped).toBe(true);
      expect(call[0].missed).toBe(0);
      expect(call[0].errorReason).toBe("before_coverage");
    }
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});

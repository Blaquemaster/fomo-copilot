import { describe, expect, it } from "vitest";

import {
  DBC_PROGRAM_ID,
  DBC_SCAN_INSTRUCTION_NAMES,
  DAMM_V2_PROGRAM_ID,
  PARSED_INSTRUCTION_NAMES,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  parsedNamesForProgram,
  LAUNCHLAB_PROGRAM_ID,
  programsForVenue,
  subscribedPrograms,
  enabledVenues,
  launchpadForPlatform,
  pumpTradeRetention,
  scanNamesForProgram,
  subscriptionNamesForProgram,
} from "./programs.js";
import { coverAuditWindow, planAuditWindow } from "./frameStats.js";
import { SlotGapTracker, venueStartupCursor } from "./reliability.js";

describe("scan instruction names", () => {
  it("keeps the transfer-hook name on the live subscription and off the scan", () => {
    expect(PARSED_INSTRUCTION_NAMES).toContain(
      "initialize_virtual_pool_with_token2022_transfer_hook",
    );
    expect(DBC_SCAN_INSTRUCTION_NAMES).not.toContain(
      "initialize_virtual_pool_with_token2022_transfer_hook",
    );
    expect(scanNamesForProgram(DBC_PROGRAM_ID)).toEqual([
      "initialize_virtual_pool_with_spl_token",
      "initialize_virtual_pool_with_token2022",
      "migration_damm_v2",
    ]);
    expect(parsedNamesForProgram(DBC_PROGRAM_ID)).toContain(
      "initialize_virtual_pool_with_token2022_transfer_hook",
    );
    expect(scanNamesForProgram(DAMM_V2_PROGRAM_ID)).toEqual(
      parsedNamesForProgram(DAMM_V2_PROGRAM_ID),
    );
    expect(programsForVenue("pump")).toEqual([PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID]);
    expect(
      subscribedPrograms({ venue: "pump", includeTrades: false, includeCreatePool: false }),
    ).toEqual([PUMP_PROGRAM_ID]);
    expect(programsForVenue("meteora")).toEqual([DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID]);
    expect(programsForVenue("launchlab")).toEqual([LAUNCHLAB_PROGRAM_ID]);
    expect(
      launchpadForPlatform("4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7", "launchlab").launchpad,
    ).toBe("StonkFun");
    expect(
      launchpadForPlatform("FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1", "launchlab").launchpad,
    ).toBe("BONK.fun");
    expect(
      launchpadForPlatform("4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4", "launchlab").launchpad,
    ).toBe("Raydium Launchlab");
    expect(
      launchpadForPlatform("2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69", "launchlab").launchpad,
    ).toBe("unknown");
    expect(launchpadForPlatform("not-a-known-config", "launchlab")).toEqual({
      launchpad: "unknown",
      platformConfig: "not-a-known-config",
    });
    expect(launchpadForPlatform("any-dbc-config", "meteora").launchpad).toBe("unknown");
    expect(enabledVenues({ INGEST_VENUE: "pump" })).toEqual(["pump"]);
    expect(
      enabledVenues({ INGEST_VENUE: "pump", INGEST_VENUES: "pump,launchlab,meteora" }),
    ).toEqual(["pump", "launchlab", "meteora"]);
    expect(subscriptionNamesForProgram(LAUNCHLAB_PROGRAM_ID, false)).toEqual([
      "initialize",
      "initialize_v2",
      "initialize_with_token_2022",
      "migrate_to_cpswap",
      "migrate_to_amm",
    ]);
    expect(scanNamesForProgram(LAUNCHLAB_PROGRAM_ID)).not.toContain("buy_exact_in");
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, false)).toEqual([
      "create",
      "create_v2",
      "migrate",
      "migrate_v2",
    ]);
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, true)).toContain("buy");
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, true)).toContain("sell");
    expect(scanNamesForProgram(PUMP_PROGRAM_ID)).not.toContain("buy");
    expect(subscriptionNamesForProgram(PUMP_AMM_PROGRAM_ID, false, false)).toEqual([]);
    expect(scanNamesForProgram(PUMP_AMM_PROGRAM_ID, true)).toEqual(["create_pool"]);
    expect(
      pumpTradeRetention({
        kind: "pump_create_v2",
        slot: 10,
        trader: null,
        creator: null,
        createdSlot: null,
      }),
    ).toBe("full");
    expect(
      pumpTradeRetention({
        kind: "pump_buy",
        slot: 20,
        trader: "buyer",
        creator: "creator",
        createdSlot: 10,
        detailSlots: 150,
      }),
    ).toBe("detail");
    expect(
      pumpTradeRetention({
        kind: "pump_buy",
        slot: 500,
        trader: "buyer",
        creator: "creator",
        createdSlot: 10,
        detailSlots: 150,
      }),
    ).toBe("aggregate");
    expect(
      pumpTradeRetention({
        kind: "pump_sell",
        slot: 500,
        trader: "creator",
        creator: "creator",
        createdSlot: 10,
      }),
    ).toBe("detail");
    expect(
      pumpTradeRetention({
        kind: "pump_buy",
        slot: 500,
        trader: "buyer",
        creator: null,
        createdSlot: null,
      }),
    ).toBe("skip");
  });

  it("picks the audit window from slots after coverage", () => {
    const coverageSlot = 470_000_000 - 20_000;
    const window = planAuditWindow({
      nowMs: Date.parse("2026-11-16T12:00:00.000Z"),
      tipSlot: 470_000_000,
      programId: PUMP_PROGRAM_ID,
      spanSlots: 1_000,
      coverageSlot,
    });
    expect(window.fromSlot).toBeGreaterThanOrEqual(coverageSlot);
    expect(window.toSlot - window.fromSlot).toBe(1_000);
  });

  it("skips an audit window that ends before stream coverage", () => {
    const window = { fromSlot: 100, toSlot: 200 };
    expect(coverAuditWindow({ window, coverageSlot: null })).toEqual({ action: "skip" });
    expect(coverAuditWindow({ window, coverageSlot: 250 })).toEqual({ action: "skip" });
    expect(coverAuditWindow({ window, coverageSlot: 150 })).toEqual({
      action: "scan",
      fromSlot: 150,
      toSlot: 200,
    });
    expect(coverAuditWindow({ window, coverageSlot: 50 })).toEqual({
      action: "scan",
      fromSlot: 100,
      toSlot: 200,
    });
  });

  it("drops a stale slot when the stored venue is missing or different", () => {
    expect(
      venueStartupCursor({
        persistedSlot: 1_000,
        persistedVenue: "meteora",
        currentVenue: "pump",
        tipSlot: 500_000,
        margin: 16,
      }),
    ).toEqual({ slot: null, stale: false, resetCoverage: true });
    expect(
      venueStartupCursor({
        persistedSlot: 1_000,
        persistedVenue: null,
        currentVenue: "pump",
        tipSlot: 500_000,
        margin: 16,
      }).stale,
    ).toBe(false);
    expect(
      venueStartupCursor({
        persistedSlot: 499_900,
        persistedVenue: "pump",
        currentVenue: "pump",
        tipSlot: 500_000,
        margin: 16,
      }).slot,
    ).toBe(499_900);
  });

  it("does not count a slot that arrives a few slots late as a gap", () => {
    const tracker = new SlotGapTracker(4);
    tracker.note(10);
    tracker.note(12);
    tracker.note(11);
    tracker.note(13);
    tracker.note(14);
    tracker.note(15);
    expect(tracker.slotGaps).toBe(0);
    tracker.note(20);
    expect(tracker.slotGaps).toBe(1);
  });
});

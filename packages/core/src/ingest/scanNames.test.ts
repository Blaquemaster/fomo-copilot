import { describe, expect, it } from "vitest";

import {
  DBC_PROGRAM_ID,
  DBC_SCAN_INSTRUCTION_NAMES,
  DAMM_V2_PROGRAM_ID,
  PARSED_INSTRUCTION_NAMES,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  parsedNamesForProgram,
  programsForVenue,
  pumpTradeRetention,
  scanNamesForProgram,
  subscriptionNamesForProgram,
} from "./programs.js";
import { SlotGapTracker } from "./reliability.js";

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
    expect(programsForVenue("meteora")).toContain(DBC_PROGRAM_ID);
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, false)).toEqual([
      "create",
      "create_v2",
      "migrate",
      "migrate_v2",
    ]);
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, true)).toContain("buy");
    expect(subscriptionNamesForProgram(PUMP_PROGRAM_ID, true)).toContain("sell");
    expect(scanNamesForProgram(PUMP_PROGRAM_ID)).not.toContain("buy");
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

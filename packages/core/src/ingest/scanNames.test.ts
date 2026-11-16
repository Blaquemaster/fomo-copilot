import { describe, expect, it } from "vitest";

import {
  DBC_PROGRAM_ID,
  DBC_SCAN_INSTRUCTION_NAMES,
  DAMM_V2_PROGRAM_ID,
  PARSED_INSTRUCTION_NAMES,
  parsedNamesForProgram,
  scanNamesForProgram,
} from "./programs.js";

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
  });
});

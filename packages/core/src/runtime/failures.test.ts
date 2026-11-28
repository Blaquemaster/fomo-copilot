import { describe, expect, it } from "vitest";

import { FAILURE_MAP, balanceAfterRestart } from "./failures.js";

describe("failure map", () => {
  it("stops the diagnostic at the credit ceiling and leaves the ingestor running", () => {
    expect(FAILURE_MAP.credit_ceiling.diagnostic).toBe("stopped");
    expect(FAILURE_MAP.credit_ceiling.ingestor).toBe("keeps_running");
    expect(FAILURE_MAP.entry_pause.exits).toBe("allowed");
    expect(FAILURE_MAP.signing_halt.exits).toBe("stopped");
  });

  it("keeps the stored position and reserved cash after a restart", () => {
    expect(balanceAfterRestart({ mint: "mint-a", reserved: 5 })).toEqual({
      mint: "mint-a",
      reserved: 5,
    });
  });
});

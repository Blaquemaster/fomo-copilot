import { describe, expect, it } from "vitest";

import { admitOne } from "./admission.js";

describe("strategy admission", () => {
  it("admits one signal on a mint and reserves the cash once", () => {
    const first = { mint: "mint-a", stage: "post_graduation", owner: "primary", amount: 5 };
    const second = { mint: "mint-a", stage: "second_wave", owner: "second", amount: 5 };
    const result = admitOne({ signals: [first, second], bankroll: 20, exitReserve: 5 });
    expect(result.admitted).toEqual({ signal: first, reserved: 5 });
    expect(result.rejected).toEqual([{ signal: second, reason: "not_admitted" }]);
  });

  it("keeps exit capacity out of a new entry", () => {
    const signal = { mint: "mint-a", stage: "trench", owner: "primary", amount: 16 };
    const result = admitOne({ signals: [signal], bankroll: 20, exitReserve: 5 });
    expect(result.admitted).toBeNull();
    expect(result.rejected[0]?.reason).toBe("reserved_for_exit");
  });
});

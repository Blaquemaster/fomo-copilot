import { describe, expect, it } from "vitest";

import { ExecutionLedger } from "./ledger.js";

describe("execution ledger", () => {
  it("keeps exit capacity and refuses a second authorization for one intent", () => {
    const ledger = new ExecutionLedger(20, 5);
    expect(
      ledger.reserve({
        id: "buy-1",
        mint: "mint-a",
        purpose: "entry",
        amount: 16,
        at: 1,
        mode: "open",
      }).ok,
    ).toBe(false);
    expect(
      ledger.reserve({
        id: "buy-1",
        mint: "mint-a",
        purpose: "entry",
        amount: 10,
        at: 2,
        mode: "open",
      }),
    ).toEqual({
      ok: true,
    });
    const auth = {
      intentId: "buy-1",
      txMessage: "msg",
      wallet: "wallet",
      assets: ["mint-a"],
      maxSpend: 10,
      maxFees: 1,
      expiresAt: 100,
      at: 3,
      reserved: true,
    };
    expect(ledger.authorize(auth)).toEqual({ ok: true });
    expect(ledger.authorize(auth)).toEqual({ ok: false, reason: "single_intent" });
    expect(
      ledger.matches({
        authorization: ledger.authorizations[0]!,
        txMessage: "other",
        wallet: "wallet",
        assets: ["mint-a"],
        spend: 10,
        fees: 1,
        at: 4,
      }),
    ).toBe(false);
  });

  it("holds every submission, including a caller that says live", () => {
    const ledger = new ExecutionLedger(20, 0);
    expect(ledger.submit(1, "buy-1")).toEqual({ ok: false, reason: "submission_boundary_held" });
    expect(ledger.events.at(-1)?.kind).toBe("submission_held");
  });

  it("separates an entry pause from a signing halt", () => {
    const ledger = new ExecutionLedger(20, 0);
    const paused = ledger.reserve({
      id: "buy",
      mint: "mint-a",
      purpose: "entry",
      amount: 1,
      at: 1,
      mode: "entries_paused",
    });
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.reason).toBe("entries_paused");
    expect(
      ledger.reserve({
        id: "sell",
        mint: "mint-a",
        purpose: "exit",
        amount: 1,
        at: 2,
        mode: "entries_paused",
      }),
    ).toEqual({ ok: true });
    const halted = ledger.reserve({
      id: "halt",
      mint: "mint-b",
      purpose: "exit",
      amount: 1,
      at: 3,
      mode: "signing_halt",
    });
    expect(halted.ok).toBe(false);
    if (!halted.ok) expect(halted.reason).toBe("signing_halt");
  });
});

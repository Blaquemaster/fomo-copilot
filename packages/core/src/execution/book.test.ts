import { describe, expect, it } from "vitest";

import { ExecutionBook, createTestSigner } from "./book.js";
import type { ReviewedInstruction, RouteCoverage } from "./contract.js";

const coverage: RouteCoverage = { stage: "post_graduation", buy: "available", sell: "available" };

function instruction(mint: string, amount: number): ReviewedInstruction {
  return {
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    destination: mint,
    amount,
    referencedAccounts: [mint],
  };
}

function book(switches: { entriesPaused?: boolean; signingPaused?: boolean } = {}) {
  return new ExecutionBook(
    {
      entriesPaused: switches.entriesPaused ?? false,
      exitsOnly: false,
      signingPaused: switches.signingPaused ?? false,
    },
    createTestSigner(),
    20,
  );
}

describe("execution book", () => {
  it("signs a simulated buy and records latency", () => {
    const result = book().signal({
      mint: "mint-a",
      stage: "post_graduation",
      side: "buy",
      owner: "primary",
      amount: 5,
      coverage,
      instructions: [instruction("mint-a", 5)],
      allowedAccounts: ["mint-a"],
      at: 1_000,
    });
    expect(result.state).toBe("authorized");
    expect(result.reason).toBe("submission_boundary_held");
    expect(result.signature).toBeTruthy();
    expect(result.latencyMs).toBe(0);
    expect(result.cost.platformFee).toBeNull();
  });

  it("does not buy again when the first submission is uncertain", () => {
    const orders = book();
    const first = orders.signal({
      mint: "mint-a",
      stage: "post_graduation",
      side: "buy",
      owner: "primary",
      amount: 5,
      coverage,
      instructions: [instruction("mint-a", 5)],
      allowedAccounts: ["mint-a"],
      at: 1_000,
    });
    orders.markUncertain(first.id);
    const second = orders.signal({
      mint: "mint-a",
      stage: "post_graduation",
      side: "buy",
      owner: "second_wave",
      amount: 5,
      coverage,
      instructions: [instruction("mint-a", 5)],
      allowedAccounts: ["mint-a"],
      at: 2_000,
    });
    expect(second.reason).toBe("replacement_blocked");
    expect(orders.timeout(first.id, 3_000)?.reason).toBe("timeout_is_not_a_new_buy");
    expect(orders.cashReserved).toBe(5);
  });

  it("pauses entries without blocking an exit, and a signing pause blocks both", () => {
    const paused = book({ entriesPaused: true });
    expect(
      paused.signal({
        mint: "mint-a",
        stage: "trench",
        side: "buy",
        owner: "primary",
        amount: 1,
        coverage: { ...coverage, stage: "trench" },
        instructions: [instruction("mint-a", 1)],
        allowedAccounts: ["mint-a"],
        at: 1,
      }).reason,
    ).toBe("entries_paused");
    expect(
      paused.signal({
        mint: "mint-a",
        stage: "trench",
        side: "sell",
        owner: "primary",
        amount: 1,
        coverage: { ...coverage, stage: "trench" },
        instructions: [instruction("mint-a", 1)],
        allowedAccounts: ["mint-a"],
        at: 2,
      }).state,
    ).toBe("authorized");
    expect(
      book({ signingPaused: true }).signal({
        mint: "mint-b",
        stage: "near_graduation",
        side: "sell",
        owner: "primary",
        amount: 1,
        coverage: { ...coverage, stage: "near_graduation" },
        instructions: [instruction("mint-b", 1)],
        allowedAccounts: ["mint-b"],
        at: 3,
      }).reason,
    ).toBe("signing_paused");
  });

  it("records an unavailable route instead of sizing it", () => {
    const result = book().signal({
      mint: "curve",
      stage: "trench",
      side: "buy",
      owner: "primary",
      amount: 1,
      coverage: { stage: "trench", buy: "available", sell: "unavailable" },
      instructions: [instruction("curve", 1)],
      allowedAccounts: ["curve"],
      at: 1,
    });
    expect(result.reason).toBe("route_unavailable");
    expect(result.reserved).toBe(0);
  });

  it("refuses a signer that is not a test key", () => {
    const orders = new ExecutionBook(
      { entriesPaused: false, exitsOnly: false, signingPaused: false },
      null,
      20,
    );
    expect(
      orders.signal({
        mint: "mint-a",
        stage: "post_graduation",
        side: "buy",
        owner: "primary",
        amount: 1,
        coverage,
        instructions: [instruction("mint-a", 1)],
        allowedAccounts: ["mint-a"],
        at: 1,
      }).reason,
    ).toBe("signer_refused");
  });
});

import { describe, expect, it } from "vitest";

import { collectJupiterBids } from "@fomo/core";

import { scanInstructionHistory } from "./helius.js";
import { recallProgramFromPublicRpc } from "./pumpRecall.js";

const quote = {
  mint: "So11111111111111111111111111111111111111112",
  side: "buy" as const,
  purpose: "probe" as const,
  amount: "1000000",
  which: "1x" as const,
  sizeUsd: 20,
  solPriceUsd: 100,
  priority: 1,
};

describe("diagnostic requests wait for the budget gate", () => {
  it("sends nothing when the gate refuses or the budget database throws", async () => {
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response("{}", { status: 429 });
    }) as typeof fetch;
    await scanInstructionHistory({
      apiKey: "test-key",
      programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      instructionNames: ["create"],
      slotGt: 0,
      slotLte: null,
      maxPages: 2,
      gate: async () => false,
      fetchImpl,
    });
    await recallProgramFromPublicRpc({
      programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      known: new Set(),
      gate: async () => false,
      fetchImpl,
    });
    const refused = await collectJupiterBids({
      requests: [quote],
      gate: async () => false,
      fetchImpl,
      sleep: async () => undefined,
    });
    await scanInstructionHistory({
      apiKey: "test-key",
      programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      instructionNames: ["create"],
      slotGt: 0,
      slotLte: null,
      gate: async () => {
        throw new Error("budget db down");
      },
      fetchImpl,
    });
    const thrown = await collectJupiterBids({
      requests: [quote],
      gate: async () => {
        throw new Error("budget db down");
      },
      fetchImpl,
      sleep: async () => undefined,
    });
    expect(fetches).toBe(0);
    expect(refused.requests).toBe(0);
    expect(thrown.requests).toBe(0);
  });

  it("charges a quote retry and does not send the attempt the gate refuses", async () => {
    let fetches = 0;
    let decisions = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return new Response("{}", { status: 429 });
    }) as typeof fetch;
    const result = await collectJupiterBids({
      requests: [quote],
      sleep: async () => undefined,
      fetchImpl,
      gate: async () => {
        decisions += 1;
        return decisions === 1;
      },
    });
    expect(decisions).toBe(2);
    expect(fetches).toBe(1);
    expect(result.requests).toBe(1);
  });
});

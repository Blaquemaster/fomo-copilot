import { describe, expect, it } from "vitest";

import { planCandidateWrites, tokenIsYoung } from "./apply.js";
import {
  MICROS_PER_CREDIT,
  allowanceCredits,
  budgetLevel,
  parsedEventMicros,
  projectMonthlyCredits,
  rpcCreditMicros,
  selectWsMethod,
  usageMicros,
} from "./budget.js";
import type { Observation } from "./decode.js";
import { TOKEN_MAX_AGE_MS } from "./programs.js";

describe("helius method selection", () => {
  it("defaults every plan to the filtered parsed stream", () => {
    expect(selectWsMethod("developer", "auto")).toBe("parsed");
    expect(selectWsMethod("free", "auto")).toBe("parsed");
    expect(selectWsMethod("free", "enhanced")).toBe("parsed");
    expect(selectWsMethod("developer", "standard")).toBe("parsed");
    expect(selectWsMethod("developer", "enhanced")).toBe("enhanced");
    expect(allowanceCredits("free", undefined)).toBe(1_000_000n);
    expect(allowanceCredits("developer", 25)).toBe(25n);
  });
});

describe("budget", () => {
  it("meters laserstream bytes, parsed events, and documented rpc methods", () => {
    expect(usageMicros({ streamedBytes: 1_000_000n, rpcCalls: 0, socketOpens: 0 })).toBe(
      20_000_000n,
    );
    expect(usageMicros({ streamedBytes: 100_000n, rpcCalls: 0 })).toBe(2n * MICROS_PER_CREDIT);
    expect(usageMicros({ streamedBytes: 0n, rpcCalls: 2, socketOpens: 1 })).toBe(2_000_000n);
    expect(parsedEventMicros(1)).toBe(MICROS_PER_CREDIT);
    expect(rpcCreditMicros("getTransaction")).toBe(MICROS_PER_CREDIT);
    expect(rpcCreditMicros("getSignaturesForAddress")).toBe(MICROS_PER_CREDIT);
    expect(rpcCreditMicros("getSlot")).toBe(MICROS_PER_CREDIT);
    const firehoseBytes = 1_060_000_000n;
    expect(usageMicros({ streamedBytes: firehoseBytes, rpcCalls: 0 }) / MICROS_PER_CREDIT).toBe(
      firehoseBytes / 50_000n,
    );
    const allowance = 100n;
    expect(budgetLevel(59n * 1_000_000n, allowance)).toBe("ok");
    expect(budgetLevel(60n * 1_000_000n, allowance)).toBe("warn60");
    expect(budgetLevel(80n * 1_000_000n, allowance)).toBe("warn80");
    expect(budgetLevel(90n * 1_000_000n, allowance)).toBe("pause");
    expect(projectMonthlyCredits({ creditsTodayMicros: 1_000_000n, elapsedMs: 86_400_000 })).toBe(
      "30.0",
    );
    expect(projectMonthlyCredits({ creditsTodayMicros: 1n, elapsedMs: 1_000 })).toBe("warming up");
  });
});

describe("candidate age gate", () => {
  it("keeps new DBC pools and graduations, and drops old DAMM or DLMM pools", () => {
    const now = 10_000_000;
    const init = observation({
      kind: "dbc_initialize",
      poolType: "dbc",
      mint: "mint",
      pool: "pool",
    });
    expect(
      planCandidateWrites({ observation: init, nowMs: now, earliestFirstSeenMs: null }).candidate
        ?.poolType,
    ).toBe("dbc");
    const young = observation({
      kind: "dlmm_initialize",
      poolType: "dlmm",
      mint: "mint",
      pool: "lb",
    });
    expect(
      planCandidateWrites({
        observation: young,
        nowMs: now,
        earliestFirstSeenMs: now - TOKEN_MAX_AGE_MS,
      }).candidate,
    ).not.toBeNull();
    expect(
      planCandidateWrites({
        observation: young,
        nowMs: now,
        earliestFirstSeenMs: now - TOKEN_MAX_AGE_MS - 1,
      }).candidate,
    ).toBeNull();
    expect(tokenIsYoung(null, now)).toBe(false);
    const graduation = observation({
      kind: "dbc_migration_damm_v2",
      poolType: "damm_v2",
      mint: "mint",
      pool: "damm",
      virtualPool: "dbc-pool",
    });
    const planned = planCandidateWrites({
      observation: graduation,
      nowMs: now,
      earliestFirstSeenMs: now - TOKEN_MAX_AGE_MS - 5_000,
    });
    expect(planned.candidate?.pool).toBe("damm");
    expect(planned.graduation?.virtualPool).toBe("dbc-pool");
  });
});

function observation(
  overrides: Partial<Observation> & Pick<Observation, "kind" | "poolType">,
): Observation {
  return {
    signature: "sig",
    slot: 1,
    programId: "program",
    eventIndex: 0,
    mint: overrides.mint ?? null,
    pool: overrides.pool ?? null,
    creatorWallet: null,
    virtualPool: overrides.virtualPool ?? null,
    quoteMint: null,
    blockTimeMs: null,
    ...overrides,
  };
}

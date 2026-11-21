import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  admitAutobuy,
  autobuyLimits,
  buildJupiterSwapTx,
  JUPITER_SWAP_URL,
  noopSigner,
  resolveAutobuyMode,
  simulateSwapTransaction,
} from "./run.js";
import { quoteUrlAllowed } from "../phasec/market.js";
import {
  defaultSizePct,
  protocolBody,
  protocolFingerprint,
  type PhaseCConfig,
} from "../phasec/protocol.js";
import type { ScreenRules } from "../phasec/screen.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function config(): PhaseCConfig {
  return {
    bankroll: 1_000,
    sizePct: defaultSizePct(),
    dailyLossCutoffPct: 3,
    maxConcurrent: 5,
    quietHours: "23:00-07:00",
    quietPostGradMinStrength: 0.7,
    quietPostGradMinSizePct: 2,
    exitStopPct: 25,
    entryDelaySec: 90,
    horizonMs: 60 * 60 * 1000,
    paperWindowDays: 7,
    paperMinAlerts: 100,
    paperMaxDrawdownPct: 15,
    maxPerHour: 6,
    promoteRate: 0.75,
    secondWaveMinChangePct: 20,
    marketPollMinutes: 10,
    xEnabled: false,
    destination: "test",
    fomoFeeSchedule: "solana_lowest_fee",
  };
}

const limits = autobuyLimits({});

describe("autobuy", () => {
  it("is off by default and live mode refuses without a signer and confirmation", () => {
    expect(resolveAutobuyMode({}).mode).toBe("off");
    expect(resolveAutobuyMode({ mode: "dry_run" }).mode).toBe("dry_run");
    expect(resolveAutobuyMode({ mode: "dry_run", killed: true }).mode).toBe("off");
    expect(() => resolveAutobuyMode({ mode: "live" })).toThrow(/AUTOBUY_LIVE_CONFIRMED/);
    expect(() =>
      resolveAutobuyMode({ mode: "live", liveConfirmed: true, signer: noopSigner() }),
    ).toThrow(/AUTOBUY_LIVE_CONFIRMED/);
    expect(() =>
      resolveAutobuyMode({
        mode: "live",
        liveConfirmed: true,
        signer: { publicKey: () => "Pubkey11111111111111111111111111111111111111" },
      }),
    ).toThrow(/signing is not implemented/);
    expect(readFileSync("packages/core/src/autobuy/run.ts", "utf8")).not.toMatch(
      /privateKey|secretKey|BEGIN PRIVATE/,
    );
  });

  it("enforces the paper risk limits and the hard USD caps", () => {
    expect(
      admitAutobuy({
        arm: "random_pass",
        sizeUsd: 5,
        sizePct: 0.5,
        bankroll: 1_000,
        openCount: 0,
        dailySpentUsd: 0,
        dailyLossPct: 0,
        paused: false,
        limits,
      }).ok,
    ).toBe(false);
    const ok = admitAutobuy({
      arm: "screen_only",
      sizeUsd: 5,
      sizePct: 0.5,
      bankroll: 1_000,
      openCount: 0,
      dailySpentUsd: 0,
      dailyLossPct: 0,
      paused: false,
      limits,
    });
    expect(ok).toEqual({ ok: true });
    expect(
      admitAutobuy({
        arm: "screen_only",
        sizeUsd: 30,
        sizePct: 0.5,
        bankroll: 1_000,
        openCount: 0,
        dailySpentUsd: 0,
        dailyLossPct: 0,
        paused: false,
        limits,
      }),
    ).toEqual({ ok: false, reason: "stage_cap" });
    expect(
      admitAutobuy({
        arm: "post_graduation",
        sizeUsd: 20,
        sizePct: 2,
        bankroll: 1_000,
        openCount: 5,
        dailySpentUsd: 0,
        dailyLossPct: 0,
        paused: false,
        limits,
      }),
    ).toEqual({ ok: false, reason: "max_open" });
    expect(
      admitAutobuy({
        arm: "screen_only",
        sizeUsd: 5,
        sizePct: 0.5,
        bankroll: 1_000,
        openCount: 0,
        dailySpentUsd: 0,
        dailyLossPct: 3,
        paused: true,
        limits,
      }),
    ).toEqual({ ok: false, reason: "daily_loss" });
    expect(
      admitAutobuy({
        arm: "screen_only",
        sizeUsd: 5,
        sizePct: 0.5,
        bankroll: 1_000,
        openCount: 0,
        dailySpentUsd: 98,
        dailyLossPct: 0,
        paused: false,
        limits,
      }),
    ).toEqual({ ok: false, reason: "daily_cap" });
    expect(limits.maxTradeUsd).toBe(25);
    expect(limits.dailyLossCutoffPct).toBe(3);
    expect(limits.maxConcurrent).toBe(5);
  });

  it("does not change the phase C protocol fingerprint", () => {
    const body = protocolBody(config(), rules);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(parsed)).not.toContain("autobuy");
    expect(JSON.stringify(parsed)).not.toMatch(/autobuy/i);
    expect(protocolFingerprint(body)).toBe(protocolFingerprint(protocolBody(config(), rules)));
    expect(readFileSync("packages/core/src/phasec/protocol.ts", "utf8")).not.toMatch(/autobuy/i);
  });

  it("builds an unsigned swap and does not call execute", async () => {
    expect(quoteUrlAllowed(JUPITER_SWAP_URL)).toBe(true);
    expect(quoteUrlAllowed("https://api.jup.ag/swap/v1/execute")).toBe(false);
    const urls: string[] = [];
    const built = await buildJupiterSwapTx({
      quoteResponse: { outAmount: "1" },
      userPublicKey: "Pubkey11111111111111111111111111111111111111",
      fetchImpl: (async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ swapTransaction: "AQID" }),
        };
      }) as typeof fetch,
    });
    expect(built).toEqual({ swapTransaction: "AQID" });
    expect(urls).toEqual([JUPITER_SWAP_URL]);
    const simulated = await simulateSwapTransaction({
      apiKey: "test-helius-key",
      swapTransaction: "AQID",
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: { value: { err: null } } }),
      })) as unknown as typeof fetch,
    });
    expect(simulated.ok).toBe(true);
    expect(simulated.credits).toBe(1);
  });
});

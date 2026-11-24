import type { Env } from "../config/env.js";
import type { Thresholds } from "../config/thresholds.js";
import type { ScreenRules } from "./screen.js";
import {
  EXPERIMENT_ALLOCATED_USD,
  EXPERIMENT_ENTRY_DELAY_SEC,
  EXPERIMENT_ROUND_TRIP_CAP_PCT,
  EXPERIMENT_WINDOW_DAYS,
} from "./experimentProtocol.js";
import { validateExperimentConfig } from "./review3.js";
import { defaultSizePct, type PhaseCConfig } from "./protocol.js";

export function screenRulesFromThresholds(thresholds: Thresholds): ScreenRules {
  return {
    failMintAuthority: thresholds.screen.hard_fail.mint_authority_active,
    failFreezeAuthority: thresholds.screen.hard_fail.freeze_authority_active,
    transferFeeBpsAbove: thresholds.screen.hard_fail.transfer_fee_bps_above,
    exitImpactPctAbove: thresholds.screen.hard_fail.exit_quote_impact_pct_above,
    top10FailAbove: thresholds.screen.hard_fail.top10_holders_pct_above,
    sniperFailAbove: thresholds.screen.hard_fail.sniper_bundle_pct_above,
    trenchMinTrackedBuyers: thresholds.screen.entries.trench_min_tracked_buyers,
    entryImpactPctAbove: thresholds.screen.hard_fail.entry_impact_pct_above,
    walletMaxMintsPerDay: thresholds.screen.entries.wallet_max_mints_per_day,
    walletBuyFreshMinutes: thresholds.screen.entries.wallet_buy_fresh_minutes,
    top10Warn: thresholds.screen.soft.top10_holders_pct_warn,
    sniperWarn: thresholds.screen.soft.sniper_bundle_pct_warn,
    minLiquidityUsd: thresholds.screen.soft.min_liquidity_usd,
    minMakers1h: thresholds.screen.soft.min_unique_makers_1h,
  };
}

export function phaseCConfigFromEnv(env: Env, thresholds: Thresholds): PhaseCConfig {
  const size = defaultSizePct();
  const venueAllowlist = (env.EXPERIMENT_VENUES ?? "")
    .split(",")
    .map((venue) => venue.trim())
    .filter((venue) => venue.length > 0);
  const scaleOut = env.EXPERIMENT_SCALE_OUT === "true";
  const mode = env.EXPERIMENT_MODE === "scored" ? "scored" : "shadow";
  const check = validateExperimentConfig({
    mode,
    draft: mode === "shadow",
    commit: env.EXPERIMENT_COMMIT ?? null,
    venueAllowlist,
    notionalUsd: env.EXPERIMENT_FIXED_NOTIONAL_USD ?? EXPERIMENT_ALLOCATED_USD,
    scaleOut,
    stops: false,
    walletListVersion: env.WALLET_LIST_FREEZE_AT ?? null,
  });
  return {
    bankroll: env.PAPER_BANKROLL_USD ?? env.BANKROLL ?? null,
    sizePct: {
      trench: env.SIZE_TRENCH_PCT ?? size.trench,
      near_graduation: env.SIZE_NEAR_GRADUATION_PCT ?? size.near_graduation,
      post_graduation: env.SIZE_POST_GRADUATION_PCT ?? size.post_graduation,
      second_wave: env.SIZE_SECOND_WAVE_PCT ?? size.second_wave,
    },
    dailyLossCutoffPct: env.DAILY_LOSS_CUTOFF_PCT ?? 3,
    maxConcurrent: env.MAX_CONCURRENT_POSITIONS ?? 5,
    quietHours: env.QUIET_HOURS ?? "23:00-07:00",
    quietPostGradMinStrength: env.QUIET_POST_GRAD_MIN_STRENGTH ?? 0.7,
    quietPostGradMinSizePct: env.QUIET_POST_GRAD_MIN_SIZE_PCT ?? 2,
    exitStopPct: env.EXIT_STOP_PCT ?? 25,
    entryDelaySec: env.PAPER_ENTRY_DELAY_SEC ?? EXPERIMENT_ENTRY_DELAY_SEC,
    horizonMs: 60 * 60 * 1000,
    paperWindowDays: env.PAPER_WINDOW_DAYS ?? EXPERIMENT_WINDOW_DAYS,
    paperMinAlerts: env.PAPER_MIN_ALERTS ?? 100,
    paperMaxDrawdownPct: env.PAPER_MAX_DRAWDOWN_PCT ?? 15,
    maxPerHour: thresholds.alerts.max_per_hour,
    promoteRate: env.WALLET_TIER_PROMOTE_RATE ?? 0.75,
    secondWaveMinChangePct: env.SECOND_WAVE_MIN_CHANGE_PCT ?? 20,
    marketPollMinutes: env.MARKET_POLL_MINUTES ?? 10,
    xEnabled: env.X_MENTION_SOURCE === "fixture",
    destination: env.ALERT_DESTINATION ?? "test",
    fomoFeeSchedule: env.FOMO_FEE_SCHEDULE ?? thresholds.paper.fee_schedule,
    txCostUsd: env.FOMO_TX_COST_USD ?? thresholds.paper.tx_cost_usd,
    otherMinUsd: thresholds.paper.other_min_usd,
    otherRate: thresholds.paper.other_rate,
    deadNoRouteStreak: env.DEAD_NO_ROUTE_STREAK ?? 3,
    deadNoRouteGapMs: (env.DEAD_NO_ROUTE_GAP_SEC ?? 60) * 1000,
    maxRoundTripImpactPct: EXPERIMENT_ROUND_TRIP_CAP_PCT,
    maxSizePoolShare: thresholds.screen.entries.max_size_pool_share,
    scaleOutEnabled: false,
    fixedNotionalUsd: env.EXPERIMENT_FIXED_NOTIONAL_USD ?? EXPERIMENT_ALLOCATED_USD,
    experimentProtocol: true,
    stopsEnabled: false,
    venueAllowlist,
    configRefused: check.ok ? null : check.reason,
  };
}

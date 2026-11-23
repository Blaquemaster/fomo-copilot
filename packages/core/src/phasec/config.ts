import type { Env } from "../config/env.js";
import type { Thresholds } from "../config/thresholds.js";
import type { ScreenRules } from "./screen.js";
import {
  COST_LIMIT_MODE,
  DEFAULT_MAX_ENTRY_IMPACT_PCT,
  DEFAULT_MAX_ROUND_TRIP_COST_PCT,
  DEFAULT_SCREEN_ONLY_SIZE_PCT,
  defaultSizePct,
  type PhaseCConfig,
} from "./protocol.js";

export function screenRulesFromThresholds(thresholds: Thresholds): ScreenRules {
  return {
    failMintAuthority: thresholds.screen.hard_fail.mint_authority_active,
    failFreezeAuthority: thresholds.screen.hard_fail.freeze_authority_active,
    transferFeeBpsAbove: thresholds.screen.hard_fail.transfer_fee_bps_above,
    exitImpactPctAbove: thresholds.screen.hard_fail.exit_quote_impact_pct_above,
    top10FailAbove: thresholds.screen.hard_fail.top10_holders_pct_above,
    sniperFailAbove: thresholds.screen.hard_fail.sniper_bundle_pct_above,
    trenchMinTrackedBuyers: thresholds.screen.entries.trench_min_tracked_buyers,
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
    entryDelaySec: env.PAPER_ENTRY_DELAY_SEC ?? thresholds.screen.first_screen_delay_s,
    horizonMs: 60 * 60 * 1000,
    paperWindowDays: env.PAPER_WINDOW_DAYS ?? 7,
    paperMinAlerts: env.PAPER_MIN_ALERTS ?? 100,
    paperMaxDrawdownPct: env.PAPER_MAX_DRAWDOWN_PCT ?? 15,
    maxPerHour: thresholds.alerts.max_per_hour,
    promoteRate: env.WALLET_TIER_PROMOTE_RATE ?? 0.75,
    secondWaveMinChangePct: env.SECOND_WAVE_MIN_CHANGE_PCT ?? 20,
    marketPollMinutes: env.MARKET_POLL_MINUTES ?? 10,
    xEnabled: env.X_MENTION_SOURCE === "fixture",
    destination: env.ALERT_DESTINATION ?? "test",
    fomoFeeSchedule: env.FOMO_FEE_SCHEDULE ?? "solana_lowest_fee",
    screenOnlySizePct: DEFAULT_SCREEN_ONLY_SIZE_PCT,
    maxRoundTripCostPct: DEFAULT_MAX_ROUND_TRIP_COST_PCT,
    maxEntryImpactPct: DEFAULT_MAX_ENTRY_IMPACT_PCT,
    costLimitMode: COST_LIMIT_MODE,
  };
}

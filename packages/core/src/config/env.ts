import { z } from "zod";

import { ConfigError, formatZodIssues } from "./error.js";
import { enabledVenues } from "../ingest/programs.js";

const simpleName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  POSTGRES_USER: simpleName,
  POSTGRES_PASSWORD: z.string().min(8).max(256),
  POSTGRES_DB: simpleName,
  DATABASE_URL: z.string().min(1).max(2048),
  TELEGRAM_BOT_TOKEN: z.string().min(8).max(256).optional(),
  TELEGRAM_ADMIN_CHAT_ID: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/)
    .refine((value) => {
      try {
        const asInt = BigInt(value);
        return asInt > 0n && asInt <= BigInt(Number.MAX_SAFE_INTEGER);
      } catch {
        return false;
      }
    })
    .optional(),
  HELIUS_API_KEY: z.string().min(8).max(256),
  /** Unset uses mainnet.helius-rpc.com. A CI mock may set an http origin. */
  HELIUS_HTTP_BASE: z.string().min(8).max(2048).optional(),
  /** Unset uses the Helius websocket host. A CI mock may set a ws origin. */
  HELIUS_WS_BASE: z.string().min(8).max(2048).optional(),
  /** Diagnostic hard stop. A larger value is rejected. Unset uses the code ceiling. */
  DIAGNOSTIC_MAX_HELIUS_CREDITS: z.coerce.number().int().positive().max(50_000).optional(),
  DIAGNOSTIC_MAX_JUPITER_QUOTES_PER_DAY: z.coerce.number().int().positive().max(2_000).optional(),
  DIAGNOSTIC_MAX_PUBLIC_RPC_CALLS_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .max(20_000)
    .optional(),
  /** Unset uses https://api.mainnet-beta.solana.com. A CI mock may set an http origin. */
  PUBLIC_RPC_URL: z.string().min(8).max(2048).optional(),
  /** Unset uses the public Jupiter quote URL. A CI mock may set that path on another origin. */
  JUPITER_QUOTE_BASE: z.string().min(8).max(2048).optional(),
  THRESHOLDS_PATH: z.string().min(1).max(512).optional(),
  // Developer until the owner switches this to free (planned 2026-12-07).
  HELIUS_PLAN: z.enum(["developer", "free"]).default("developer"),
  // auto: instruction-filtered parsedTransactionSubscribe on every plan.
  // enhanced is the full-program firehose and is not the default.
  HELIUS_WS_MODE: z.enum(["auto", "standard", "enhanced"]).default("auto"),
  INGEST_MODE: z.enum(["dry-run", "continuous"]).default("dry-run"),
  /** pump is the live source. meteora keeps the previous DBC/DAMM subscription. */
  INGEST_VENUE: z.enum(["pump", "meteora"]).default("pump"),
  /**
   * Comma-separated venues that run together. When set, this replaces INGEST_VENUE.
   * Example: pump,launchlab,meteora. Absent means the single INGEST_VENUE.
   */
  INGEST_VENUES: z.string().max(128).optional(),
  /**
   * Buy and sell subscriptions are a firehose. Off by default so a deploy does not
   * spend the monthly credit allowance on every Pump.fun trade.
   */
  PUMP_SUBSCRIBE_TRADES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * PumpSwap create_pool outside a Pump migrate is mostly non-Pump.fun or copycat
   * pools. Off by default. A create_pool inside a migrate transaction is still decoded.
   */
  PUMP_SUBSCRIBE_CREATE_POOL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Slots after create during which each trade is stored, not only counted. */
  PUMP_TRADE_DETAIL_SLOTS: z.coerce.number().int().min(0).max(10_000).default(150),
  HELIUS_MONTHLY_CREDITS: z.coerce.number().int().positive().max(1_000_000_000).optional(),
  /** Slots kept behind the last live slot when backfill decides it has caught up. */
  BACKFILL_SLOT_MARGIN: z.coerce.number().int().min(0).max(10_000).default(16),
  /**
   * BNB Chain websocket for Flap. The default is a public keyless endpoint.
   * A keyed provider URL is still redacted.
   */
  BSC_WSS_URL: z.string().min(8).max(2048).default("wss://bsc-rpc.publicnode.com"),
  /** Proven wallets on the live subscription. Default 300. */
  WALLET_MAX_WALLETS: z.coerce.number().int().min(1).max(1_000).optional(),
  /** Hard share of the monthly Helius allowance for wallet subscriptions. Default 25. */
  WALLET_CREDIT_BUDGET_PCT: z.coerce.number().int().min(1).max(100).optional(),
  /** fixture reads the repo sample. off stores nothing. Live search stays on the bot. */
  X_MENTION_SOURCE: z.enum(["fixture", "off"]).optional(),
  /** Non-creator buys to keep from the start of each mint. Default 50. */
  WALLET_BACKFILL_BUYS: z.coerce.number().int().min(1).max(500).optional(),
  /** Early-buyer backfill credits per calendar month. Default 600000. */
  WALLET_BACKFILL_CREDIT_CAP: z.coerce.number().int().min(1).max(100_000_000).optional(),
  /** Early-buyer backfill credits per run. Default 3300. */
  WALLET_BACKFILL_RUN_CREDITS: z.coerce.number().int().min(1).max(100_000_000).optional(),
  /** Share of the live wallet list that a daily refresh may replace. Default 20. */
  WALLET_CHURN_PCT: z.coerce.number().int().min(0).max(100).optional(),
  /** Hours between early-buyer backfill and wallet-list refresh. Default 4. */
  WALLET_REFRESH_HOURS: z.coerce.number().int().min(1).max(168).optional(),
  /** Minutes before a non-graduated Pump or LaunchLab coin counts as a loss. Default 120. */
  WALLET_LOSS_AGE_MINUTES: z.coerce.number().int().min(1).max(10_080).optional(),
  /** Minutes before a non-graduated Meteora DBC coin counts as a loss. Default 60. */
  WALLET_LOSS_AGE_METEORA_MINUTES: z.coerce.number().int().min(1).max(10_080).optional(),
  /** Covered early buys required before a wallet can join the proven list. Default 5. */
  WALLET_MIN_ENTRIES: z.coerce.number().int().min(1).max(1_000).optional(),
  /** How many of those entries must be on coins that did not graduate. Default 1. */
  WALLET_MIN_LOSSES: z.coerce.number().int().min(0).max(1_000).optional(),
  /** Lowest shrunk hit rate that can join the proven list. Default 0.6. */
  WALLET_MIN_SHRUNK_RATE: z.coerce.number().min(0).max(1).optional(),
  /** More covered buys than this is treated as a bot and left off the list. Default 80. */
  WALLET_BOT_MAX_ENTRIES: z.coerce.number().int().min(1).max(100_000).optional(),
  /** Consecutive history failures before a mint is skipped. Default 5. */
  WALLET_BACKFILL_FAIL_LIMIT: z.coerce.number().int().min(1).max(100).optional(),
  /** Dollar bankroll. Unset means alerts show the size percent only. */
  BANKROLL: z.coerce.number().positive().max(1_000_000_000).optional(),
  /** Paper bankroll in USD. Deploy default 1000. */
  PAPER_BANKROLL_USD: z.coerce.number().positive().max(1_000_000_000).optional(),
  SIZE_TRENCH_PCT: z.coerce.number().min(0).max(100).optional(),
  SIZE_NEAR_GRADUATION_PCT: z.coerce.number().min(0).max(100).optional(),
  SIZE_POST_GRADUATION_PCT: z.coerce.number().min(0).max(100).optional(),
  SIZE_SECOND_WAVE_PCT: z.coerce.number().min(0).max(100).optional(),
  /** Paper loss, as a percent of bankroll, that pauses alerts until the next ET day. Default 3. */
  DAILY_LOSS_CUTOFF_PCT: z.coerce.number().min(0).max(100).optional(),
  MAX_CONCURRENT_POSITIONS: z.coerce.number().int().min(1).max(100).optional(),
  QUIET_HOURS: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  QUIET_POST_GRAD_MIN_STRENGTH: z.coerce.number().min(0).max(1).optional(),
  QUIET_POST_GRAD_MIN_SIZE_PCT: z.coerce.number().min(0).max(100).optional(),
  /** test until go-live. admin is the switch that may use the admin chat. */
  ALERT_DESTINATION: z.enum(["test", "admin"]).optional(),
  TELEGRAM_TEST_CHAT_ID: z
    .string()
    .trim()
    .regex(/^-?[1-9]\d*$/)
    .optional(),
  /** Minutes between DexScreener and GeckoTerminal polls. Default 10, allowed 5 to 15. */
  MARKET_POLL_MINUTES: z.coerce.number().int().min(5).max(15).optional(),
  SECOND_WAVE_SOURCE: z.enum(["live", "fixture"]).optional(),
  /** Optional. Raises the Jupiter quote budget from 30 to 60 requests a minute. */
  JUPITER_API_KEY: z.string().min(8).max(256).optional(),
  WALLET_TIER_PROMOTE_RATE: z.coerce.number().min(0).max(1).optional(),
  EXIT_STOP_PCT: z.coerce.number().min(0).max(100).optional(),
  PAPER_MIN_ALERTS: z.coerce.number().int().min(1).max(1_000_000).optional(),
  PAPER_MAX_DRAWDOWN_PCT: z.coerce.number().min(0).max(100).optional(),
  PAPER_WINDOW_DAYS: z.coerce.number().int().min(1).max(365).optional(),
  PAPER_ENTRY_DELAY_SEC: z.coerce.number().int().min(0).max(86_400).optional(),
  FOMO_FEE_SCHEDULE: z.enum(["solana_lowest_fee", "solana_other", "fixed_usd"]).optional(),
  /** Fixed dollars per transaction when FOMO_FEE_SCHEDULE is fixed_usd. */
  FOMO_TX_COST_USD: z.coerce.number().nonnegative().max(1000).optional(),
  /** True no-route answers required before a dead -100% close. Default 3. */
  DEAD_NO_ROUTE_STREAK: z.coerce.number().int().min(1).max(20).optional(),
  /** Minimum seconds between those answers. Default 60. */
  DEAD_NO_ROUTE_GAP_SEC: z.coerce.number().int().min(1).max(86_400).optional(),
  WALLET_SCORE_CUTOFF: z.string().datetime().optional(),
  /** true freezes the tracked list. Unset is frozen for the test window. "false" allows v3. */
  WALLET_LIST_FROZEN: z.enum(["true", "false"]).optional(),
  /** Active tracked_wallet rows selected after this time do not count. */
  WALLET_LIST_FREEZE_AT: z.string().datetime().optional(),
  SECOND_WAVE_MIN_CHANGE_PCT: z.coerce.number().min(0).max(10_000).optional(),
  /**
   * Screener paper loop. Unset or anything other than "true" means the process
   * exits without screening, quoting, or sending an alert.
   */
  PAPER_ENABLED: z.enum(["true", "false"]).optional(),
  /**
   * Alerter long-poll. Unset or anything other than "true" means the process
   * exits without polling Telegram.
   */
  ALERTS_ENABLED: z.enum(["true", "false"]).optional(),
  /** Outcome worker. Unset means the process exits without quoting. */
  OUTCOMES_ENABLED: z.enum(["true", "false"]).optional(),
  /** Collection-only shadow. Unset means the process exits without reading returns. */
  SHADOW_ENABLED: z.enum(["true", "false"]).optional(),
  /**
   * Pages public-RPC signatures for a gap wider than 600 slots. Unset keeps the
   * old unrecovered gap. This does not start by itself.
   */
  INGEST_WIDE_RECOVERY: z.enum(["true", "false"]).optional(),
  /** Exact true is refused. Scale-out is not part of this experiment. */
  EXPERIMENT_SCALE_OUT: z.enum(["true", "false"]).optional(),
  /** shadow is the draft. scored refuses until commit, venue, and wallet list are set. */
  EXPERIMENT_MODE: z.enum(["shadow", "scored"]).optional(),
  EXPERIMENT_COMMIT: z.string().min(7).max(64).optional(),
  /** Comma-separated venues that have passed an independent recall. Empty means none. */
  EXPERIMENT_VENUES: z.string().max(200).optional(),
  /** One dollar size for every stage. Unset keeps the stage table. */
  EXPERIMENT_FIXED_NOTIONAL_USD: z.coerce.number().positive().max(1_000_000).optional(),
  /** off, dry_run, or live. Default off. Live cannot start in this build. */
  AUTOBUY_MODE: z.enum(["off", "dry_run", "live"]).optional(),
  /** Must be the exact word yes, and a signer must exist. Neither is configured here. */
  AUTOBUY_LIVE_CONFIRMED: z.literal("yes").optional(),
  AUTOBUY_KILL: z.enum(["off", "on"]).optional(),
  AUTOBUY_MAX_TRADE_USD: z.coerce.number().positive().max(1_000_000_000).optional(),
  AUTOBUY_DAILY_USD_CAP: z.coerce.number().positive().max(1_000_000_000).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Public keyless BSC endpoint. Deploy writes this unless an override is set. */
export const PUBLIC_BSC_WSS_URL = "wss://bsc-rpc.publicnode.com";

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
}

function assertDatabaseUrl(env: Env): void {
  let parsed: URL;
  try {
    parsed = new URL(env.DATABASE_URL);
  } catch {
    throw new ConfigError("DATABASE_URL: invalid_url");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL: invalid_protocol");
  }
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new ConfigError("DATABASE_URL: invalid_encoding");
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || username.length === 0 || password.length === 0 || database.length === 0) {
    throw new ConfigError("DATABASE_URL: missing_parts");
  }
  if (username !== env.POSTGRES_USER) {
    throw new ConfigError("DATABASE_URL: user_mismatch");
  }
  if (password !== env.POSTGRES_PASSWORD) {
    throw new ConfigError("DATABASE_URL: password_mismatch");
  }
  if (database !== env.POSTGRES_DB) {
    throw new ConfigError("DATABASE_URL: database_mismatch");
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(blankToUndefined(source));
  if (!parsed.success) {
    throw new ConfigError(`env: ${formatZodIssues(parsed.error)}`);
  }
  if (parsed.data.TELEGRAM_BOT_TOKEN && /\s/.test(parsed.data.TELEGRAM_BOT_TOKEN)) {
    throw new ConfigError("env: TELEGRAM_BOT_TOKEN: invalid_token");
  }
  assertDatabaseUrl(parsed.data);
  enabledVenues(parsed.data);
  if (parsed.data.BSC_WSS_URL && !/^wss?:\/\//.test(parsed.data.BSC_WSS_URL)) {
    throw new ConfigError("BSC_WSS_URL: invalid_protocol");
  }
  return parsed.data;
}

/** Values that must never appear in logs or crash alerts. Longest first. */
export function secretValuesFromEnv(env: Env): string[] {
  const values = [env.HELIUS_API_KEY, env.POSTGRES_PASSWORD];
  if (env.TELEGRAM_BOT_TOKEN) values.push(env.TELEGRAM_BOT_TOKEN);
  if (env.JUPITER_API_KEY) values.push(env.JUPITER_API_KEY);
  if (env.BSC_WSS_URL && !env.BSC_WSS_URL.includes("bsc-rpc.publicnode.com")) {
    values.push(env.BSC_WSS_URL);
  }
  try {
    const password = decodeURIComponent(new URL(env.DATABASE_URL).password);
    values.push(password);
  } catch {
    // loadEnv already rejected a bad URL. Ignore if a caller passes a partial env.
  }
  const expanded = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length < 8) continue;
    expanded.add(trimmed);
    const encoded = encodeURIComponent(trimmed);
    if (encoded.length >= 8) expanded.add(encoded);
  }
  return [...expanded].sort((left, right) => right.length - left.length);
}

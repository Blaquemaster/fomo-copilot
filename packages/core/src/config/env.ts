import { z } from "zod";

import { ConfigError, formatZodIssues } from "./error.js";

const simpleName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  POSTGRES_USER: simpleName,
  POSTGRES_PASSWORD: z.string().min(8).max(256),
  POSTGRES_DB: simpleName,
  DATABASE_URL: z.string().min(1).max(2048),
  TELEGRAM_BOT_TOKEN: z.string().min(8).max(256),
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
    }),
  HELIUS_API_KEY: z.string().min(8).max(256),
  THRESHOLDS_PATH: z.string().min(1).max(512).optional(),
  // Developer until the owner switches this to free (planned 2026-12-07).
  HELIUS_PLAN: z.enum(["developer", "free"]).default("developer"),
  // auto: instruction-filtered parsedTransactionSubscribe on every plan.
  // enhanced is the full-program firehose and is not the default.
  HELIUS_WS_MODE: z.enum(["auto", "standard", "enhanced"]).default("auto"),
  INGEST_MODE: z.enum(["dry-run", "continuous"]).default("dry-run"),
  HELIUS_MONTHLY_CREDITS: z.coerce.number().int().positive().max(1_000_000_000).optional(),
  /** Slots kept behind the last live slot when backfill decides it has caught up. */
  BACKFILL_SLOT_MARGIN: z.coerce.number().int().min(0).max(10_000).default(16),
});

export type Env = z.infer<typeof envSchema>;

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
  if (/\s/.test(parsed.data.TELEGRAM_BOT_TOKEN)) {
    throw new ConfigError("env: TELEGRAM_BOT_TOKEN: invalid_token");
  }
  assertDatabaseUrl(parsed.data);
  return parsed.data;
}

/** Values that must never appear in logs or crash alerts. Longest first. */
export function secretValuesFromEnv(env: Env): string[] {
  const values = [env.TELEGRAM_BOT_TOKEN, env.HELIUS_API_KEY, env.POSTGRES_PASSWORD];
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

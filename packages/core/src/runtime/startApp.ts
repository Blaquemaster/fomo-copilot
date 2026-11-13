import { hostname } from "node:os";
import path from "node:path";

import { loadEnv, secretValuesFromEnv, type Env } from "../config/env.js";
import { loadThresholds, type Thresholds } from "../config/thresholds.js";
import { createLogger, type Logger } from "../log/logger.js";
import type { CrashKind } from "../telegram/crashAlert.js";
import { deliverCrashAlert } from "./reportCrash.js";

export interface AppContext {
  env: Env;
  thresholds: Thresholds;
  logger: Logger;
}

function writeConfigError(error: unknown): void {
  const message = error instanceof Error ? error.message : "invalid configuration";
  process.stderr.write(`configuration error: ${message}\n`);
}

export async function startApp(options: {
  app: string;
  run: (ctx: AppContext) => Promise<void>;
}): Promise<void> {
  let env: Env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    writeConfigError(error);
    process.exit(1);
  }

  const thresholdsPath =
    env.THRESHOLDS_PATH ?? path.resolve(process.cwd(), "config/thresholds.yaml");
  let thresholds: Thresholds;
  try {
    thresholds = loadThresholds(thresholdsPath);
  } catch (error) {
    writeConfigError(error);
    process.exit(1);
  }

  const secrets = secretValuesFromEnv(env);
  const logger = createLogger({ level: env.LOG_LEVEL, app: options.app, secrets });

  const crash = (kind: CrashKind, error: unknown, fatal: boolean): Promise<void> =>
    deliverCrashAlert({
      app: options.app,
      kind,
      error,
      token: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_ADMIN_CHAT_ID,
      secrets,
      logger,
      fatal,
      host: hostname(),
    });

  process.on("uncaughtException", (error) => {
    void crash("uncaughtException", error, true).finally(() => {
      process.exit(1);
    });
  });
  process.on("unhandledRejection", (reason) => {
    void crash("unhandledRejection", reason, true).finally(() => {
      process.exit(1);
    });
  });

  logger.info({ phase: 0 }, "starting");
  try {
    await options.run({ env, thresholds, logger });
  } catch (error) {
    const kind: CrashKind = process.argv.includes("--crash-test")
      ? "crash_test"
      : "uncaughtException";
    await crash(kind, error, true);
    process.exit(1);
  }
}

import {
  createPool,
  migrate,
  PhaseCRepository,
  resolveAlertChat,
  sendTelegramMessage,
  startApp,
} from "@fomo/core";

import { runPhaseCCycle } from "./cycle.js";
import { loadMarketQuotes, pollDue, type QuoteUsage } from "./quotes.js";

const PASS_MS = 60_000;

await startApp({
  app: "screener",
  run: async ({ env, thresholds, logger }) => {
    if (process.argv.includes("--crash-test")) {
      throw new Error("intentional crash test");
    }
    const pool = createPool(env.DATABASE_URL);
    const store = new PhaseCRepository(pool);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      await migrate(pool);
      let quotes: Awaited<ReturnType<typeof loadMarketQuotes>>["quotes"] = [];
      let lastPollAt: number | null = null;
      let dexBucket: Awaited<ReturnType<typeof loadMarketQuotes>>["dexBucket"] | undefined;
      let geckoBucket: Awaited<ReturnType<typeof loadMarketQuotes>>["geckoBucket"] | undefined;
      logger.info(
        {
          destination: env.ALERT_DESTINATION ?? "test",
          secondWave: env.SECOND_WAVE_SOURCE ?? "live",
        },
        "phase C screener started",
      );
      while (!controller.signal.aborted) {
        const started = Date.now();
        try {
          const source = env.SECOND_WAVE_SOURCE ?? "live";
          const pollMinutes = env.MARKET_POLL_MINUTES ?? 10;
          if (pollDue(lastPollAt, Date.now(), pollMinutes)) {
            const mints = source === "live" ? await store.graduatedMints(5_000) : [];
            const loaded = await loadMarketQuotes({ source, mints, dexBucket, geckoBucket });
            quotes = loaded.quotes;
            dexBucket = loaded.dexBucket;
            geckoBucket = loaded.geckoBucket;
            lastPollAt = Date.now();
            const usage: QuoteUsage = loaded.usage;
            logger.info({ ...usage }, "quote poll");
          }
          const destination = resolveAlertChat({
            destination: env.ALERT_DESTINATION ?? "test",
            testChatId: env.TELEGRAM_TEST_CHAT_ID ?? null,
            adminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
          });
          await runPhaseCCycle({
            now: new Date(),
            env,
            thresholds,
            store,
            quotes,
            send: async (text) => {
              if ("blocked" in destination) return;
              await sendTelegramMessage({
                token: env.TELEGRAM_BOT_TOKEN,
                chatId: destination.chatId,
                text,
              });
            },
            warn: (message) => logger.warn(message),
          });
        } catch (error) {
          logger.error({ err: error }, "phase C pass failed");
        }
        const wait = Math.max(0, PASS_MS - (Date.now() - started));
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    } finally {
      await pool.end();
    }
  },
});

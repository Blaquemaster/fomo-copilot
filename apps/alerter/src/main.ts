import { hostname } from "node:os";

import { deliverCrashAlert, secretValuesFromEnv, startApp } from "@fomo/core";
import { Bot } from "grammy";

import { handleTelegramMessage } from "./commands.js";

await startApp({
  app: "alerter",
  run: async ({ env, logger }) => {
    if (process.argv.includes("--crash-test")) {
      throw new Error("intentional crash test");
    }

    const secrets = secretValuesFromEnv(env);
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
      client: {
        // Longer than the 30s long poll, shorter than grammY's 500s default,
        // so a dead network fails instead of leaving the process hung.
        timeoutSeconds: 60,
      },
    });

    bot.use(async (ctx) => {
      const result = await handleTelegramMessage({
        chatId: ctx.chat?.id,
        text: ctx.message?.text,
        adminChatId: env.TELEGRAM_ADMIN_CHAT_ID,
        reply: async (text) => {
          await ctx.reply(text);
        },
        crash: async (error) => {
          await deliverCrashAlert({
            app: "alerter",
            kind: "crash_test",
            error,
            token: env.TELEGRAM_BOT_TOKEN,
            chatId: env.TELEGRAM_ADMIN_CHAT_ID,
            secrets,
            logger,
            fatal: true,
            host: hostname(),
          });
          process.exit(1);
        },
      });
      if (result.action === "ignore") {
        logger.info({ reason: result.reason }, "ignored telegram update");
      }
    });

    bot.catch((botError) => {
      logger.error({ err: botError }, "telegram handler error");
      void deliverCrashAlert({
        app: "alerter",
        kind: "handler",
        error: botError,
        token: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_ADMIN_CHAT_ID,
        secrets,
        logger,
        fatal: false,
        host: hostname(),
      }).catch((error: unknown) => {
        logger.error({ err: error }, "crash alert delivery failed");
      });
    });

    logger.info("contacting Telegram");
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    logger.info("telegram transport is long polling; no webhook and no inbound port");
    await bot.start({
      allowed_updates: ["message"],
      drop_pending_updates: true,
      onStart: (info) => {
        logger.info({ username: info.username }, "alerter long polling started");
      },
    });
  },
});

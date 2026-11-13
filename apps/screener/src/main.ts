import { keepAliveUntilSignal, startApp } from "@fomo/core";

await startApp({
  app: "screener",
  run: async ({ logger }) => {
    logger.info({ phase: 0 }, "placeholder only; screening is not part of Phase 0");
    if (process.argv.includes("--crash-test")) {
      throw new Error("intentional crash test");
    }
    await keepAliveUntilSignal(logger);
  },
});

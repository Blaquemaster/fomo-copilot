import { keepAliveUntilSignal, startApp } from "@fomo/core";

await startApp({
  app: "ingestor",
  run: async ({ logger }) => {
    logger.info(
      { phase: 0, helius: "not-connected" },
      "placeholder only; Helius ingest is not part of Phase 0",
    );
    if (process.argv.includes("--crash-test")) {
      throw new Error("intentional crash test");
    }
    await keepAliveUntilSignal(logger);
  },
});

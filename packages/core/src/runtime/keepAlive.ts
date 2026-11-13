import type { Logger } from "../log/logger.js";

const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Holds the event loop open until SIGINT or SIGTERM.
 * A pending Promise alone does not keep Node running.
 */
export function keepAliveUntilSignal(logger: Logger): Promise<void> {
  const timer = setInterval(() => {
    logger.info({ heartbeat: true }, "alive");
  }, HEARTBEAT_MS);

  return new Promise((resolve) => {
    const stop = (signal: string) => {
      clearInterval(timer);
      logger.info({ signal }, "shutting down");
      resolve();
    };
    process.once("SIGINT", () => {
      stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      stop("SIGTERM");
    });
  });
}

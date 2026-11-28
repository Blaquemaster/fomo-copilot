import {
  createPool,
  dashboardShouldListen,
  readOwnerSnapshot,
  startApp,
  startDashboardServer,
} from "@fomo/core";

await startApp({
  app: "dashboard",
  run: async ({ env, logger }) => {
    const flag = process.env["DASHBOARD_ENABLED"];
    if (!dashboardShouldListen(flag)) {
      logger.warn({ dashboardEnabled: flag ?? "unset" }, "dashboard stayed stopped");
      return;
    }
    const token = process.env["DASHBOARD_TOKEN"] ?? "";
    if (!token) {
      logger.warn("dashboard stayed stopped: DASHBOARD_TOKEN is unset");
      return;
    }
    const releaseSha = process.env["DASHBOARD_RELEASE_SHA"] ?? null;
    const pool = createPool(env.DATABASE_URL);
    try {
      const server = await startDashboardServer({
        token,
        host: "127.0.0.1",
        port: Number(process.env["DASHBOARD_PORT"] ?? 8787),
        load: (authorization) =>
          readOwnerSnapshot(pool, {
            token,
            authorization,
            now: new Date(),
            staleAfterMs: 60_000,
            releaseSha,
          }).then((snapshot) => snapshot.request),
      });
      logger.info({ url: server.url, tradingControl: "absent" }, "owner dashboard listening");
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
      });
      await server.close();
    } finally {
      await pool.end();
    }
  },
});

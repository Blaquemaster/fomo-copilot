import { describe, expect, it } from "vitest";

import { IngestRepository, createPool, migrate } from "../db/ingest.js";
import { classifyMovement } from "../ingest/walletIntelligence.js";
import { runSimulatedWorkflow } from "../workflow/run.js";
import { readOwnerSnapshot } from "./records.js";
import { dashboardShouldListen, startDashboardServer } from "./server.js";
import type { DashboardRequest } from "./view.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

/** A separate database so this migration does not lock the shared test database. */
async function isolatedPool(baseUrl: string) {
  const admin = createPool(baseUrl);
  const name = "fomo_owner_dash";
  try {
    const existing = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return createPool(url.toString());
}

describe("owner dashboard server", () => {
  it("stays stopped unless the flag is the word true", () => {
    expect(dashboardShouldListen(undefined)).toBe(false);
    expect(dashboardShouldListen("TRUE")).toBe(false);
    expect(dashboardShouldListen("true")).toBe(true);
  });

  it("rejects a missing session and does not expose the token or a trading route", async () => {
    const token = "owner-token-secret";
    const server = await startDashboardServer({
      token,
      load: async (authorization) =>
        ({
          token,
          authorization,
          now: new Date(),
          observedAt: null,
          staleAfterMs: 60_000,
          services: [],
          feeds: [{ name: "pump", gap: true }],
          decisions: [],
          positions: [],
          spend: null,
          releaseSha: "abc123",
        }) satisfies DashboardRequest,
    });
    try {
      const denied = await fetch(`${server.url}/api/view`);
      expect(denied.status).toBe(401);
      const form = await fetch(`${server.url}/`);
      expect(form.status).toBe(200);
      const html = await form.text();
      expect(html).toContain("Owner view");
      expect(html).not.toContain(token);
      const login = await fetch(`${server.url}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      expect(login.status).toBe(200);
      expect(await login.text()).not.toContain(token);
      const cookie = login.headers.get("set-cookie") ?? "";
      const session = cookie.split(";")[0] ?? "";
      const trading = await fetch(`${server.url}/enable-trading`, {
        method: "POST",
        headers: { cookie: session },
      });
      expect(trading.status).toBe(404);
      const view = await fetch(`${server.url}/api/view`, {
        headers: { cookie: session },
      });
      const body = await view.text();
      expect(view.status).toBe(200);
      expect(body).toContain("abc123");
      expect(body).toContain("absent");
      expect(body).not.toContain(token);
      const page = await fetch(`${server.url}/`, {
        headers: { cookie: cookie.split(";")[0] ?? "" },
      });
      expect(await page.text()).not.toContain(token);
    } finally {
      await server.close();
    }
  });
});

describe.skipIf(!databaseUrl)("owner dashboard records", () => {
  it("reads a simulated workflow from the database, with other services stopped", async () => {
    const pool = await isolatedPool(databaseUrl ?? "");
    const token = "db-owner-token";
    try {
      await migrate(pool);
      const now = new Date();
      const run = await runSimulatedWorkflow(pool, {
        runId: `run-${now.getTime()}`,
        mint: `mint-${now.getTime()}`,
        signature: `sig-${now.getTime()}`,
        wallet: "wallet-a",
        amount: 5,
        now,
        releaseSha: "release-sha",
        buy: "available",
        sell: "available",
        jupiterNet: null,
      });
      const server = await startDashboardServer({
        token,
        load: (authorization) =>
          readOwnerSnapshot(pool, {
            token,
            authorization,
            now,
            staleAfterMs: 60_000,
            releaseSha: "release-sha",
          }).then((snapshot) => snapshot.request),
      });
      try {
        const view = await fetch(`${server.url}/api/view`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await view.json()) as {
          release: string;
          services: { name: string; mode: string }[];
          positions: { mint: string; reserved: number }[];
          tradingControl: string;
        };
        expect(body.release).toBe("release-sha");
        expect(body.services.find((row) => row.name === "screener")?.mode).toBe("stopped");
        expect(body.services.find((row) => row.name === "alerter")?.mode).toBe("stopped");
        expect(body.positions.some((row) => row.mint === run.mint)).toBe(true);
        expect(body.tradingControl).toBe("absent");
        expect(JSON.stringify(body)).not.toContain(token);
        expect(run.executionState).toBe("authorized");
        expect(run.decision).toBe("ready");
        const repo = new IngestRepository(pool);
        await repo.saveOwnerWalletRecords({
          recordedAt: now,
          measures: [],
          movements: [
            "buy",
            "transferChecked",
            "syncNative",
            "collectFee",
            "createAccount",
            "mysteryOp",
          ].map((instructionName) => ({
            instructionName,
            class: classifyMovement(instructionName),
          })),
          evidence: [],
          funding: [
            { funder: "funder-1", wallet: "wallet-a" },
            { funder: "funder-1", wallet: "wallet-b" },
          ],
        });
        const classes = await pool.query<{ class: string }>(
          "select distinct class from wallet_movement order by class",
        );
        expect(classes.rows.map((row) => row.class)).toEqual([
          "account",
          "fee",
          "swap",
          "transfer",
          "unclassified",
          "wrapped_sol",
        ]);
        const funding = await pool.query<{ common_control: boolean }>(
          "select common_control from wallet_shared_funding where funder = 'funder-1'",
        );
        expect(funding.rows.length).toBe(2);
        expect(funding.rows.every((row) => row.common_control === false)).toBe(true);
      } finally {
        await server.close();
      }
    } finally {
      await pool.end();
    }
  });
});

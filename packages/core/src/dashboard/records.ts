import type pg from "pg";

import type { DashboardRequest } from "./view.js";

const KNOWN_SERVICES = ["ingestor", "screener", "alerter", "dashboard"] as const;

export interface OwnerSnapshot {
  request: DashboardRequest;
  workflowRunIds: string[];
}

/** Selects only. The owner process does not insert, update, or delete. */
export async function readOwnerSnapshot(
  pool: pg.Pool,
  input: {
    token: string;
    authorization: string | undefined;
    now: Date;
    staleAfterMs: number;
    releaseSha: string | null;
  },
): Promise<OwnerSnapshot> {
  const services = await pool.query<{ name: string; mode: string; observed_at: Date | null }>(
    "select name, mode, observed_at from owner_service",
  );
  const byName = new Map(services.rows.map((row) => [row.name, row]));
  const serviceRows = KNOWN_SERVICES.map((name) => {
    const row = byName.get(name);
    const observed = row?.observed_at ?? null;
    const fresh =
      observed !== null && input.now.getTime() - observed.getTime() <= input.staleAfterMs;
    const mode = name === "dashboard" ? "dry_run" : !row || !fresh ? "stopped" : row.mode;
    return { name, mode };
  });
  const feeds = await pool.query<{ name: string; gap: boolean; observed_at: Date | null }>(
    "select name, gap, observed_at from owner_feed",
  );
  const decisions = await pool.query<{ id: string; readiness: string; detail: string | null }>(
    `select run_id as id, state as readiness, detail
     from workflow_step
     where step = 'decision'
     order by recorded_at desc
     limit 20`,
  );
  const positions = await pool.query<{ mint: string; reserved: number }>(
    "select mint, reserved from owner_position order by mint",
  );
  const spend = await readSpend(pool);
  const evidence = await pool.query<{ wallet: string; concentration: number | null }>(
    "select wallet, concentration from wallet_evidence_report order by wallet limit 20",
  );
  const runs = await pool.query<{ run_id: string }>(
    "select distinct run_id from workflow_step order by run_id limit 20",
  );
  const observedAt = latest(
    services.rows.map((row) => row.observed_at),
    feeds.rows.map((row) => row.observed_at),
  );
  return {
    workflowRunIds: runs.rows.map((row) => row.run_id),
    request: {
      token: input.token,
      authorization: input.authorization,
      now: input.now,
      observedAt,
      staleAfterMs: input.staleAfterMs,
      releaseSha: input.releaseSha,
      services: serviceRows,
      feeds: feeds.rows.map((row) => ({ name: row.name, gap: row.gap })),
      decisions: decisions.rows.map((row) => ({
        id: row.id,
        readiness: row.readiness === "ready" ? "ready" : "unavailable",
        reason: row.detail,
      })),
      positions: positions.rows.map((row) => ({ mint: row.mint, reserved: Number(row.reserved) })),
      spend,
      walletEvidence: evidence.rows.map((row) => ({
        wallet: row.wallet,
        concentration: row.concentration === null ? null : Number(row.concentration),
      })),
      strategyLimits: { bankroll: 20, exitReserve: 5 },
    },
  };
}

async function readSpend(pool: pg.Pool): Promise<{ diagnosticRemaining: number | null } | null> {
  try {
    const result = await pool.query<{ spent: string | null }>(
      "select coalesce(sum(helius_credits), 0)::text as spent from diagnostic_spend",
    );
    const spent = Number(result.rows[0]?.spent ?? "0");
    if (!Number.isFinite(spent)) return null;
    return { diagnosticRemaining: Math.max(0, 50_000 - spent) };
  } catch {
    return null;
  }
}

function latest(...groups: (Date | null)[][]): Date | null {
  let best: Date | null = null;
  for (const group of groups) {
    for (const value of group) {
      if (value !== null && (best === null || value.getTime() > best.getTime())) best = value;
    }
  }
  return best;
}

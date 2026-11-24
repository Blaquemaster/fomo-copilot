import type { Pool } from "pg";

import { rpcCredits } from "../ingest/budget.js";
import { DIAGNOSTIC_BUDGET } from "./diagnosticSpec.js";

/** The 50,000 Helius credits count diagnostic additions only, not the running ingestor. */
export const DIAGNOSTIC_ALLOWANCE = "diagnostic_additions_only" as const;

/** $5 per million Helius credits is 5 micro-dollars per credit. */
export const HELIUS_USD_MICROS_PER_CREDIT = 5n;
export const DOLLAR_CEILING_MICROS = BigInt(DIAGNOSTIC_BUDGET.incrementalCeilingUsd) * 1_000_000n;

/**
 * Helius prices named by the endpoint the credit buys.
 * The diagnostic runner sends only the scan. Parsed Streams are the ingestor's
 * parsedTransactionSubscribe deliveries. The legacy Enhanced Transactions route is not called.
 */
export const HELIUS_DIAGNOSTIC_ENDPOINTS = {
  enhancedTransactions: {
    name: "Legacy Enhanced Transactions",
    endpoint: "GET https://api.helius.xyz/v0/addresses/{address}/transactions",
    credits: 100,
  },
  parsedEventsScan: {
    name: "Parsed Events scan",
    endpoint: "POST https://mainnet.helius-rpc.com/v1/parsed-events/scan",
    requestCredits: 10,
    creditsPerHistoryPage: 1,
    transactionsPerPage: 1000,
    /** Helius scans at most this many transactions unless the request sets a lower budget. */
    maxScannedTransactions: 10_000,
  },
  parsedStreamDelivery: {
    name: "Parsed Streams delivery",
    endpoint: "parsedTransactionSubscribe delivery",
    creditsPerDeliveredEvent: 1,
  },
} as const;

/** Helius methods the diagnostic entrypoint actually charges. */
export const DIAGNOSTIC_HELIUS_METHODS = ["parsedEventsScan"] as const;

/** The only database role allowed to run the diagnostic entrypoint. */
export const DIAGNOSTIC_DB_ROLE = "fomo_shadow";

/** A scan request may not ask for more than Helius's 10,000-transaction budget. */
export function boundedScanBudget(maxScannedTransactions: number): {
  allowed: boolean;
  maxScanned: number;
  historyPages: number;
  reservedCredits: number;
} {
  const maxScanned = Math.floor(maxScannedTransactions);
  const cap = HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.maxScannedTransactions;
  if (!Number.isFinite(maxScanned) || maxScanned < 1 || maxScanned > cap) {
    return { allowed: false, maxScanned: 0, historyPages: 0, reservedCredits: 0 };
  }
  const historyPages = Math.ceil(
    maxScanned / HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.transactionsPerPage,
  );
  return {
    allowed: true,
    maxScanned,
    historyPages,
    reservedCredits:
      HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.requestCredits +
      historyPages * HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.creditsPerHistoryPage,
  };
}

export const EXHAUSTION_EFFECT = {
  allowance: DIAGNOSTIC_ALLOWANCE,
  stops: ["reference_scan", "reconciliation", "quote_collection"] as const,
  ingestor: "keeps_running" as const,
} as const;

export function heliusDiagnosticCredits(
  method: string,
  detail?: { transactionsScanned?: number; historyPages?: number; deliveredEvents?: number },
): number {
  if (method === "enhancedTransactions" || method === "parsedEventsRest") {
    return HELIUS_DIAGNOSTIC_ENDPOINTS.enhancedTransactions.credits;
  }
  if (method === "parsedEventsScan") {
    const pageSize = HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.transactionsPerPage;
    const scanned = Number.isFinite(detail?.transactionsScanned)
      ? Math.max(0, Math.floor(detail?.transactionsScanned ?? 0))
      : 0;
    const pages = detail?.historyPages ?? Math.ceil(scanned / pageSize);
    return (
      HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.requestCredits +
      Math.max(0, Math.floor(pages)) *
        HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.creditsPerHistoryPage
    );
  }
  if (method === "parsedStreamDelivery") {
    const events = detail?.deliveredEvents ?? 1;
    return (
      Math.max(0, Math.floor(events)) *
      HELIUS_DIAGNOSTIC_ENDPOINTS.parsedStreamDelivery.creditsPerDeliveredEvent
    );
  }
  return rpcCredits(method);
}

export interface SpendCaps {
  heliusCredits: number;
  jupiterQuotes: number;
  publicRpcCalls: number;
  usdMicros: bigint;
}

export function productionSpendCaps(): SpendCaps {
  return {
    heliusCredits: DIAGNOSTIC_BUDGET.maxHeliusCredits,
    jupiterQuotes: DIAGNOSTIC_BUDGET.maxJupiterQuotesPerDay,
    publicRpcCalls: DIAGNOSTIC_BUDGET.maxPublicRpcCallsPerDay,
    usdMicros: DOLLAR_CEILING_MICROS,
  };
}

export async function ensureDiagnosticSpend(pool: Pool): Promise<void> {
  await pool.query(`create table if not exists diagnostic_spend (
    scope text primary key,
    helius_credits bigint not null default 0,
    jupiter_quotes bigint not null default 0,
    public_rpc_calls bigint not null default 0,
    spent_usd_micros bigint not null default 0
  )`);
  await pool.query(`create table if not exists diagnostic_spend_event (
    id bigserial primary key,
    scope text not null,
    provider text not null,
    method text not null,
    units bigint not null,
    process_id text not null,
    accepted boolean not null,
    created_at timestamptz not null default now()
  )`);
}

export async function chargeDiagnostic(
  pool: Pool,
  input: {
    scope: string;
    provider: "helius" | "jupiter" | "public_rpc";
    method: string;
    processId: string;
    transactionsScanned?: number;
    historyPages?: number;
    deliveredEvents?: number;
    caps?: Partial<SpendCaps>;
  },
): Promise<{
  allowed: boolean;
  reason: "helius" | "jupiter" | "public_rpc" | "dollar" | null;
  ingestorStopped: false;
  heliusCredits: number;
  jupiterQuotes: number;
  publicRpcCalls: number;
  spentUsdMicros: string;
}> {
  const caps = { ...productionSpendCaps(), ...input.caps };
  const units =
    input.provider === "helius"
      ? heliusDiagnosticCredits(input.method, {
          transactionsScanned: input.transactionsScanned,
          historyPages: input.historyPages,
          deliveredEvents: input.deliveredEvents,
        })
      : 1;
  const usdAdd = input.provider === "helius" ? BigInt(units) * HELIUS_USD_MICROS_PER_CREDIT : 0n;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into diagnostic_spend (scope) values ($1) on conflict do nothing`, [
      input.scope,
    ]);
    const current = await client.query<{
      helius_credits: string;
      jupiter_quotes: string;
      public_rpc_calls: string;
      spent_usd_micros: string;
    }>(
      `select helius_credits::text, jupiter_quotes::text, public_rpc_calls::text, spent_usd_micros::text
        from diagnostic_spend where scope = $1 for update`,
      [input.scope],
    );
    const row = current.rows[0];
    const helius = Number(row?.helius_credits ?? 0);
    const jupiter = Number(row?.jupiter_quotes ?? 0);
    const rpc = Number(row?.public_rpc_calls ?? 0);
    const usd = BigInt(row?.spent_usd_micros ?? "0");
    let reason: "helius" | "jupiter" | "public_rpc" | "dollar" | null = null;
    if (input.provider === "helius" && helius + units > caps.heliusCredits) reason = "helius";
    if (input.provider === "jupiter" && jupiter + units > caps.jupiterQuotes) reason = "jupiter";
    if (input.provider === "public_rpc" && rpc + units > caps.publicRpcCalls) reason = "public_rpc";
    if (usd + usdAdd > caps.usdMicros) reason = "dollar";
    const allowed = reason === null;
    if (allowed) {
      await client.query(
        `update diagnostic_spend set
           helius_credits = helius_credits + $2,
           jupiter_quotes = jupiter_quotes + $3,
           public_rpc_calls = public_rpc_calls + $4,
           spent_usd_micros = spent_usd_micros + $5
         where scope = $1`,
        [
          input.scope,
          input.provider === "helius" ? units : 0,
          input.provider === "jupiter" ? units : 0,
          input.provider === "public_rpc" ? units : 0,
          usdAdd.toString(),
        ],
      );
    }
    await client.query(
      `insert into diagnostic_spend_event (scope, provider, method, units, process_id, accepted)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.scope, input.provider, input.method, units, input.processId, allowed],
    );
    const next = await client.query<{
      helius_credits: string;
      jupiter_quotes: string;
      public_rpc_calls: string;
      spent_usd_micros: string;
    }>(
      `select helius_credits::text, jupiter_quotes::text, public_rpc_calls::text, spent_usd_micros::text
       from diagnostic_spend where scope = $1`,
      [input.scope],
    );
    await client.query("commit");
    const saved = next.rows[0];
    return {
      allowed,
      reason,
      ingestorStopped: false,
      heliusCredits: Number(saved?.helius_credits ?? 0),
      jupiterQuotes: Number(saved?.jupiter_quotes ?? 0),
      publicRpcCalls: Number(saved?.public_rpc_calls ?? 0),
      spentUsdMicros: saved?.spent_usd_micros ?? "0",
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * After a scan response, replace the reserved maximum with the pages actually scanned.
 * A response above the reservation is kept at the reservation and reported as exceeded.
 */
export async function reconcileDiagnosticScan(
  pool: Pool,
  input: {
    scope: string;
    processId: string;
    reservedCredits: number;
    actualTransactions: number;
  },
): Promise<{ actualCredits: number; exceeded: boolean; heliusCredits: number }> {
  const actualCredits = heliusDiagnosticCredits("parsedEventsScan", {
    transactionsScanned: input.actualTransactions,
  });
  const exceeded = actualCredits > input.reservedCredits;
  const release = exceeded ? 0 : Math.max(0, input.reservedCredits - actualCredits);
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (release > 0) {
      const usd = (BigInt(release) * HELIUS_USD_MICROS_PER_CREDIT).toString();
      await client.query(
        `update diagnostic_spend set
           helius_credits = greatest(0, helius_credits - $2),
           spent_usd_micros = greatest(0, spent_usd_micros - $3)
         where scope = $1`,
        [input.scope, release, usd],
      );
    }
    await client.query(
      `insert into diagnostic_spend_event (scope, provider, method, units, process_id, accepted)
       values ($1, 'helius', 'parsedEventsScanReconcile', $2, $3, true)`,
      [input.scope, exceeded ? input.reservedCredits : actualCredits, input.processId],
    );
    const next = await client.query<{ helius_credits: string }>(
      "select helius_credits::text from diagnostic_spend where scope = $1",
      [input.scope],
    );
    await client.query("commit");
    return {
      actualCredits,
      exceeded,
      heliusCredits: Number(next.rows[0]?.helius_credits ?? 0),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

import {
  DIAGNOSTIC_HELIUS_METHODS,
  EXHAUSTION_EFFECT,
  PUMP_PROGRAM_ID,
  budgetLevel,
  chargeDiagnostic,
  collectJupiterBids,
  coverageReadiness,
  intakeAllowanceCredits,
  qualificationGate,
  scanNamesForProgram,
  utcMonth,
  type Env,
  type SpendCaps,
} from "@fomo/core";

import { scanInstructionHistory } from "./helius.js";
import { recallProgramFromPublicRpc } from "./pumpRecall.js";

type BudgetPool = Parameters<typeof chargeDiagnostic>[0];

export interface DiagnosticRunResult {
  entrypoint: "apps/ingestor/dist/diagnostic.js";
  role: string | null;
  budgetDbFailed: boolean;
  ingestorStopped: false;
  ingestor: "keeps_running";
  clockInhibited: true;
  countDays: boolean;
  heliusMethods: readonly ["parsedEventsScan"];
  coverage: {
    ready: boolean;
    failure: "integrity" | null;
    diagnosticCreditsRemaining: number;
  };
  sent: { scan: number; reconciliation: number; quote: number };
  denied: number;
}

/**
 * One diagnostic pass: a parsed-events scan, one public-RPC reconciliation,
 * and one Jupiter quote. Each outbound attempt is charged first, including a
 * quote retry. A budget database error or a denied charge does not send.
 * This does not stop the ingestor and it does not start the qualification clock.
 */
export async function runDiagnosticCollection(input: {
  pool: BudgetPool;
  env: Env;
  scope?: string;
  processId?: string;
  fetchImpl?: typeof fetch;
}): Promise<DiagnosticRunResult> {
  const scope = input.scope ?? process.env["DIAGNOSTIC_SCOPE"] ?? "diagnostic";
  const processId = input.processId ?? process.env["DIAGNOSTIC_PROCESS_ID"] ?? `pid-${process.pid}`;
  const caps = capsFromEnv(input.env);
  let denied = 0;
  let budgetDbFailed = false;
  let role: string | null = null;
  let accountUsagePaused = false;

  const charge = async (spec: {
    provider: "helius" | "jupiter" | "public_rpc";
    method: string;
    historyPages?: number;
  }): Promise<boolean> => {
    try {
      const result = await chargeDiagnostic(input.pool, {
        scope,
        processId,
        provider: spec.provider,
        method: spec.method,
        historyPages: spec.historyPages,
        caps,
      });
      if (!result.allowed) denied += 1;
      return result.allowed;
    } catch {
      budgetDbFailed = true;
      return false;
    }
  };

  try {
    const who = await input.pool.query<{ current_user: string }>("select current_user");
    role = who.rows[0]?.current_user ?? null;
  } catch {
    budgetDbFailed = true;
  }

  if (!budgetDbFailed) {
    try {
      const usage = await input.pool.query<{ paused: boolean; credit_micros: string }>(
        "select paused, credit_micros::text from ingest_month where month = $1",
        [utcMonth(new Date())],
      );
      const row = usage.rows[0];
      const level = budgetLevel(
        BigInt(row?.credit_micros ?? "0"),
        intakeAllowanceCredits(input.env.HELIUS_MONTHLY_CREDITS),
      );
      accountUsagePaused = row?.paused === true || level === "pause";
    } catch {
      accountUsagePaused = true;
    }

    await scanInstructionHistory({
      apiKey: input.env.HELIUS_API_KEY,
      programId: PUMP_PROGRAM_ID,
      instructionNames: scanNamesForProgram(PUMP_PROGRAM_ID, input.env.PUMP_SUBSCRIBE_CREATE_POOL),
      slotGt: 0,
      slotLte: null,
      maxPages: 1,
      maxScannedTransactions: 1000,
      baseUrl: input.env.HELIUS_HTTP_BASE,
      fetchImpl: input.fetchImpl,
      gate: ({ historyPages }) =>
        charge({ provider: "helius", method: "parsedEventsScan", historyPages }),
    });
    await recallProgramFromPublicRpc({
      programId: PUMP_PROGRAM_ID,
      known: new Set(),
      rpcUrl: input.env.PUBLIC_RPC_URL,
      fetchImpl: input.fetchImpl,
      limit: 1,
      gate: () => charge({ provider: "public_rpc", method: "getSignaturesForAddress" }),
    });
    await collectJupiterBids({
      requests: [
        {
          mint: "So11111111111111111111111111111111111111112",
          side: "buy",
          purpose: "probe",
          amount: "1000000",
          which: "1x",
          sizeUsd: 20,
          solPriceUsd: 100,
          priority: 1,
        },
      ],
      fetchImpl: input.fetchImpl,
      apiKey: null,
      quoteBase: input.env.JUPITER_QUOTE_BASE,
      gate: () => charge({ provider: "jupiter", method: "quote" }),
    });
  }

  const totals = await readTotals(input.pool, scope, caps.heliusCredits);
  const coverage = coverageReadiness({
    accountUsagePaused,
    diagnosticCreditsRemaining: totals.remaining,
  });
  const clock = qualificationGate({
    ciGreenOnCommit: true,
    isolationTested: true,
    walletClassificationTested: true,
    matchingImmutable: true,
    horizonRecordsHonest: true,
    venueRecallScheduled: true,
    configChangedDuringShadow: false,
    venueScopeSet: true,
    walletListVersionSet: true,
    preflightPassed: true,
    diagnosticPhase: true,
  });
  return {
    entrypoint: "apps/ingestor/dist/diagnostic.js",
    role,
    budgetDbFailed,
    ingestorStopped: false,
    ingestor: EXHAUSTION_EFFECT.ingestor,
    clockInhibited: true,
    countDays: clock.countDays,
    heliusMethods: DIAGNOSTIC_HELIUS_METHODS,
    coverage,
    sent: totals.sent,
    denied,
  };
}

function capsFromEnv(env: Env): SpendCaps {
  return {
    heliusCredits: env.DIAGNOSTIC_MAX_HELIUS_CREDITS ?? 50_000,
    jupiterQuotes: env.DIAGNOSTIC_MAX_JUPITER_QUOTES_PER_DAY ?? 2_000,
    publicRpcCalls: env.DIAGNOSTIC_MAX_PUBLIC_RPC_CALLS_PER_DAY ?? 20_000,
    usdMicros: 25_000_000n,
  };
}

async function readTotals(
  pool: BudgetPool,
  scope: string,
  heliusCap: number,
): Promise<{
  remaining: number;
  sent: { scan: number; reconciliation: number; quote: number };
}> {
  const empty = { scan: 0, reconciliation: 0, quote: 0 };
  try {
    const totals = await pool.query<{ helius_credits: string }>(
      "select helius_credits::text from diagnostic_spend where scope = $1",
      [scope],
    );
    const events = await pool.query<{ method: string }>(
      "select method from diagnostic_spend_event where scope = $1 and accepted",
      [scope],
    );
    const sent = { ...empty };
    for (const row of events.rows) {
      if (row.method === "parsedEventsScan") sent.scan += 1;
      if (row.method === "getSignaturesForAddress") sent.reconciliation += 1;
      if (row.method === "quote") sent.quote += 1;
    }
    const used = Number(totals.rows[0]?.helius_credits ?? 0);
    return { remaining: Math.max(0, heliusCap - used), sent };
  } catch {
    return { remaining: heliusCap, sent: empty };
  }
}

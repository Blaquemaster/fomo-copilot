import {
  MICROS_PER_CREDIT,
  WALLET_BACKFILL_FEATURE,
  allowanceCredits,
  collectEarlyBuyers,
  earlyBuyerHistoryParams,
  SCORING_VERSION,
  applyLossMaturity,
  nextTrackedSet,
  scoreProvenWallets,
  utcMonth,
  walletCreditCapMicros,
  type Env,
  type HistoryPage,
  type IngestRepository,
  type Logger,
} from "@fomo/core";

import { HeliusRpcError, heliusRpc } from "./helius.js";

const WAKE_MS = 60_000;
const HISTORY_RETRY_MS = [60_000, 120_000, 240_000, 480_000, 600_000] as const;

/** Backfill and rescore cadence. Default is every 4 hours, inside the monthly credit cap. */
export function walletRefreshIntervalMs(hours: number | undefined): number {
  const safe = hours === undefined || !Number.isFinite(hours) ? 4 : hours;
  return Math.max(1, safe) * 60 * 60 * 1000;
}

/** First retry is one minute. Later tries double until ten minutes. */
export function historyRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.floor(attempt) - 1);
  return HISTORY_RETRY_MS[Math.min(index, HISTORY_RETRY_MS.length - 1)] ?? 600_000;
}

export async function runWalletMaintenance(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  fetchPage?: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  onWallets?: (addresses: readonly string[]) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const intervalMs = walletRefreshIntervalMs(input.env.WALLET_REFRESH_HOURS);
  const wait = input.sleep ?? sleep;
  let failureAttempt = 0;
  while (!input.signal.aborted) {
    let retryMs: number | null = null;
    try {
      const finished = await input.repo.walletJobFinishedAt();
      const due = finished === null || Date.now() - finished.getTime() >= intervalMs;
      if (due) {
        const outcome = await runWalletPass(input);
        if (outcome === "retry") {
          failureAttempt += 1;
          retryMs = historyRetryDelayMs(failureAttempt);
        } else {
          failureAttempt = 0;
        }
      }
    } catch (error) {
      failureAttempt += 1;
      retryMs = historyRetryDelayMs(failureAttempt);
      input.logger.error({ err: error, code: rpcCode(error) }, "wallet maintenance failed");
    }
    if (input.signal.aborted) return;
    await wait(retryMs ?? Math.min(intervalMs, WAKE_MS), input.signal);
  }
}

async function runWalletPass(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  fetchPage?: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  onWallets?: (addresses: readonly string[]) => void;
}): Promise<"ok" | "retry"> {
  const monthCap = input.env.WALLET_BACKFILL_CREDIT_CAP ?? 600_000;
  const runCap = input.env.WALLET_BACKFILL_RUN_CREDITS ?? 3_300;
  const buysPerMint = input.env.WALLET_BACKFILL_BUYS ?? 50;
  const spent = await input.repo.featureMonthMicros(WALLET_BACKFILL_FEATURE, utcMonth(new Date()));
  const monthLeft = creditsLeft(BigInt(monthCap) * MICROS_PER_CREDIT, spent);
  const runCreditsLeft = Math.min(runCap, monthLeft);
  const allowance = allowanceCredits(input.env.HELIUS_PLAN, input.env.HELIUS_MONTHLY_CREDITS);
  input.logger.info(
    {
      monthCap,
      runCap,
      runCreditsLeft,
      buysPerMint,
      creditsPerPage: 10,
      allowance: allowance.toString(),
      walletSubscriptionCap: (
        walletCreditCapMicros(
          allowance * MICROS_PER_CREDIT,
          input.env.WALLET_CREDIT_BUDGET_PCT ?? 25,
        ) / MICROS_PER_CREDIT
      ).toString(),
    },
    "early-buyer backfill budget",
  );
  const mints = runCreditsLeft >= 10 ? await input.repo.nextBackfillMints(runCreditsLeft) : [];
  let result: Awaited<ReturnType<typeof collectEarlyBuyers>>;
  try {
    result = await collectEarlyBuyers({
      mints,
      buysPerMint,
      runCreditsLeft,
      fetchPage: (account, token) => fetchHistory(input, account, token),
      failLimit: input.env.WALLET_BACKFILL_FAIL_LIMIT ?? 5,
      save: async (rows) => {
        await input.repo.saveEarlyBuyers(rows);
      },
      checkpoint: async (row) => {
        await input.repo.saveBackfillCheckpoint(row);
        if (row.creditDelta > 0) {
          await input.repo.recordFeatureSpend({
            feature: WALLET_BACKFILL_FEATURE,
            creditMicros: BigInt(row.creditDelta) * MICROS_PER_CREDIT,
            storedEvents: 0,
            now: new Date(),
          });
        }
      },
    });
  } catch (error) {
    input.logger.warn({ code: rpcCode(error), err: error }, "early-buyer history fetch failed");
    return "retry";
  }
  if (result.errored) {
    input.logger.warn({ code: result.code }, "early-buyer history fetch failed");
    return "retry";
  }
  const maxWallets = input.env.WALLET_MAX_WALLETS ?? 300;
  const ranked = scoreProvenWallets(
    applyLossMaturity(await input.repo.earlyBuys(), new Date(), {
      pumpMs: (input.env.WALLET_LOSS_AGE_MINUTES ?? 120) * 60 * 1000,
      meteoraMs: (input.env.WALLET_LOSS_AGE_METEORA_MINUTES ?? 60) * 60 * 1000,
    }),
    maxWallets,
    {
      minEntries: input.env.WALLET_MIN_ENTRIES ?? 10,
      holdOut: true,
      cutoff: input.env.WALLET_SCORE_CUTOFF ? new Date(input.env.WALLET_SCORE_CUTOFF) : null,
      minLosses: input.env.WALLET_MIN_LOSSES ?? 1,
      minShrunkRate: input.env.WALLET_MIN_SHRUNK_RATE ?? 0.6,
      botMaxEntries: input.env.WALLET_BOT_MAX_ENTRIES ?? 80,
    },
  );
  const active = await input.repo.activeTrackedWallets();
  const paperOpen = await input.repo.paperTestOpen();
  let kept = active.length;
  let replaced = 0;
  let added = 0;
  if (paperOpen) {
    input.logger.info(
      { wallets: active.length },
      "paper test is open; proven wallet list stays frozen",
    );
    input.onWallets?.(active);
  } else {
    const storedVersion = await input.repo.activeScoringVersion();
    const reset = storedVersion !== null && storedVersion !== SCORING_VERSION;
    const refresh = nextTrackedSet({
      ranked,
      active,
      maxWallets,
      maxChurnPct: input.env.WALLET_CHURN_PCT ?? 20,
      reset,
    });
    if (reset || refresh.upsert.length > 0 || refresh.replaced > 0) {
      await input.repo.applyWalletRefresh(
        { keep: refresh.keep, upsert: refresh.upsert, scoringVersion: SCORING_VERSION },
        new Date(),
      );
      input.onWallets?.(refresh.keep);
    }
    kept = refresh.keep.length;
    replaced = refresh.replaced;
    added = refresh.added;
  }
  await input.repo.markWalletJob(new Date());
  input.logger.info(
    {
      credits: result.credits,
      buyers: result.buyers,
      mintsDone: result.mintsDone,
      stopped: result.stopped,
      wallets: kept,
      replaced,
      added,
    },
    "wallet backfill and refresh",
  );
  return "ok";
}

function rpcCode(error: unknown): number | null {
  if (error instanceof HeliusRpcError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

async function fetchHistory(
  input: {
    env: Env;
    fetchPage?: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  },
  account: string,
  paginationToken: string | null,
): Promise<HistoryPage | null> {
  if (input.fetchPage) return input.fetchPage(account, paginationToken);
  const result = await heliusRpc({
    apiKey: input.env.HELIUS_API_KEY,
    method: "getTransactionsForAddress",
    params: earlyBuyerHistoryParams(account, paginationToken),
  });
  const record =
    typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  if (record === null || !Array.isArray(record["data"])) {
    throw new HeliusRpcError("early-buyer history response had no transaction list", null);
  }
  const token = record["paginationToken"];
  return {
    transactions: record["data"],
    paginationToken: typeof token === "string" ? token : null,
  };
}

function creditsLeft(capMicros: bigint, spentMicros: bigint): number {
  if (spentMicros >= capMicros) return 0;
  return Number((capMicros - spentMicros) / MICROS_PER_CREDIT);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

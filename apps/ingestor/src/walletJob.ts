import {
  MICROS_PER_CREDIT,
  WALLET_BACKFILL_FEATURE,
  allowanceCredits,
  collectEarlyBuyers,
  earlyBuyerHistoryParams,
  nextTrackedSet,
  scoreProvenWallets,
  utcMonth,
  walletCreditCapMicros,
  type Env,
  type HistoryPage,
  type IngestRepository,
  type Logger,
} from "@fomo/core";

import { heliusRpc } from "./helius.js";

const WAKE_MS = 60_000;

export async function runWalletMaintenance(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  fetchPage?: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  onWallets?: (addresses: readonly string[]) => void;
}): Promise<void> {
  const intervalMs = (input.env.WALLET_REFRESH_HOURS ?? 24) * 60 * 60 * 1000;
  while (!input.signal.aborted) {
    try {
      const finished = await input.repo.walletJobFinishedAt();
      const due = finished === null || Date.now() - finished.getTime() >= intervalMs;
      if (due) await runWalletPass(input);
    } catch (error) {
      input.logger.error({ err: error }, "wallet maintenance failed");
    }
    await sleep(Math.min(intervalMs, WAKE_MS), input.signal);
  }
}

async function runWalletPass(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  fetchPage?: (account: string, paginationToken: string | null) => Promise<HistoryPage | null>;
  onWallets?: (addresses: readonly string[]) => void;
}): Promise<void> {
  const monthCap = input.env.WALLET_BACKFILL_CREDIT_CAP ?? 200_000;
  const runCap = input.env.WALLET_BACKFILL_RUN_CREDITS ?? 10_000;
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
  const result = await collectEarlyBuyers({
    mints,
    buysPerMint,
    runCreditsLeft,
    fetchPage: (account, token) => fetchHistory(input, account, token),
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
  const maxWallets = input.env.WALLET_MAX_WALLETS ?? 300;
  const ranked = scoreProvenWallets(await input.repo.earlyBuys(), maxWallets);
  const active = await input.repo.activeTrackedWallets();
  const refresh = nextTrackedSet({
    ranked,
    active,
    maxWallets,
    maxChurnPct: input.env.WALLET_CHURN_PCT ?? 20,
  });
  if (refresh.upsert.length > 0 || refresh.replaced > 0) {
    await input.repo.applyWalletRefresh({ keep: refresh.keep, upsert: refresh.upsert }, new Date());
    input.onWallets?.(refresh.keep);
  }
  await input.repo.markWalletJob(new Date());
  input.logger.info(
    {
      credits: result.credits,
      buyers: result.buyers,
      mintsDone: result.mintsDone,
      stopped: result.stopped,
      wallets: refresh.keep.length,
      replaced: refresh.replaced,
      added: refresh.added,
    },
    "wallet backfill and refresh",
  );
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
  try {
    const result = await heliusRpc({
      apiKey: input.env.HELIUS_API_KEY,
      method: "getTransactionsForAddress",
      params: earlyBuyerHistoryParams(account, paginationToken),
    });
    const record =
      typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
    if (record === null || !Array.isArray(record["data"])) return null;
    const token = record["paginationToken"];
    return {
      transactions: record["data"],
      paginationToken: typeof token === "string" ? token : null,
    };
  } catch {
    return null;
  }
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

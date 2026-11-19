import {
  mihaoObservation,
  SOL_MINT,
  etDay,
  etDayRange,
  etWeekStart,
  formatWeeklyReview,
  inQuietHours,
  lamportsForUsd,
  nextEtMidnight,
  parseLockedConfig,
  phaseCConfigFromEnv,
  resolveAlertChat,
  runPhaseCPass,
  screenRulesFromThresholds,
  secondWaveSignal,
  stageSizeUsd,
  type Env,
  type MarketQuote,
  type PhaseCStore,
  type SecondWaveObservation,
  type Thresholds,
} from "@fomo/core";

import { loadMintAuthorities, screenCreditProjection } from "./accounts.js";
import { collectJupiterBids, type JupiterRequest } from "./jupiter.js";

function readEntriesStart(body: string): Date | null {
  try {
    const parsed = JSON.parse(body) as { entriesStartAt?: string };
    return parsed.entriesStartAt ? new Date(parsed.entriesStartAt) : null;
  } catch {
    return null;
  }
}

function addressDiff(previous: readonly string[], next: readonly string[]): string[] {
  const before = new Set(previous);
  const after = new Set(next);
  const lines = [
    ...next.filter((address) => !before.has(address)).map((address) => `+${address}`),
    ...previous.filter((address) => !after.has(address)).map((address) => `-${address}`),
  ];
  return lines.sort();
}

export async function runPhaseCCycle(input: {
  now: Date;
  env: Env;
  thresholds: Thresholds;
  store: PhaseCStore;
  quotes: readonly MarketQuote[];
  send: (text: string) => Promise<void>;
  warn: (message: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const config = phaseCConfigFromEnv(input.env, input.thresholds);
  const stored = await input.store.protocol();
  const day = etDayRange(input.now);
  const coins = await input.store.coins(200);
  const missingAuthority = coins
    .filter((coin) => coin.mintAuthorityActive === null)
    .map((coin) => coin.mint);
  if (missingAuthority.length > 0) {
    const projection = screenCreditProjection(missingAuthority.length);
    input.warn(
      `screen credit projection ${projection.perDay.toString()}/day ${projection.perMonth.toString()}/month`,
    );
    const loaded = await loadMintAuthorities({
      apiKey: input.env.HELIUS_API_KEY,
      mints: missingAuthority.slice(0, 20),
      fetchImpl: input.fetchImpl,
    });
    await input.store.recordScreenCredits(loaded.length, input.now);
    for (const row of loaded) {
      const coin = coins.find((item) => item.mint === row.mint);
      if (!coin) continue;
      coin.mintAuthorityActive = row.mintAuthorityActive;
      coin.freezeAuthorityActive = row.freezeAuthorityActive;
    }
  }
  if (config.xEnabled) {
    const counts = await input.store.mentionCounts(coins.map((coin) => coin.mint));
    for (const coin of coins) coin.xMentions = counts.get(coin.mint) ?? 0;
  }
  const solPrice = input.quotes.find((quote) => quote.mint === SOL_MINT)?.priceUsd ?? null;
  for (const coin of coins) {
    const market = input.quotes.find((quote) => quote.mint === coin.mint);
    if (market?.liquidityUsd != null) coin.liquidityUsd = market.liquidityUsd;
    if (coin.graduatedAt && market) {
      const observation: SecondWaveObservation = {
        mint: coin.mint,
        graduatedAt: coin.graduatedAt,
        volume1hUsd: market.volumeUsd1h,
        volume4hUsd: null,
        volume7dUsd: null,
        priceUsd: market.priceUsd,
        postGradRangeHigh: null,
        holderGrowthPct: null,
        liquidityUsd: market.liquidityUsd,
        liquidityGrowthPct: null,
        trackedBuys: coin.trackedBuyers,
      };
      coin.secondWave = secondWaveSignal(observation, input.now);
    }
  }
  if ((input.env.SECOND_WAVE_SOURCE ?? "live") === "fixture") {
    const observed = mihaoObservation(input.now);
    if (secondWaveSignal(observed, input.now) === "breakout") {
      coins.push({
        mint: observed.mint,
        createdAt: new Date(input.now.getTime() - 4 * 24 * 60 * 60 * 1000),
        graduatedAt: observed.graduatedAt,
        curveCompletedAt: observed.graduatedAt,
        trackedBuyers: observed.trackedBuys,
        xMentions: null,
        liquidityUsd: observed.liquidityUsd,
        transferFeeBps: 0,
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
        exitQuoteImpactPct: 1,
        top10HoldersPct: 10,
        sniperBundlePct: 4,
        uniqueMakers1h: 80,
        creatorSells: 0,
        trackedSells: 0,
        quoteError: false,
        secondWave: "breakout",
      });
    }
  }
  await input.store.saveSnapshots(
    input.quotes.map((quote) => ({
      mint: quote.mint,
      at: input.now,
      priceUsd: quote.priceUsd,
      liquidityUsd: quote.liquidityUsd,
      volume1h: quote.volumeUsd1h,
    })),
  );
  const positions = await input.store.positions();
  const requests: JupiterRequest[] = [];
  for (const position of positions) {
    const size = stageSizeUsd(config.bankroll, position.sizePct);
    if (size === null || solPrice === null) continue;
    if (position.status === "pending" && input.now.getTime() >= position.entryAfter.getTime()) {
      const amount = lamportsForUsd(size, solPrice);
      const amount2 = lamportsForUsd(size * 2, solPrice);
      if (amount) {
        requests.push({
          mint: position.mint,
          side: "buy",
          amount,
          which: "one",
          sizeUsd: size,
          solPriceUsd: solPrice,
        });
      }
      if (amount2) {
        requests.push({
          mint: position.mint,
          side: "buy",
          amount: amount2,
          which: "two",
          sizeUsd: size * 2,
          solPriceUsd: solPrice,
        });
      }
    }
    if (position.status === "open" && position.entryOutAmount) {
      requests.push({
        mint: position.mint,
        side: "sell",
        amount: position.entryOutAmount,
        which: "one",
        sizeUsd: size,
        solPriceUsd: solPrice,
      });
      requests.push({
        mint: position.mint,
        side: "sell",
        amount: String(Number(position.entryOutAmount) * 2),
        which: "two",
        sizeUsd: size * 2,
        solPriceUsd: solPrice,
      });
    }
  }
  for (const coin of coins) {
    if (coin.exitQuoteImpactPct !== null || solPrice === null) continue;
    const size = stageSizeUsd(config.bankroll, config.sizePct.trench);
    const amount = size === null ? null : lamportsForUsd(size, solPrice);
    if (!amount || !size) continue;
    requests.push({
      mint: coin.mint,
      side: "buy",
      amount,
      which: "one",
      sizeUsd: size,
      solPriceUsd: solPrice,
    });
  }
  const quoted = await collectJupiterBids({
    requests,
    fetchImpl: input.fetchImpl,
    apiKey: input.env.JUPITER_API_KEY ?? null,
    nowMs: input.now.getTime(),
  });
  for (const coin of coins) {
    const bid = quoted.bids[coin.mint]?.one;
    if (bid?.ok) coin.exitQuoteImpactPct = bid.impactPct;
  }
  const entriesStart = stored ? readEntriesStart(stored.body) : nextEtMidnight(input.now);
  const result = runPhaseCPass({
    now: input.now,
    config,
    rules: screenRulesFromThresholds(input.thresholds),
    locked: stored
      ? { fingerprint: stored.fingerprint, config: parseLockedConfig(stored.body) }
      : null,
    coins,
    quotes: [...input.quotes],
    bids: quoted.bids,
    positions,
    closedToday: await input.store.closedBetween(day.start, day.end),
    paused: await input.store.isPaused(day.day),
    resolved: await input.store.resolvedReturns(),
    alerted: await input.store.alerted(),
    held: await input.store.held(),
    recentEntryCount: await input.store.recentEntryCount(
      new Date(input.now.getTime() - 60 * 60 * 1000),
    ),
    wallets: await input.store.wallets(),
    pendingTiers: await input.store.pendingTiers(),
    registeredAt: stored?.registeredAt ?? null,
    entriesStartAt: entriesStart,
    expectedAlerts: null,
  });
  if (result.protocolViolation) input.warn(`protocol violation: ${result.protocolViolation}`);
  if (result.lock) {
    await input.store.saveProtocol(result.lock.fingerprint, result.lock.body, input.now);
  }
  if (result.pauseReason) await input.store.pause(etDay(input.now), result.pauseReason, input.now);
  for (const open of result.opens) {
    await input.store.openPosition(
      open.id,
      open.quote,
      open.impactPct,
      open.feeUsd,
      open.sizeUsd,
      open.outAmount,
      input.now,
    );
  }
  for (const close of result.closes) {
    await input.store.closePosition({
      id: close.id,
      quote: close.quote,
      net: close.net,
      net2x: close.net2x,
      reason: close.reason,
      impactPct: close.impactPct,
      feeUsd: close.feeUsd,
      failure: close.failure,
      at: input.now,
    });
  }
  const sentIds: string[] = [];
  for (const entry of result.entries) {
    const id = await input.store.insertEntry({ ...entry, alertAt: input.now });
    if (!entry.held && id) sentIds.push(id);
  }
  for (const request of result.tierRequests)
    await input.store.insertTier(request.wallet, input.now);

  const destination = resolveAlertChat({
    destination: config.destination,
    testChatId: input.env.TELEGRAM_TEST_CHAT_ID ?? null,
    adminChatId: input.env.TELEGRAM_ADMIN_CHAT_ID,
  });
  if ("blocked" in destination) {
    input.warn(destination.reason);
    return;
  }
  if (result.protocolViolation) await input.send(`protocol violation: ${result.protocolViolation}`);
  for (const text of result.immediate) await input.send(text);
  await input.store.markSellWarned(result.sellWarnings);
  if (result.digest) await input.send(result.digest);
  await input.store.markDelivered([...sentIds, ...result.digestIds], input.now);

  const week = etWeekStart(input.now);
  if (
    !inQuietHours(input.now, result.config.quietHours) &&
    !(await input.store.weeklyExists(week))
  ) {
    const previous = await input.store.snapshot();
    const active = await input.store.activeAddresses();
    const pending = await input.store.pendingTiers();
    const text = formatWeeklyReview({
      week,
      walletChanges: previous.length === 0 ? [] : addressDiff(previous, active),
      xChanges: config.xEnabled ? [] : ["X mention source is off"],
      promotionsWaiting: pending,
      paper: result.paper,
    });
    await input.store.saveWeekly(week, text, input.now);
    await input.store.replaceSnapshot(active);
    await input.send(text);
  }
}

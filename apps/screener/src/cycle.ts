import {
  admitAutobuy,
  autobuyLimits,
  noopSigner,
  resolveAutobuyMode,
  mihaoObservation,
  SOL_MINT,
  etDay,
  etDayRange,
  etWeekStart,
  formatWeeklyReview,
  inQuietHours,
  lookupTradableInFomo,
  curveFallbackBid,
  lamportsForUsd,
  jupiterRatePerMin,
  liquidityFromSellImpact,
  nextEtMidnight,
  quoteKey,
  parseLockedConfig,
  phaseCConfigFromEnv,
  resolveAlertChat,
  runPhaseCPass,
  screenRulesFromThresholds,
  secondWaveSignal,
  stageForCoin,
  stageSizeUsd,
  type Env,
  type MarketQuote,
  type PhaseCStore,
  type SecondWaveObservation,
  type Thresholds,
} from "@fomo/core";

import {
  loadCreateSlotSnipers,
  loadCurveLiquidity,
  loadMintAuthorities,
  loadTopHolders,
  screenCreditProjection,
} from "./accounts.js";
import { collectJupiterBids, fetchSolPriceUsd, type JupiterRequest } from "./jupiter.js";

const ENRICH_PER_PASS = 8;

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
  refreshMarket?: boolean;
}): Promise<void> {
  const config = phaseCConfigFromEnv(input.env, input.thresholds);
  const stored = await input.store.protocol();
  const day = etDayRange(input.now);
  const rules = screenRulesFromThresholds(input.thresholds);
  const coins = await input.store.coins(200);
  if (config.xEnabled) {
    const counts = await input.store.mentionCounts(coins.map((coin) => coin.mint));
    for (const coin of coins) coin.xMentions = counts.get(coin.mint) ?? 0;
  }
  const solQuote = await fetchSolPriceUsd({
    fetchImpl: input.fetchImpl,
    apiKey: input.env.JUPITER_API_KEY ?? null,
    nowMs: input.now.getTime(),
  });
  const solPrice =
    solQuote.price ?? input.quotes.find((quote) => quote.mint === SOL_MINT)?.priceUsd ?? null;
  if (config.bankroll === null || solPrice === null) {
    const reason =
      config.bankroll === null ? "PAPER_BANKROLL_USD is not set" : "SOL/USD price is unavailable";
    input.warn(reason);
    await input.send(reason);
  }
  const wave = await input.store.secondWaveMints(300);
  const seen = new Set(coins.map((coin) => coin.mint));
  for (const row of wave) {
    if (seen.has(row.mint)) continue;
    coins.push({
      mint: row.mint,
      createdAt: row.createdAt,
      graduatedAt: row.graduatedAt,
      curveCompletedAt: row.graduatedAt,
      trackedBuyers: 0,
      xMentions: null,
      liquidityUsd: null,
      transferFeeBps: null,
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      exitQuoteImpactPct: null,
      top10HoldersPct: null,
      sniperBundlePct: null,
      uniqueMakers1h: null,
      creatorSells: 0,
      trackedSells: 0,
      quoteError: false,
      secondWave: null,
    });
  }
  const recent = await input.store.recentCandidates(7);
  const expectedAlerts = Math.round((recent / 7) * config.paperWindowDays);
  const history = await input.store.waveHistory(
    coins.filter((coin) => coin.graduatedAt).map((coin) => coin.mint),
  );
  for (const coin of coins) {
    const market = input.quotes.find((quote) => quote.mint === coin.mint);
    if (market?.liquidityUsd != null) coin.liquidityUsd = market.liquidityUsd;
    if (coin.graduatedAt) {
      const past = history.get(coin.mint);
      const observation: SecondWaveObservation = {
        mint: coin.mint,
        graduatedAt: coin.graduatedAt,
        volume1hUsd: market?.volumeUsd1h ?? null,
        volume4hUsd: null,
        volume7dUsd: past?.volume7dUsd ?? null,
        priceUsd: market?.priceUsd ?? null,
        postGradRangeHigh: past?.rangeHigh ?? null,
        holderGrowthPct: null,
        liquidityUsd: coin.liquidityUsd,
        liquidityGrowthPct: past?.liquidityGrowthPct ?? null,
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
  if (input.refreshMarket) {
    await input.store.saveSnapshots(
      input.quotes.map((quote) => ({
        mint: quote.mint,
        at: input.now,
        priceUsd: quote.priceUsd,
        liquidityUsd: quote.liquidityUsd,
        volume1h: quote.volumeUsd1h,
        volume24h: quote.volumeUsd24h,
      })),
    );
    await input.store.pruneSnapshots(new Date(input.now.getTime() - 8 * 24 * 60 * 60 * 1000));
  }
  const curveReserves = new Map<string, { virtualSolLamports: bigint; virtualTokenRaw: bigint }>();
  if (solPrice !== null) {
    const curves = await loadCurveLiquidity({
      apiKey: input.env.HELIUS_API_KEY,
      solPriceUsd: solPrice,
      coins: coins
        .filter(
          (coin) =>
            coin.liquidityUsd === null &&
            coin.graduatedAt === null &&
            coin.bondingCurve &&
            stageForCoin(coin, input.now) !== null,
        )
        .slice(0, ENRICH_PER_PASS)
        .map((coin) => ({
          mint: coin.mint,
          bondingCurve: coin.bondingCurve ?? "",
          venue: coin.poolType,
        })),
      fetchImpl: input.fetchImpl,
    });
    await input.store.recordScreenCredits(curves.credits, input.now);
    for (const row of curves.rows) {
      const coin = coins.find((item) => item.mint === row.mint);
      if (coin && coin.liquidityUsd === null) coin.liquidityUsd = row.liquidityUsd;
      curveReserves.set(row.mint, row);
    }
  }
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
          purpose: "entry",
          amount,
          which: "1x",
          sizeUsd: size,
          solPriceUsd: solPrice,
          priority: 1,
        });
      }
      if (amount2) {
        requests.push({
          mint: position.mint,
          side: "buy",
          purpose: "entry",
          amount: amount2,
          which: "2x",
          sizeUsd: size * 2,
          solPriceUsd: solPrice,
          priority: 1,
        });
      }
    }
    if (position.status === "open" && position.entryOutAmount) {
      const half = position.scaledAt ? null : position.entryOutAmount;
      requests.push({
        mint: position.mint,
        side: "sell",
        purpose: "exit",
        amount: position.entryOutAmount,
        which: "1x",
        sizeUsd: size,
        solPriceUsd: solPrice,
        priority: 0,
      });
      requests.push({
        mint: position.mint,
        side: "sell",
        purpose: "exit",
        amount: (BigInt(position.entryOutAmount) * 2n).toString(),
        which: "2x",
        sizeUsd: size * 2,
        solPriceUsd: solPrice,
        priority: 0,
      });
      if (half) {
        requests.push({
          mint: position.mint,
          side: "sell",
          purpose: "scale",
          amount: (BigInt(position.entryOutAmount) / 2n).toString(),
          which: "1x",
          sizeUsd: size / 2,
          solPriceUsd: solPrice,
          priority: 0,
        });
      }
    }
  }
  const quoteRate = Math.max(1, jupiterRatePerMin(Boolean(input.env.JUPITER_API_KEY)) - 1);
  const probeRoom = Math.floor(Math.max(0, quoteRate - requests.length) / 2);
  let probes = 0;
  for (const coin of coins) {
    if (probes >= probeRoom) break;
    if (coin.exitQuoteImpactPct !== null || solPrice === null) continue;
    const size = stageSizeUsd(
      config.bankroll,
      config.sizePct[coin.graduatedAt ? "post_graduation" : "trench"],
    );
    const amount = size === null ? null : lamportsForUsd(size, solPrice);
    if (!amount || !size) continue;
    probes += 1;
    requests.push({
      mint: coin.mint,
      side: "buy",
      purpose: "probe",
      amount,
      which: "1x",
      sizeUsd: size,
      solPriceUsd: solPrice,
      priority: 2,
    });
  }
  const quoted = await collectJupiterBids({
    requests,
    fetchImpl: input.fetchImpl,
    apiKey: input.env.JUPITER_API_KEY ?? null,
    nowMs: input.now.getTime(),
    bucket: solQuote.bucket,
  });
  for (const request of requests) {
    if (request.side !== "sell" || (request.purpose !== "exit" && request.purpose !== "scale")) {
      continue;
    }
    const key = quoteKey(request.mint, request.purpose, request.which);
    const coin = coins.find((item) => item.mint === request.mint);
    const reserves = curveReserves.get(request.mint);
    const next = curveFallbackBid({
      bid: quoted.bids[key],
      graduated: coin?.graduatedAt != null,
      virtualSolLamports: reserves?.virtualSolLamports ?? null,
      virtualTokenRaw: reserves?.virtualTokenRaw ?? null,
      amountInRaw: request.amount,
      solPriceUsd: solPrice ?? 0,
      sizeUsd: request.sizeUsd,
    });
    if (next) quoted.bids[key] = next;
  }
  const screenSells: JupiterRequest[] = [];
  for (const coin of coins) {
    const probe = quoted.bids[quoteKey(coin.mint, "probe", "1x")];
    if (!probe?.ok || solPrice === null) continue;
    screenSells.push({
      mint: coin.mint,
      side: "sell",
      purpose: "screen",
      amount: probe.outAmount,
      which: "1x",
      sizeUsd: probe.sizeUsd,
      solPriceUsd: solPrice,
      priority: 2,
    });
  }
  const sold = await collectJupiterBids({
    requests: screenSells,
    fetchImpl: input.fetchImpl,
    apiKey: input.env.JUPITER_API_KEY ?? null,
    nowMs: input.now.getTime(),
    bucket: quoted.bucket,
  });
  const freshExit = new Map<string, number>();
  for (const coin of coins) {
    const key = quoteKey(coin.mint, "screen", "1x");
    let bid = sold.bids[key];
    const probe = quoted.bids[quoteKey(coin.mint, "probe", "1x")];
    const reserves = curveReserves.get(coin.mint);
    if (
      coin.graduatedAt === null &&
      reserves &&
      probe?.ok &&
      solPrice !== null &&
      (!bid || (!bid.ok && bid.reason === "no_route"))
    ) {
      const modeled = curveFallbackBid({
        bid,
        graduated: false,
        virtualSolLamports: reserves.virtualSolLamports,
        virtualTokenRaw: reserves.virtualTokenRaw,
        amountInRaw: probe.outAmount,
        solPriceUsd: solPrice,
        sizeUsd: probe.sizeUsd,
      });
      if (modeled?.ok && modeled.source === "curve_modeled") {
        sold.bids[key] = modeled;
        bid = modeled;
      }
    }
    if (bid?.ok) {
      coin.exitQuoteImpactPct = bid.impactPct;
      freshExit.set(coin.mint, bid.impactPct);
      if (bid.source === "curve_modeled") coin.quoteSource = "curve_modeled";
      if (coin.liquidityUsd === null) {
        const derived = bid.liquidityUsd ?? liquidityFromSellImpact(bid.sizeUsd, bid.impactPct);
        if (derived !== null) coin.liquidityUsd = derived;
      }
    }
  }
  const enrich = coins
    .filter((coin) => {
      if (coin.exitQuoteImpactPct !== null && coin.exitQuoteImpactPct > rules.exitImpactPctAbove) {
        return false;
      }
      if (coin.mintAuthorityActive === true && rules.failMintAuthority) return false;
      return (
        coin.mintAuthorityActive === null ||
        coin.top10HoldersPct === null ||
        coin.sniperBundlePct === null
      );
    })
    .slice(0, ENRICH_PER_PASS);
  let spent = 0;
  if (enrich.length > 0) {
    const loaded = await loadMintAuthorities({
      apiKey: input.env.HELIUS_API_KEY,
      mints: enrich
        .filter((coin) => coin.mintAuthorityActive === null || coin.top10HoldersPct === null)
        .map((coin) => coin.mint),
      fetchImpl: input.fetchImpl,
    });
    spent += loaded.credits;
    for (const row of loaded.rows) {
      const coin = coins.find((item) => item.mint === row.mint);
      if (!coin) continue;
      coin.mintAuthorityActive = row.mintAuthorityActive;
      coin.freezeAuthorityActive = row.freezeAuthorityActive;
    }
    const holders = await loadTopHolders({
      apiKey: input.env.HELIUS_API_KEY,
      mints: enrich.filter((coin) => coin.top10HoldersPct === null).map((coin) => coin.mint),
      supplies: new Map(loaded.rows.map((row) => [row.mint, row.supply])),
      nowMs: input.now.getTime(),
      fetchImpl: input.fetchImpl,
    });
    spent += holders.credits;
    for (const row of holders.rows) {
      const coin = coins.find((item) => item.mint === row.mint);
      if (coin) coin.top10HoldersPct = row.top10Pct;
    }
    const snipers = await loadCreateSlotSnipers({
      apiKey: input.env.HELIUS_API_KEY,
      coins: enrich
        .filter(
          (coin) =>
            coin.sniperBundlePct === null &&
            coin.bondingCurve &&
            coin.createdSlot !== null &&
            coin.createdSlot !== undefined,
        )
        .map((coin) => ({
          mint: coin.mint,
          bondingCurve: coin.bondingCurve ?? "",
          createdSlot: coin.createdSlot ?? 0,
        })),
      fetchImpl: input.fetchImpl,
    });
    spent += snipers.credits;
    for (const row of snipers.rows) {
      const coin = coins.find((item) => item.mint === row.mint);
      if (coin) coin.sniperBundlePct = row.sniperPct;
    }
  }
  if (spent > 0) {
    const projection = screenCreditProjection(ENRICH_PER_PASS);
    input.warn(
      `screen credits this pass ${spent.toString()}; projection ${projection.perDay.toString()}/day ${projection.perMonth.toString()}/month at ${ENRICH_PER_PASS.toString()} enrichments per pass`,
    );
    await input.store.recordScreenCredits(spent, input.now);
  }
  Object.assign(quoted.bids, sold.bids);
  const entriesStart = stored ? readEntriesStart(stored.body) : nextEtMidnight(input.now);
  const result = runPhaseCPass({
    now: input.now,
    config,
    rules,
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
    expectedAlerts,
  });
  if (result.restart) {
    await input.store.voidPaperWindow(input.now);
    await input.store.clearProtocol();
    input.warn("paper test restarted: config changed");
  } else if (result.protocolViolation) {
    input.warn(`protocol violation: ${result.protocolViolation}`);
  }
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
      open.fomoFeeUsd,
      open.quoteSource,
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
      fomoFeeUsd: close.fomoFeeUsd,
      quoteSource: close.quoteSource,
      at: input.now,
    });
  }
  const sentIds: string[] = [];
  for (const entry of result.entries) {
    const listed = await lookupTradableInFomo(entry.mint);
    const id = await input.store.insertEntry({
      ...entry,
      alertAt: input.now,
      tradableInFomo: listed.tradableInFomo,
    });
    if (!entry.held && id) sentIds.push(id);
  }
  for (const request of result.tierRequests)
    await input.store.insertTier(request.wallet, input.now);

  const destination = resolveAlertChat({
    destination: config.destination,
    testChatId: input.env.TELEGRAM_TEST_CHAT_ID ?? null,
    adminChatId: input.env.TELEGRAM_ADMIN_CHAT_ID,
  });
  await input.store.markSellWarned(result.sellWarnings);
  await input.store.markScaled(result.scaled, input.now);
  let autobuyMode: "off" | "dry_run" = "off";
  try {
    autobuyMode = resolveAutobuyMode({
      mode: input.env.AUTOBUY_MODE,
      liveConfirmed: input.env.AUTOBUY_LIVE_CONFIRMED === "yes",
      signer: noopSigner(),
      killed: input.env.AUTOBUY_KILL === "on",
    }).mode;
  } catch (error) {
    input.warn(error instanceof Error ? error.message : "live autobuy refused");
  }
  if (autobuyMode === "dry_run") {
    const limits = autobuyLimits({
      maxConcurrent: config.maxConcurrent,
      dailyLossCutoffPct: config.dailyLossCutoffPct,
      maxTradeUsd: input.env.AUTOBUY_MAX_TRADE_USD,
      dailyUsdCap: input.env.AUTOBUY_DAILY_USD_CAP,
      killed: false,
    });
    const paused = (await input.store.isPaused(day.day)) || result.pauseReason !== null;
    let openCount = positions.filter((position) => position.arm !== "random_pass").length;
    let spent = await input.store.autobuySpentSince(day.start);
    const intents = [];
    for (const entry of result.entries) {
      const decision = admitAutobuy({
        arm: entry.arm,
        sizeUsd: entry.amount,
        sizePct: entry.sizePct,
        bankroll: config.bankroll,
        openCount,
        dailySpentUsd: spent,
        dailyLossPct: paused ? limits.dailyLossCutoffPct : 0,
        paused,
        limits,
      });
      intents.push({
        kind: "entry" as const,
        mint: entry.mint,
        arm: entry.arm,
        stage: entry.stage,
        sizeUsd: entry.amount,
        quotePrice: null,
        expectedOut: null,
        slippageBps: null,
        reason: decision.ok ? "dry_run" : decision.reason,
        simulated: "skipped" as const,
      });
      if (decision.ok && entry.amount !== null) {
        openCount += 1;
        spent += entry.amount;
      }
    }
    for (const close of result.closes) {
      const position = positions.find((item) => item.id === close.id);
      if (!position || position.arm === "random_pass" || close.reason === "unpriced") continue;
      intents.push({
        kind: "exit" as const,
        mint: position.mint,
        arm: position.arm,
        stage: position.stage,
        sizeUsd: position.entrySizeUsd ?? null,
        quotePrice: close.quote,
        expectedOut: null,
        slippageBps: close.impactPct === null ? null : Math.round(close.impactPct * 100),
        reason: close.reason,
        simulated: "skipped" as const,
      });
    }
    await input.store.saveAutobuyIntents(intents, input.now);
  }
  await input.store.saveMintCache(
    coins
      .filter(
        (coin) =>
          coin.mintAuthorityActive !== null ||
          coin.top10HoldersPct !== null ||
          coin.sniperBundlePct !== null ||
          (coin.graduatedAt === null && coin.liquidityUsd !== null) ||
          freshExit.has(coin.mint),
      )
      .map((coin) => ({
        mint: coin.mint,
        mintAuthorityActive: coin.mintAuthorityActive,
        freezeAuthorityActive: coin.freezeAuthorityActive,
        top10Pct: coin.top10HoldersPct,
        sniperPct: coin.sniperBundlePct,
        curveLiquidityUsd: coin.graduatedAt ? null : coin.liquidityUsd,
        exitImpactPct: freshExit.get(coin.mint) ?? null,
      })),
    input.now,
  );
  if ("blocked" in destination) {
    input.warn(destination.reason);
    return;
  }
  if (result.restart) await input.send("paper test restarted: config changed");
  else if (result.protocolViolation) {
    await input.send(`protocol violation: ${result.protocolViolation}`);
  }
  for (const text of result.immediate) await input.send(text);
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
    const tradable = await input.store.tradableCounts();
    const shadow = await input.store.scoreShadow();
    const autobuy =
      autobuyMode === "dry_run"
        ? { ...(await input.store.autobuyReview()), paperAlerts: result.paper.alerts }
        : undefined;
    if (result.paper.status === "go" || result.paper.status === "no_go") {
      await input.store.markPaperClosed();
    }
    const text = formatWeeklyReview({
      week,
      walletChanges: previous.length === 0 ? [] : addressDiff(previous, active),
      xChanges: config.xEnabled ? [] : ["X mention source is off"],
      promotionsWaiting: pending,
      paper: result.paper,
      autobuy,
      tradable,
      walletScore: shadow
        ? {
            scoringVersion: shadow.scoringVersion,
            lookbackStart: shadow.lookbackStart,
            lookbackEnd: shadow.lookbackEnd,
            entryCount: shadow.entryCount,
            cutoff: shadow.cutoff,
            rankedCount: shadow.rankedCount,
          }
        : undefined,
    });
    await input.store.saveWeekly(week, text, input.now);
    await input.store.replaceSnapshot(active);
    await input.send(text);
  }
}

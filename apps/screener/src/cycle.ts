import {
  etDay,
  etDayRange,
  etWeekStart,
  formatWeeklyReview,
  inQuietHours,
  parseLockedConfig,
  phaseCConfigFromEnv,
  resolveAlertChat,
  runPhaseCPass,
  screenRulesFromThresholds,
  type Env,
  type MarketQuote,
  type PhaseCStore,
  type Thresholds,
} from "@fomo/core";

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
}): Promise<void> {
  const config = phaseCConfigFromEnv(input.env, input.thresholds);
  const stored = await input.store.protocol();
  const day = etDayRange(input.now);
  const coins = await input.store.coins(50);
  if (config.xEnabled) {
    const counts = await input.store.mentionCounts(coins.map((coin) => coin.mint));
    for (const coin of coins) coin.xMentions = counts.get(coin.mint) ?? 0;
  }
  const result = runPhaseCPass({
    now: input.now,
    config,
    rules: screenRulesFromThresholds(input.thresholds),
    locked: stored
      ? { fingerprint: stored.fingerprint, config: parseLockedConfig(stored.body) }
      : null,
    coins,
    quotes: [...input.quotes],
    positions: await input.store.positions(),
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
  });
  if (result.retuneBlocked) input.warn("phase C config change ignored until this paper test ends");
  if (result.lock) {
    await input.store.saveProtocol(result.lock.fingerprint, result.lock.body, input.now);
  }
  if (result.pauseReason) await input.store.pause(etDay(input.now), result.pauseReason, input.now);
  for (const open of result.opens) await input.store.openPosition(open.id, open.quote, input.now);
  for (const close of result.closes) {
    await input.store.closePosition(close.id, close.quote, close.net, close.reason, input.now);
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

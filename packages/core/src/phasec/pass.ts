import { formatDigest, formatEntry, quietHold } from "./deliver.js";
import { planExit } from "./exit.js";
import type { MarketQuote } from "./market.js";
import {
  quotedNetReturn,
  evaluatePaper,
  type PaperEvaluation,
  type ResolvedReturn,
} from "./paper.js";
import {
  protocolBody,
  protocolFingerprint,
  EXIT_PLAN,
  type PaperArm,
  type PhaseCConfig,
  type Stage,
} from "./protocol.js";
import {
  bankrollLossPct,
  entryDecision,
  exitPlanText,
  planTierPromotions,
  shouldPauseDay,
  sizeForStage,
  type TierWallet,
} from "./risk.js";
import { assignArm, scoreStrength, stageForCoin, type ScoreCoin } from "./score.js";
import { screenCoin, type ScreenFacts, type ScreenRules } from "./screen.js";
import { inQuietHours } from "./time.js";

export interface PassCoin extends ScoreCoin {
  transferFeeBps: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  exitQuoteImpactPct: number | null;
  top10HoldersPct: number | null;
  sniperBundlePct: number | null;
  uniqueMakers1h: number | null;
  creatorSells: number;
  quoteError: boolean;
}

export interface PassPosition {
  id: string;
  mint: string;
  stage: Stage;
  arm: PaperArm;
  status: "pending" | "open";
  alertAt: Date;
  entryAfter: Date;
  openedAt: Date | null;
  entryQuote: number | null;
  sizePct: number;
  exitPlan: string;
  screenFailed: boolean;
}

export interface PassInput {
  now: Date;
  config: PhaseCConfig;
  rules: ScreenRules;
  locked: { fingerprint: string; config: PhaseCConfig } | null;
  coins: PassCoin[];
  quotes: MarketQuote[];
  positions: PassPosition[];
  closedToday: readonly { sizePct: number; netReturn: number }[];
  paused: boolean;
  resolved: readonly ResolvedReturn[];
  alerted: readonly { mint: string; stage: Stage }[];
  held: readonly { id: string; text: string }[];
  recentEntryCount: number;
  wallets: readonly TierWallet[];
  pendingTiers: readonly string[];
  registeredAt: Date | null;
}

export interface PlannedEntry {
  mint: string;
  stage: Stage;
  arm: PaperArm;
  sizePct: number;
  amount: number | null;
  strength: number;
  exitPlan: string;
  text: string;
  held: boolean;
  entryAfter: Date;
}

export interface PlannedClose {
  id: string;
  reason: "invalidation" | "stop" | "horizon";
  quote: number;
  net: number;
  text: string;
}

export interface PassResult {
  config: PhaseCConfig;
  retuneBlocked: boolean;
  lock: { fingerprint: string; body: string } | null;
  pauseReason: string | null;
  entries: PlannedEntry[];
  opens: Array<{ id: string; quote: number }>;
  closes: PlannedClose[];
  immediate: string[];
  digest: string | null;
  digestIds: string[];
  tierRequests: Array<{ wallet: string; from: "base"; to: "high"; text: string; held: boolean }>;
  paper: PaperEvaluation;
}

function blankCoin(mint: string, now: Date, quote: MarketQuote, xEnabled: boolean): PassCoin {
  return {
    mint,
    createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    graduatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    curveCompletedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    trackedBuyers: 0,
    xMentions: xEnabled ? 0 : null,
    liquidityUsd: quote.liquidityUsd,
    transferFeeBps: null,
    mintAuthorityActive: null,
    freezeAuthorityActive: null,
    exitQuoteImpactPct: null,
    top10HoldersPct: null,
    sniperBundlePct: null,
    uniqueMakers1h: null,
    creatorSells: 0,
    quoteError: false,
  };
}

export function runPhaseCPass(input: PassInput): PassResult {
  const currentBody = protocolBody(input.config);
  const currentFingerprint = protocolFingerprint(currentBody);
  const retuneBlocked = input.locked !== null && input.locked.fingerprint !== currentFingerprint;
  const config = input.locked?.config ?? input.config;
  const lock =
    input.locked === null
      ? { fingerprint: currentFingerprint, body: JSON.stringify(input.config) }
      : null;
  const quotes = new Map(input.quotes.map((quote) => [quote.mint, quote]));
  const known = new Set(input.coins.map((coin) => coin.mint));
  const coins = [...input.coins];
  for (const quote of input.quotes) {
    if (known.has(quote.mint)) continue;
    if ((quote.priceChange1hPct ?? 0) < config.secondWaveMinChangePct) continue;
    coins.push(blankCoin(quote.mint, input.now, quote, config.xEnabled));
  }

  const failedMints = new Set<string>();
  for (const coin of coins) {
    const quote = quotes.get(coin.mint) ?? null;
    const screen = screenCoin(
      {
        mintAuthorityActive: coin.mintAuthorityActive,
        freezeAuthorityActive: coin.freezeAuthorityActive,
        transferFeeBps: coin.transferFeeBps,
        exitQuoteImpactPct: coin.exitQuoteImpactPct,
        top10HoldersPct: coin.top10HoldersPct,
        sniperBundlePct: coin.sniperBundlePct,
        liquidityUsd: coin.liquidityUsd ?? quote?.liquidityUsd ?? null,
        uniqueMakers1h: coin.uniqueMakers1h,
        creatorSells: coin.creatorSells,
        quoteError: coin.quoteError,
      },
      input.rules,
    );
    if (screen.verdict === "fail") failedMints.add(coin.mint);
  }

  const opens: PassResult["opens"] = [];
  const openIds = new Set<string>();
  for (const position of input.positions) {
    if (position.status !== "pending") continue;
    if (input.now.getTime() < position.entryAfter.getTime()) continue;
    const quote = quotes.get(position.mint);
    if (!quote) continue;
    opens.push({ id: position.id, quote: quote.priceUsd });
    openIds.add(position.id);
  }

  const closes: PlannedClose[] = [];
  const immediate: string[] = [];
  const closedIds = new Set<string>();
  for (const position of input.positions) {
    const openedAt = position.openedAt ?? (openIds.has(position.id) ? input.now : null);
    const entryQuote = position.entryQuote ?? quotes.get(position.mint)?.priceUsd ?? null;
    if (position.status === "pending" && !openIds.has(position.id)) continue;
    if (!openedAt || entryQuote === null) continue;
    const latest = quotes.get(position.mint)?.priceUsd ?? null;
    const decision = planExit({
      openedAt,
      now: input.now,
      entryQuote,
      latestQuote: latest,
      stopPct: config.exitStopPct,
      horizonMs: config.horizonMs,
      screenFailed: position.screenFailed || failedMints.has(position.mint),
    });
    if (!decision.exit || latest === null) continue;
    const net = quotedNetReturn(entryQuote, latest, config.feeBps, config.slippageBps);
    if (net === null) continue;
    const text = `exit ${decision.reason} ${position.mint} net ${net.toFixed(4)}`;
    closes.push({ id: position.id, reason: decision.reason, quote: latest, net, text });
    closedIds.add(position.id);
    immediate.push(text);
  }

  const lossPct = bankrollLossPct([
    ...input.closedToday,
    ...closes.map((row) => {
      const position = input.positions.find((item) => item.id === row.id);
      return { sizePct: position?.sizePct ?? 0, netReturn: row.net };
    }),
  ]);
  const pauseNow = !input.paused && shouldPauseDay(lossPct, config.dailyLossCutoffPct);
  const paused = input.paused || pauseNow;
  if (pauseNow) {
    immediate.push(
      `alerts paused for the rest of the ET day: paper loss ${lossPct.toFixed(2)}% of bankroll`,
    );
  }

  let liveCount = input.positions.filter((position) => !closedIds.has(position.id)).length;
  const busy = new Set(
    input.positions
      .filter((position) => !closedIds.has(position.id))
      .map((position) => position.mint),
  );
  const seen = new Set(input.alerted.map((row) => `${row.mint}:${row.stage}`));
  const entries: PlannedEntry[] = [];
  let recent = input.recentEntryCount;
  for (const coin of coins) {
    const quote = quotes.get(coin.mint) ?? null;
    const stage = stageForCoin(coin, input.now, quote, config);
    if (!stage || seen.has(`${coin.mint}:${stage}`)) continue;
    const facts: ScreenFacts = {
      mintAuthorityActive: coin.mintAuthorityActive,
      freezeAuthorityActive: coin.freezeAuthorityActive,
      transferFeeBps: coin.transferFeeBps,
      exitQuoteImpactPct: coin.exitQuoteImpactPct,
      top10HoldersPct: coin.top10HoldersPct,
      sniperBundlePct: coin.sniperBundlePct,
      liquidityUsd: coin.liquidityUsd ?? quote?.liquidityUsd ?? null,
      uniqueMakers1h: coin.uniqueMakers1h,
      creatorSells: coin.creatorSells,
      quoteError: coin.quoteError,
    };
    const screen = screenCoin(facts, input.rules);
    if (screen.verdict !== "pass") continue;
    const arm = assignArm(coin.mint, stage, coin.trackedBuyers);
    const strength = scoreStrength(stage, { ...coin, liquidityUsd: facts.liquidityUsd });
    const size = sizeForStage(stage, config.sizePct, config.bankroll);
    const decision = entryDecision({
      openCount: liveCount,
      maxConcurrent: config.maxConcurrent,
      mintBusy: busy.has(coin.mint),
      exitPlan: exitPlanText(),
      paused,
    });
    if (!decision.ok) continue;
    if (recent >= config.maxPerHour) continue;
    const text = formatEntry({
      stage,
      arm,
      mint: coin.mint,
      sizePct: size.pct,
      bankroll: config.bankroll,
      strength,
      exitPlan: EXIT_PLAN,
      warnings: screen.warnings,
    });
    const held = quietHold({
      now: input.now,
      quietHours: config.quietHours,
      kind: "entry",
      stage,
      strength,
      sizePct: size.pct,
      minStrength: config.quietPostGradMinStrength,
      minSizePct: config.quietPostGradMinSizePct,
    });
    entries.push({
      mint: coin.mint,
      stage,
      arm,
      sizePct: size.pct,
      amount: size.amount,
      strength,
      exitPlan: EXIT_PLAN,
      text,
      held,
      entryAfter: new Date(input.now.getTime() + config.entryDelaySec * 1000),
    });
    if (!held) immediate.push(text);
    busy.add(coin.mint);
    seen.add(`${coin.mint}:${stage}`);
    liveCount += 1;
    recent += 1;
  }

  const quiet = inQuietHours(input.now, config.quietHours);
  const digest =
    !quiet && input.held.length > 0 ? formatDigest(input.held.map((row) => row.text)) : null;
  const tierRequests = planTierPromotions(
    input.wallets,
    config.promoteRate,
    new Set(input.pendingTiers),
  ).map((request) => {
    const text = `tier approval needed ${request.wallet} base to high`;
    const held = quietHold({
      now: input.now,
      quietHours: config.quietHours,
      kind: "tier",
      stage: null,
      strength: 0,
      sizePct: 0,
      minStrength: config.quietPostGradMinStrength,
      minSizePct: config.quietPostGradMinSizePct,
    });
    if (!held) immediate.push(text);
    return { ...request, text, held };
  });

  const paper = evaluatePaper({
    registeredAt: input.registeredAt ?? input.now,
    now: input.now,
    windowDays: config.paperWindowDays,
    minAlerts: config.paperMinAlerts,
    maxDrawdownPct: config.paperMaxDrawdownPct,
    returns: [
      ...input.resolved,
      ...closes.map((row) => {
        const position = input.positions.find((item) => item.id === row.id);
        return {
          at: input.now,
          arm: position?.arm ?? "screen_only",
          net: row.net,
        };
      }),
    ],
  });

  return {
    config,
    retuneBlocked,
    lock,
    pauseReason: pauseNow ? `paper loss ${lossPct.toFixed(2)}% of bankroll` : null,
    entries,
    opens,
    closes,
    immediate,
    digest,
    digestIds: digest === null ? [] : input.held.map((row) => row.id),
    tierRequests,
    paper,
  };
}

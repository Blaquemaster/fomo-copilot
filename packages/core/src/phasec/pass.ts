import { formatDigest, formatEntry, quietHold } from "./deliver.js";
import { planExit } from "./exit.js";
import type { MarketQuote } from "./market.js";
import { evaluatePaper, type PaperEvaluation, type ResolvedReturn } from "./paper.js";
import {
  assignExitTreatment,
  protocolBody,
  protocolFingerprint,
  EXIT_PLAN,
  type PaperArm,
  type PhaseCConfig,
  type Stage,
} from "./protocol.js";
import {
  FULL_LOSS,
  bookScaleHalf,
  fomoFeeUsd,
  quoteKey,
  quotedRoundTrip,
  roundTripFomoFee,
  scaleOutRoundTrip,
  stageSizeUsd,
  type QuoteSource,
  type ScaleHalfBooking,
  type SizeBid,
  type StoredScaleHalf,
} from "./quote.js";
import {
  bankrollLossPct,
  entryDecision,
  exitPlanText,
  planTierPromotions,
  shouldPauseDay,
  sizeForStage,
  type TierWallet,
} from "./risk.js";
import { assignArm, isFlapMint, scoreStrength, stageForCoin, type ScoreCoin } from "./score.js";
import {
  allowsEntry,
  screenCoin,
  sniperIsFetchable,
  type ScreenFacts,
  type ScreenRules,
} from "./screen.js";
import { inQuietHours, nextEtMidnight } from "./time.js";

export interface PassCoin extends ScoreCoin {
  transferFeeBps: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  exitQuoteImpactPct: number | null;
  top10HoldersPct: number | null;
  sniperBundlePct: number | null;
  uniqueMakers1h: number | null;
  creatorSells: number;
  trackedSells?: number;
  quoteError: boolean;
  bondingCurve?: string | null;
  poolType?: string | null;
  createdSlot?: number | null;
  quoteSource?: "jupiter" | "curve_modeled";
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
  entrySizeUsd?: number | null;
  entryFeeUsd?: number | null;
  entryInAmount?: string | null;
  entryOutAmount?: string | null;
  scaledAt?: Date | null;
  scaleQuote?: number | null;
  scaleImpactPct?: number | null;
  scaleProceedsUsd?: number | null;
  scaleFeeUsd?: number | null;
  sellWarned?: boolean;
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
  /** Jupiter bids keyed by quoteKey(mint, purpose, size). Purposes do not share a slot. */
  bids?: Readonly<Record<string, SizeBid>>;
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
  entriesStartAt?: Date | null;
  expectedAlerts?: number | null;
}

export interface PlannedEntry {
  mint: string;
  stage: Stage;
  arm: PaperArm;
  sizePct: number;
  amount: number | null;
  strength: number;
  exitPlan: string;
  treatment: string;
  text: string;
  held: boolean;
  heldReason: "quiet" | "control" | null;
  fingerprint: string;
  sniperUnmeasured: boolean;
  entryAfter: Date;
}

export interface PlannedOpen {
  id: string;
  quote: number;
  impactPct: number;
  feeUsd: number;
  sizeUsd: number;
  outAmount: string;
  fomoFeeUsd: number;
  quoteSource: QuoteSource;
}

export interface PlannedScale extends ScaleHalfBooking {
  id: string;
}

export interface PlannedClose {
  id: string;
  reason: "invalidation" | "stop" | "horizon" | "dead" | "unpriced";
  quote: number;
  net: number;
  net2x: number;
  impactPct: number | null;
  feeUsd: number | null;
  failure: string | null;
  fomoFeeUsd: number;
  quoteSource: QuoteSource | null;
  text: string;
}

export interface PassResult {
  config: PhaseCConfig;
  retuneBlocked: boolean;
  protocolViolation: string | null;
  lock: { fingerprint: string; body: string } | null;
  pauseReason: string | null;
  entries: PlannedEntry[];
  opens: PlannedOpen[];
  closes: PlannedClose[];
  immediate: string[];
  digest: string | null;
  digestIds: string[];
  tierRequests: Array<{ wallet: string; from: "base"; to: "high"; text: string; held: boolean }>;
  paper: PaperEvaluation;
  sellWarnings: string[];
  scaled: PlannedScale[];
  restart: boolean;
}

function sizeFor(config: PhaseCConfig, sizePct: number): number {
  return stageSizeUsd(config.bankroll, sizePct) ?? sizePct;
}

function isDead(bid: SizeBid): boolean {
  return !bid.ok && (bid.reason === "no_liquidity" || bid.reason === "no_route");
}

function bidFor(
  mint: string,
  bids: PassInput["bids"],
  purpose: "entry" | "exit",
  size: "1x" | "2x",
): SizeBid {
  return bids?.[quoteKey(mint, purpose, size)] ?? { ok: false, reason: "no_quote" };
}

function entryBid(position: PassPosition, fallbackSize: number): SizeBid {
  if (!(position.entryQuote !== null && position.entryQuote > 0)) {
    return { ok: false, reason: "no_quote" };
  }
  return {
    ok: true,
    execPriceUsd: position.entryQuote,
    midPriceUsd: position.entryQuote,
    impactPct: 0,
    feeUsd: position.entryFeeUsd ?? 0,
    sizeUsd: position.entrySizeUsd ?? fallbackSize,
    liquidityUsd: 1,
    inAmount: position.entryInAmount ?? "0",
    outAmount: position.entryOutAmount ?? "0",
  };
}

function screenOf(coin: PassCoin, liquidity: number | null, rules: ScreenRules) {
  const facts: ScreenFacts = {
    mintAuthorityActive: coin.mintAuthorityActive,
    freezeAuthorityActive: coin.freezeAuthorityActive,
    transferFeeBps: coin.transferFeeBps,
    exitQuoteImpactPct: coin.exitQuoteImpactPct,
    top10HoldersPct: coin.top10HoldersPct,
    sniperBundlePct: coin.sniperBundlePct,
    liquidityUsd: coin.liquidityUsd ?? liquidity,
    uniqueMakers1h: coin.uniqueMakers1h,
    creatorSells: coin.creatorSells,
    quoteError: coin.quoteError,
    sniperFetchable: sniperIsFetchable(coin),
  };
  return screenCoin(facts, rules);
}

export function runPhaseCPass(input: PassInput): PassResult {
  const currentBody = protocolBody(input.config, input.rules);
  const currentFingerprint = protocolFingerprint(currentBody);
  const registering = input.locked === null;
  const restart = input.locked !== null && input.locked.fingerprint !== currentFingerprint;
  const protocolViolation = restart ? "config changed after registration" : null;
  const config = restart ? input.config : (input.locked?.config ?? input.config);
  const entriesStart = restart ? nextEtMidnight(input.now) : (input.entriesStartAt ?? null);
  const lock =
    registering || restart
      ? {
          fingerprint: currentFingerprint,
          body: JSON.stringify({
            config: input.config,
            rules: input.rules,
            entriesStartAt: entriesStart?.toISOString() ?? null,
            expectedAlerts: input.expectedAlerts ?? null,
          }),
        }
      : null;
  const started = entriesStart === null || input.now.getTime() >= entriesStart.getTime();
  const allowEntries = !registering && !restart && started;
  const quotes = new Map(input.quotes.map((quote) => [quote.mint, quote]));
  const coins = input.coins;

  const failedMints = new Set<string>();
  for (const coin of coins) {
    const screen = screenOf(coin, quotes.get(coin.mint)?.liquidityUsd ?? null, input.rules);
    if (screen.verdict === "fail") failedMints.add(coin.mint);
  }

  const sellWarnings: string[] = [];
  const scaled: PlannedScale[] = [];
  const opens: PlannedOpen[] = [];
  const openIds = new Set<string>();
  const closes: PlannedClose[] = [];
  const immediate: string[] = [];
  const closedIds = new Set<string>();

  for (const position of input.positions) {
    if (position.status !== "pending") continue;
    const due = input.now.getTime() >= position.entryAfter.getTime();
    const expired = input.now.getTime() >= position.entryAfter.getTime() + config.horizonMs;
    if (!due) continue;
    const one = bidFor(position.mint, input.bids, "entry", "1x");
    if (one.ok && one.liquidityUsd !== 0) {
      opens.push({
        id: position.id,
        quote: one.execPriceUsd,
        impactPct: one.impactPct,
        feeUsd: one.feeUsd,
        sizeUsd: one.sizeUsd,
        outAmount: one.outAmount,
        fomoFeeUsd: fomoFeeUsd(one.sizeUsd, config.fomoFeeSchedule),
        quoteSource: one.source ?? "jupiter",
      });
      openIds.add(position.id);
      continue;
    }
    if (isDead(one)) {
      closes.push({
        id: position.id,
        reason: "dead",
        quote: 0,
        net: FULL_LOSS,
        net2x: FULL_LOSS,
        impactPct: null,
        feeUsd: null,
        failure: one.ok ? "no_liquidity" : one.reason,
        fomoFeeUsd: 0,
        quoteSource: one.ok ? (one.source ?? "jupiter") : null,
        text: `exit dead ${position.mint} net ${FULL_LOSS.toFixed(4)} 1x and 2x`,
      });
      closedIds.add(position.id);
      immediate.push(`exit dead ${position.mint} full loss`);
      continue;
    }
    if (expired) {
      closes.push({
        id: position.id,
        reason: "unpriced",
        quote: 0,
        net: 0,
        net2x: 0,
        impactPct: null,
        feeUsd: null,
        failure: one.ok ? "no_liquidity" : one.reason,
        fomoFeeUsd: 0,
        quoteSource: null,
        text: `unpriced ${position.mint} excluded`,
      });
      closedIds.add(position.id);
    }
  }

  for (const position of input.positions) {
    if (closedIds.has(position.id)) continue;
    const openedAt = position.openedAt ?? (openIds.has(position.id) ? input.now : null);
    if (position.status === "pending" && !openIds.has(position.id)) continue;
    if (!openedAt) continue;
    const entry = entryBid(position, sizeFor(config, position.sizePct));
    const exitOne = bidFor(position.mint, input.bids, "exit", "1x");
    const exitTwo = bidFor(position.mint, input.bids, "exit", "2x");
    const latest = exitOne.ok ? exitOne.execPriceUsd : null;
    const horizonReached = input.now.getTime() >= openedAt.getTime() + config.horizonMs;
    const treatment = assignExitTreatment(position.mint);
    let storedHalf: StoredScaleHalf | null =
      position.scaleProceedsUsd !== null && position.scaleProceedsUsd !== undefined
        ? { proceedsUsd: position.scaleProceedsUsd }
        : null;
    if (treatment === "scale_out" && !position.scaledAt && entry.ok) {
      const halfBid = input.bids?.[quoteKey(position.mint, "scale", "1x")];
      const trigger =
        halfBid?.ok === true && halfBid.execPriceUsd >= entry.execPriceUsd * 1.5
          ? halfBid
          : exitOne.ok && exitOne.execPriceUsd >= entry.execPriceUsd * 1.5
            ? exitOne
            : null;
      const booking = trigger ? bookScaleHalf(entry, trigger, config.fomoFeeSchedule) : null;
      if (booking) {
        storedHalf = { proceedsUsd: booking.proceedsUsd };
        position.scaledAt = input.now;
        position.scaleQuote = booking.quote;
        position.scaleImpactPct = booking.impactPct;
        position.scaleProceedsUsd = booking.proceedsUsd;
        position.scaleFeeUsd = booking.feeUsd;
        scaled.push({ id: position.id, ...booking });
        immediate.push(
          `scale-out ${position.mint} half at ${booking.quote.toString()} impact ${booking.impactPct.toFixed(2)}%`,
        );
      }
    }
    if (isDead(exitOne)) {
      const net = storedHalf
        ? scaleOutRoundTrip(entry, exitOne, config.fomoFeeSchedule, storedHalf)
        : FULL_LOSS;
      const net2x = storedHalf
        ? scaleOutRoundTrip(entry, exitTwo, config.fomoFeeSchedule, storedHalf)
        : FULL_LOSS;
      closes.push({
        id: position.id,
        reason: "dead",
        quote: 0,
        net,
        net2x,
        impactPct: null,
        feeUsd: null,
        failure: exitOne.ok ? "no_liquidity" : exitOne.reason,
        fomoFeeUsd: 0,
        quoteSource: exitOne.ok ? (exitOne.source ?? "jupiter") : null,
        text: `exit dead ${position.mint} net ${net.toFixed(4)} 1x and 2x`,
      });
      closedIds.add(position.id);
      immediate.push(
        storedHalf
          ? `exit dead ${position.mint} unsold half lost, scaled half kept`
          : `exit dead ${position.mint} full loss`,
      );
      continue;
    }
    if (!exitOne.ok && horizonReached) {
      const net = storedHalf
        ? scaleOutRoundTrip(entry, exitOne, config.fomoFeeSchedule, storedHalf)
        : 0;
      closes.push({
        id: position.id,
        reason: "unpriced",
        quote: 0,
        net,
        net2x: storedHalf
          ? scaleOutRoundTrip(entry, exitTwo, config.fomoFeeSchedule, storedHalf)
          : 0,
        impactPct: null,
        feeUsd: null,
        failure: exitOne.reason,
        fomoFeeUsd: 0,
        quoteSource: null,
        text: storedHalf
          ? `unpriced ${position.mint} unsold half, scaled half kept`
          : `unpriced ${position.mint} excluded`,
      });
      closedIds.add(position.id);
      continue;
    }
    const decision = planExit({
      openedAt,
      now: input.now,
      entryQuote: entry.ok ? entry.execPriceUsd : 0,
      latestQuote: latest,
      stopPct: config.exitStopPct,
      horizonMs: config.horizonMs,
      screenFailed: position.screenFailed || failedMints.has(position.mint),
    });
    if (!decision.exit || latest === null) continue;
    const net =
      treatment === "scale_out"
        ? scaleOutRoundTrip(entry, exitOne, config.fomoFeeSchedule, storedHalf)
        : quotedRoundTrip(entry, exitOne, config.fomoFeeSchedule);
    const net2x =
      treatment === "scale_out"
        ? scaleOutRoundTrip(entry, exitTwo, config.fomoFeeSchedule, storedHalf)
        : quotedRoundTrip(entry, exitTwo, config.fomoFeeSchedule);
    const text = `exit ${decision.reason} ${position.mint} ${treatment} net1x ${net.toFixed(4)} net2x ${net2x.toFixed(4)}`;
    closes.push({
      id: position.id,
      reason: decision.reason,
      quote: latest,
      net,
      net2x,
      impactPct: exitOne.ok ? exitOne.impactPct : null,
      feeUsd: exitOne.ok ? exitOne.feeUsd : null,
      failure: null,
      fomoFeeUsd: roundTripFomoFee(entry, exitOne, config.fomoFeeSchedule),
      quoteSource: exitOne.ok ? (exitOne.source ?? "jupiter") : null,
      text,
    });
    closedIds.add(position.id);
    immediate.push(text);
  }

  for (const position of input.positions) {
    if (position.status !== "open" || closedIds.has(position.id)) continue;
    const coin = coins.find((item) => item.mint === position.mint);
    if (!position.sellWarned && coin && (coin.creatorSells > 0 || (coin.trackedSells ?? 0) > 0)) {
      immediate.push(`exit warning ${position.mint} tracked wallet or creator sold`);
      sellWarnings.push(position.id);
      position.sellWarned = true;
    }
  }

  const lossPct = bankrollLossPct([
    ...input.closedToday,
    ...closes.flatMap((row) => {
      const position = input.positions.find((item) => item.id === row.id);
      if (position?.arm === "random_pass") return [];
      return [{ sizePct: position?.sizePct ?? 0, netReturn: row.net }];
    }),
  ]);
  const pauseNow = !input.paused && shouldPauseDay(lossPct, config.dailyLossCutoffPct);
  const paused = input.paused || pauseNow;
  if (pauseNow) {
    immediate.push(
      `alerts paused for the rest of the ET day: paper loss ${lossPct.toFixed(2)}% of bankroll`,
    );
  }

  let liveCount = input.positions.filter(
    (position) => !closedIds.has(position.id) && position.arm !== "random_pass",
  ).length;
  const busy = new Set(
    input.positions
      .filter((position) => !closedIds.has(position.id))
      .map((position) => position.mint),
  );
  const seen = new Set(input.alerted.map((row) => `${row.mint}:${row.stage}`));
  const entries: PlannedEntry[] = [];
  let recent = input.recentEntryCount;
  if (allowEntries) {
    for (const coin of coins) {
      if (isFlapMint(coin.mint)) continue;
      const stage = stageForCoin(coin, input.now);
      if (!stage || seen.has(`${coin.mint}:${stage}`)) continue;
      const screen = screenOf(coin, quotes.get(coin.mint)?.liquidityUsd ?? null, input.rules);
      if (screen.verdict === "fail") continue;
      const arm = assignArm(coin.mint, stage, coin.trackedBuyers, coin.xMentions);
      if (!allowsEntry(screen, arm)) continue;
      if (
        stage === "trench" &&
        arm !== "random_pass" &&
        coin.trackedBuyers < (input.rules.trenchMinTrackedBuyers ?? 0)
      ) {
        continue;
      }
      const strength = scoreStrength(stage, coin);
      const size = sizeForStage(stage, config.sizePct, config.bankroll);
      const treatment = assignExitTreatment(coin.mint);
      const control = arm === "random_pass";
      const decision = control
        ? { ok: true as const }
        : entryDecision({
            openCount: liveCount,
            maxConcurrent: config.maxConcurrent,
            mintBusy: busy.has(coin.mint),
            exitPlan: exitPlanText(),
            paused,
          });
      if (!decision.ok || (!control && recent >= config.maxPerHour)) continue;
      if (busy.has(coin.mint)) continue;
      const text = formatEntry({
        stage,
        arm,
        mint: coin.mint,
        sizePct: size.pct,
        bankroll: config.bankroll,
        strength,
        exitPlan: `${EXIT_PLAN}; treatment ${treatment}`,
        warnings: screen.warnings,
        fingerprint: currentFingerprint,
        quoteSource: coin.quoteSource ?? null,
      });
      const quiet = quietHold({
        now: input.now,
        quietHours: config.quietHours,
        kind: "entry",
        stage,
        strength,
        sizePct: size.pct,
        minStrength: config.quietPostGradMinStrength,
        minSizePct: config.quietPostGradMinSizePct,
      });
      const held = control || quiet;
      entries.push({
        mint: coin.mint,
        stage,
        arm,
        sizePct: size.pct,
        amount: size.amount,
        strength,
        exitPlan: EXIT_PLAN,
        treatment,
        text,
        held,
        heldReason: control ? "control" : quiet ? "quiet" : null,
        fingerprint: currentFingerprint,
        sniperUnmeasured: screen.sniperUnmeasured,
        entryAfter: new Date(input.now.getTime() + config.entryDelaySec * 1000),
      });
      if (!held) immediate.push(text);
      busy.add(coin.mint);
      seen.add(`${coin.mint}:${stage}`);
      if (!control) {
        liveCount += 1;
        recent += 1;
      }
    }
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
    if (!held && allowEntries) immediate.push(text);
    return { ...request, text, held };
  });

  const paper = evaluatePaper({
    // The window runs from the first allowed entry, not from registration, so a test that
    // registers mid-day and starts at the next ET midnight still gets its full window.
    registeredAt: input.entriesStartAt ?? input.registeredAt ?? input.now,
    now: input.now,
    windowDays: config.paperWindowDays,
    minAlerts: config.paperMinAlerts,
    maxDrawdownPct: config.paperMaxDrawdownPct,
    expectedAlerts: input.expectedAlerts ?? null,
    returns: [
      ...input.resolved,
      ...closes.flatMap((row) => {
        if (row.reason === "unpriced") return [];
        const position = input.positions.find((item) => item.id === row.id);
        return [
          {
            at: input.now,
            arm: position?.arm ?? "screen_only",
            net: row.net,
            sizePct: position?.sizePct ?? 0,
          },
        ];
      }),
    ],
  });

  return {
    config,
    retuneBlocked: protocolViolation !== null,
    protocolViolation,
    lock,
    pauseReason: pauseNow ? `paper loss ${lossPct.toFixed(2)}% of bankroll` : null,
    entries,
    opens,
    closes,
    immediate: immediate.filter((line) => !/0x[0-9a-f]/i.test(line)),
    digest,
    digestIds: digest === null ? [] : input.held.map((row) => row.id),
    tierRequests,
    paper,
    sellWarnings,
    scaled,
    restart,
  };
}

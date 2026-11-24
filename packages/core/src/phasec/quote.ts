/** Quote-only bids. Costs come from the quote, not from a fixed fee or slippage constant. */

export type QuoteSource = "jupiter" | "curve_modeled";

export interface SizeBidOk {
  ok: true;
  execPriceUsd: number;
  midPriceUsd: number;
  impactPct: number;
  feeUsd: number;
  sizeUsd: number;
  liquidityUsd: number | null;
  inAmount: string;
  outAmount: string;
  source?: QuoteSource;
}

export interface SizeBidFail {
  ok: false;
  reason:
    | "no_liquidity"
    | "no_route"
    | "no_quote"
    | "rate_limited"
    | "transient"
    | "http_400"
    | "http_404"
    | "api_error";
  /** Raw Jupiter status. Absent when the request never got an HTTP response. */
  httpStatus?: number | null;
  /** Truncated, redacted response body. Absent on a transport failure. */
  errorBody?: string | null;
}

export type SizeBid = SizeBidOk | SizeBidFail;

export const FULL_LOSS = -1;
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Stay under 80% of the keyless 30/min limit, or 80% of 60 with a key. */
export function jupiterRatePerMin(hasApiKey: boolean): number {
  return hasApiKey ? 48 : 24;
}

export type QuotePurpose = "screen" | "entry" | "exit" | "scale" | "probe";

export function quoteKey(mint: string, purpose: QuotePurpose, size: "1x" | "2x"): string {
  return `${mint}|${purpose}|${size}`;
}

export function lamportsForUsd(sizeUsd: number, solPriceUsd: number): string | null {
  if (!(sizeUsd > 0) || !(solPriceUsd > 0)) return null;
  return Math.round((sizeUsd / solPriceUsd) * 1_000_000_000).toString();
}

export function jupiterQuoteUrl(inputMint: string, outputMint: string, amount: string): string {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    swapMode: "ExactIn",
  });
  return `${JUPITER_QUOTE_URL}?${params.toString()}`;
}

export function impactPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const abs = Math.abs(raw);
  return abs <= 1 ? abs * 100 : abs;
}

export function classifyJupiterHttp(status: number): SizeBidFail["reason"] | "ok" {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient";
  if (status === 400) return "http_400";
  if (status === 404) return "http_404";
  if (status >= 400 && status < 500) return "api_error";
  if (status >= 200 && status < 300) return "ok";
  return "transient";
}

/** Keep a failed quote body small and free of credentials. */
export function quoteErrorBody(body: string, limit = 512): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
}

/** Jupiter /swap/v1/quote body. The request is quote-only. */
export function parseJupiterQuote(
  body: unknown,
  input: number | { sizeUsd: number; side?: "buy" | "sell"; solPriceUsd?: number },
): SizeBid {
  const sizeUsd = typeof input === "number" ? input : input.sizeUsd;
  const side = typeof input === "number" ? "buy" : (input.side ?? "buy");
  const solPriceUsd = typeof input === "number" ? 0 : (input.solPriceUsd ?? 0);
  if (!body || typeof body !== "object") return { ok: false, reason: "transient" };
  const record = body as Record<string, unknown>;
  const inAmount = Number(record["inAmount"]);
  const outAmount = Number(record["outAmount"]);
  if (!(inAmount > 0) || !(outAmount > 0) || !(sizeUsd > 0)) {
    return { ok: false, reason: "no_quote" };
  }
  const routes = record["routePlan"];
  if (Array.isArray(routes) && routes.length === 0) return { ok: false, reason: "no_route" };
  const errorText = typeof record["error"] === "string" ? record["error"].toLowerCase() : "";
  if (errorText.includes("liquidity")) return { ok: false, reason: "no_liquidity" };
  if (errorText.includes("route")) return { ok: false, reason: "no_route" };
  const impactPct = impactPercent(Number(record["priceImpactPct"]));
  let feeRaw = 0;
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (!route || typeof route !== "object") continue;
      const info = (route as { swapInfo?: { feeAmount?: unknown } }).swapInfo;
      const fee = Number(info?.feeAmount);
      if (Number.isFinite(fee) && fee > 0) feeRaw += fee;
    }
  }
  const feeUsd = (feeRaw / inAmount) * sizeUsd;
  const execPriceUsd =
    side === "sell" && solPriceUsd > 0
      ? ((outAmount / 1_000_000_000) * solPriceUsd) / inAmount
      : sizeUsd / outAmount;
  const midPriceUsd = impactPct > 0 ? execPriceUsd / (1 + impactPct / 100) : execPriceUsd;
  return {
    ok: true,
    execPriceUsd,
    midPriceUsd,
    impactPct,
    feeUsd,
    sizeUsd,
    liquidityUsd: side === "sell" ? liquidityFromSellImpact(sizeUsd, impactPct) : null,
    inAmount: String(record["inAmount"]),
    outAmount: String(record["outAmount"]),
  };
}

/**
 * Quote-side depth implied by a sell. A constant-product impact of `q / R`
 * puts the reserve near `size / impact`. Zero impact does not imply infinite depth.
 */
export function liquidityFromSellImpact(sizeUsd: number, impactPct: number): number | null {
  if (!(sizeUsd > 0) || !(impactPct > 0) || impactPct >= 100) return null;
  return sizeUsd / (impactPct / 100);
}

export function stageSizeUsd(bankroll: number | null, sizePct: number): number | null {
  if (bankroll === null || !(bankroll > 0) || !(sizePct > 0)) return null;
  return (bankroll * sizePct) / 100;
}

export type FomoFeeSchedule = "solana_lowest_fee" | "solana_other";

/**
 * FOMO's published Solana schedule. Lowest-fee route: 0.10 under $5,
 * 2% from $5 through $47.50, $0.95 from there through $190, 0.50% above that.
 * The brackets meet at the boundaries. Other routes are 0.50% with a $0.95 minimum.
 */
export function fomoFeeUsd(
  notionalUsd: number,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
): number {
  if (!(notionalUsd > 0)) return 0;
  if (schedule === "solana_other") return Math.max(0.95, notionalUsd * 0.005);
  if (notionalUsd < 5) return 0.1;
  if (notionalUsd <= 47.5) return notionalUsd * 0.02;
  if (notionalUsd <= 190) return 0.95;
  return notionalUsd * 0.005;
}

/** Jupiter fee stays in the quote. FOMO's fee is extra, on the entry notional and the exit proceeds. */
export function roundTripFomoFee(
  entry: SizeBid,
  exit: SizeBid,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
): number {
  if (!entry.ok || !exit.ok || !(entry.execPriceUsd > 0) || !(entry.sizeUsd > 0)) return 0;
  const tokens = (entry.sizeUsd - entry.feeUsd) / entry.execPriceUsd;
  if (!(tokens > 0) || !(exit.execPriceUsd > 0)) return 0;
  const proceeds = tokens * exit.execPriceUsd;
  return fomoFeeUsd(entry.sizeUsd, schedule) + fomoFeeUsd(proceeds, schedule);
}

/** Round trip at one size. A missing or empty exit is a full loss of that bid. */
export function quotedRoundTrip(
  entry: SizeBid,
  exit: SizeBid,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
): number {
  if (!entry.ok || !(entry.execPriceUsd > 0) || !(entry.sizeUsd > 0)) return FULL_LOSS;
  if (!exit.ok || exit.liquidityUsd === 0 || !(exit.execPriceUsd > 0)) return FULL_LOSS;
  const tokens = (entry.sizeUsd - entry.feeUsd) / entry.execPriceUsd;
  if (!(tokens > 0)) return FULL_LOSS;
  const proceeds =
    tokens * exit.execPriceUsd - exit.feeUsd - fomoFeeUsd(tokens * exit.execPriceUsd, schedule);
  const entryFee = fomoFeeUsd(entry.sizeUsd, schedule);
  return (proceeds - entryFee) / entry.sizeUsd - 1;
}

/** Half sold when scaledAt is set. Proceeds are net of that half's own fee. */
export interface StoredScaleHalf {
  proceedsUsd: number;
}

export interface ScaleHalfBooking {
  quote: number;
  impactPct: number;
  proceedsUsd: number;
  feeUsd: number;
}

/**
 * Book half the position at the trigger quote's own price.
 * The trigger is the sell that first reached +50%, not a synthetic 1.5x and not the later close.
 */
export function bookScaleHalf(
  entry: SizeBid,
  trigger: SizeBid,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
): ScaleHalfBooking | null {
  if (!entry.ok || !trigger.ok || !(entry.execPriceUsd > 0) || !(entry.sizeUsd > 0)) return null;
  if (!(trigger.execPriceUsd >= entry.execPriceUsd * 1.5)) return null;
  const half = entry.sizeUsd / 2;
  const feeRate = entry.sizeUsd > 0 ? entry.feeUsd / entry.sizeUsd : 0;
  const gross = half * (trigger.execPriceUsd / entry.execPriceUsd) - half * feeRate;
  const feeUsd = fomoFeeUsd(Math.max(0, gross), schedule);
  return {
    quote: trigger.execPriceUsd,
    impactPct: trigger.impactPct,
    proceedsUsd: gross - feeUsd,
    feeUsd,
  };
}

/**
 * Scale-out uses the half booked when scaledAt was set.
 * The other half uses the exit quote. A dead or missing exit loses only the unsold half.
 * With no stored half, the close is an ordinary round trip, even if the close itself is above +50%.
 */
export function scaleOutRoundTrip(
  entry: SizeBid,
  exit: SizeBid,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
  stored: StoredScaleHalf | null = null,
): number {
  if (!entry.ok || !(entry.execPriceUsd > 0) || !(entry.sizeUsd > 0)) return FULL_LOSS;
  if (!stored) return quotedRoundTrip(entry, exit, schedule);
  const entryFee = fomoFeeUsd(entry.sizeUsd, schedule);
  const scaled = stored.proceedsUsd;
  if (!exit.ok || exit.liquidityUsd === 0 || !(exit.execPriceUsd > 0)) {
    return (scaled - entry.sizeUsd - entryFee) / entry.sizeUsd;
  }
  const half = entry.sizeUsd / 2;
  const restTokens = half / entry.execPriceUsd;
  const restGross = restTokens * exit.execPriceUsd - exit.feeUsd / 2;
  const rest = restGross - fomoFeeUsd(Math.max(0, restGross), schedule);
  return (scaled + rest - entry.sizeUsd - entryFee) / entry.sizeUsd;
}

/**
 * Constant-product sell of a token amount against virtual reserves.
 * Used only when Jupiter has no route and the coin is still on a curve.
 * For Meteora DBC this is a rough reserve approximation. The pool prices from sqrt_price.
 */
export function modeledSellQuote(input: {
  virtualSolLamports: bigint;
  virtualTokenRaw: bigint;
  amountInRaw: bigint;
  solPriceUsd: number;
  sizeUsd: number;
}): SizeBid {
  if (
    !(input.solPriceUsd > 0) ||
    !(input.sizeUsd > 0) ||
    input.virtualSolLamports <= 0n ||
    input.virtualTokenRaw <= 0n ||
    input.amountInRaw <= 0n
  ) {
    return { ok: false, reason: "no_liquidity" };
  }
  const solIn = input.virtualSolLamports;
  const tokenIn = input.virtualTokenRaw;
  const amount = input.amountInRaw;
  const k = solIn * tokenIn;
  const newToken = tokenIn + amount;
  if (newToken <= 0n) return { ok: false, reason: "no_liquidity" };
  const newSol = k / newToken;
  const solOut = solIn - newSol;
  if (solOut <= 0n) return { ok: false, reason: "no_liquidity" };
  const execSolPerToken = Number(solOut) / Number(amount);
  const spotSolPerToken = Number(solIn) / Number(tokenIn);
  const execPriceUsd = execSolPerToken * input.solPriceUsd;
  const midPriceUsd = spotSolPerToken * input.solPriceUsd;
  if (!(execPriceUsd > 0) || !(midPriceUsd > 0)) return { ok: false, reason: "no_liquidity" };
  const impactPct = ((midPriceUsd - execPriceUsd) / midPriceUsd) * 100;
  return {
    ok: true,
    execPriceUsd,
    midPriceUsd,
    impactPct,
    feeUsd: 0,
    sizeUsd: input.sizeUsd,
    liquidityUsd: (Number(solIn) / 1_000_000_000) * input.solPriceUsd,
    inAmount: amount.toString(),
    outAmount: solOut.toString(),
    source: "curve_modeled",
  };
}

/** Follower result from a delayed mark to an exit mark. The wallet's own fill is not the entry. */
export function netFromDelayedMarks(
  delayedMarkUsd: number,
  exitMarkUsd: number,
  schedule: FomoFeeSchedule = "solana_lowest_fee",
): number | null {
  if (!(delayedMarkUsd > 0) || !(exitMarkUsd > 0)) return null;
  const notional = 100;
  const grossExit = notional * (exitMarkUsd / delayedMarkUsd);
  const proceeds = grossExit - fomoFeeUsd(grossExit, schedule) - fomoFeeUsd(notional, schedule);
  return proceeds / notional - 1;
}

/** Jupiter no_route on a curve coin becomes a labeled constant-product sell. Graduated coins stay Jupiter. */
export function curveFallbackBid(input: {
  bid: SizeBid | undefined;
  graduated: boolean;
  virtualSolLamports: bigint | null;
  virtualTokenRaw: bigint | null;
  amountInRaw: string;
  solPriceUsd: number;
  sizeUsd: number;
}): SizeBid | undefined {
  if (input.graduated || input.bid?.ok) return input.bid;
  if (input.bid && input.bid.reason !== "no_route") return input.bid;
  if (
    input.virtualSolLamports === null ||
    input.virtualTokenRaw === null ||
    !(input.solPriceUsd > 0)
  ) {
    return input.bid;
  }
  let amount: bigint;
  try {
    amount = BigInt(input.amountInRaw);
  } catch {
    return input.bid;
  }
  const modeled = modeledSellQuote({
    virtualSolLamports: input.virtualSolLamports,
    virtualTokenRaw: input.virtualTokenRaw,
    amountInRaw: amount,
    solPriceUsd: input.solPriceUsd,
    sizeUsd: input.sizeUsd,
  });
  return modeled.ok ? modeled : input.bid;
}

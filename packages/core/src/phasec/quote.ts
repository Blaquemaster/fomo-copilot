/** Quote-only bids. Costs come from the quote, not from a fixed fee or slippage constant. */

export interface SizeBidOk {
  ok: true;
  execPriceUsd: number;
  midPriceUsd: number;
  impactPct: number;
  feeUsd: number;
  sizeUsd: number;
  liquidityUsd: number | null;
}

export interface SizeBidFail {
  ok: false;
  reason: "no_liquidity" | "no_quote" | "quote_failed";
}

export type SizeBid = SizeBidOk | SizeBidFail;

export const FULL_LOSS = -1;

export interface CurveReserves {
  virtualSol: number;
  virtualTokens: number;
  solPriceUsd: number;
  /** Fee taken from the chain state. Null means the state did not report one. */
  feeBps: number | null;
}

/** Constant-product bid against reserves we already have. A zero reserve is no liquidity. */
export function curveBid(reserves: CurveReserves, sizeUsd: number): SizeBid {
  if (!(sizeUsd > 0) || !(reserves.solPriceUsd > 0)) {
    return { ok: false, reason: "no_quote" };
  }
  if (!(reserves.virtualSol > 0) || !(reserves.virtualTokens > 0)) {
    return { ok: false, reason: "no_liquidity" };
  }
  const feeBps = reserves.feeBps ?? 0;
  const feeUsd = (sizeUsd * feeBps) / 10_000;
  const solIn = (sizeUsd - feeUsd) / reserves.solPriceUsd;
  if (!(solIn > 0)) return { ok: false, reason: "no_liquidity" };
  const k = reserves.virtualSol * reserves.virtualTokens;
  const tokensOut = reserves.virtualTokens - k / (reserves.virtualSol + solIn);
  if (!(tokensOut > 0)) return { ok: false, reason: "no_liquidity" };
  const execPriceUsd = sizeUsd / tokensOut;
  const midPriceUsd = (reserves.virtualSol / reserves.virtualTokens) * reserves.solPriceUsd;
  return {
    ok: true,
    execPriceUsd,
    midPriceUsd,
    impactPct: midPriceUsd > 0 ? (execPriceUsd / midPriceUsd - 1) * 100 : 0,
    feeUsd,
    sizeUsd,
    liquidityUsd: reserves.virtualSol * reserves.solPriceUsd,
  };
}

export function jupiterQuoteUrl(inputMint: string, outputMint: string, amount: string): string {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    swapMode: "ExactIn",
  });
  return `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
}

/** Jupiter /v6/quote body. The path is quote-only; a swap route is not requested. */
export function parseJupiterQuote(body: unknown, sizeUsd: number): SizeBid {
  if (!body || typeof body !== "object") return { ok: false, reason: "quote_failed" };
  const record = body as Record<string, unknown>;
  const inAmount = Number(record["inAmount"]);
  const outAmount = Number(record["outAmount"]);
  if (!(inAmount > 0) || !(outAmount > 0) || !(sizeUsd > 0)) {
    return { ok: false, reason: "no_quote" };
  }
  const impactRaw = Number(record["priceImpactPct"]);
  const impactPct = Number.isFinite(impactRaw) ? Math.abs(impactRaw) * 100 : 0;
  let feeUsd = 0;
  const routes = record["routePlan"];
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (!route || typeof route !== "object") continue;
      const info = (route as { swapInfo?: { feeAmount?: unknown } }).swapInfo;
      const fee = Number(info?.feeAmount);
      if (Number.isFinite(fee) && fee > 0) feeUsd += (fee / inAmount) * sizeUsd;
    }
  }
  const execPriceUsd = sizeUsd / outAmount;
  const midPriceUsd = impactPct > 0 ? execPriceUsd / (1 + impactPct / 100) : execPriceUsd;
  return {
    ok: true,
    execPriceUsd,
    midPriceUsd,
    impactPct,
    feeUsd,
    sizeUsd,
    liquidityUsd: null,
  };
}

export function stageSizeUsd(bankroll: number | null, sizePct: number): number | null {
  if (bankroll === null || !(bankroll > 0) || !(sizePct > 0)) return null;
  return (bankroll * sizePct) / 100;
}

/** Round trip at one size. A missing or empty exit is a full loss of that bid. */
export function quotedRoundTrip(entry: SizeBid, exit: SizeBid): number {
  if (!entry.ok || !(entry.execPriceUsd > 0) || !(entry.sizeUsd > 0)) return FULL_LOSS;
  if (!exit.ok || exit.liquidityUsd === 0 || !(exit.execPriceUsd > 0)) return FULL_LOSS;
  const tokens = (entry.sizeUsd - entry.feeUsd) / entry.execPriceUsd;
  if (!(tokens > 0)) return FULL_LOSS;
  const proceeds = tokens * exit.execPriceUsd - exit.feeUsd;
  return proceeds / entry.sizeUsd - 1;
}

/**
 * Scale-out sells half at the +50% trigger when the quote has reached it.
 * The other half uses the exit quote. A dead exit loses the unsold half.
 */
export function scaleOutRoundTrip(entry: SizeBid, exit: SizeBid): number {
  if (!entry.ok || !(entry.execPriceUsd > 0)) return FULL_LOSS;
  const triggered = exit.ok && exit.execPriceUsd >= entry.execPriceUsd * 1.5;
  if (!triggered) return quotedRoundTrip(entry, exit);
  const half = entry.sizeUsd / 2;
  const triggerPrice = entry.execPriceUsd * 1.5;
  const feeRate = entry.sizeUsd > 0 ? entry.feeUsd / entry.sizeUsd : 0;
  const scaled = half * (triggerPrice / entry.execPriceUsd) - half * feeRate;
  if (!exit.ok || exit.liquidityUsd === 0) return (scaled - entry.sizeUsd) / entry.sizeUsd;
  const restTokens = half / entry.execPriceUsd;
  const rest = restTokens * exit.execPriceUsd - exit.feeUsd / 2;
  return (scaled + rest - entry.sizeUsd) / entry.sizeUsd;
}

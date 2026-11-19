/** Quote-only bids. Costs come from the quote, not from a fixed fee or slippage constant. */

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
}

export interface SizeBidFail {
  ok: false;
  reason: "no_liquidity" | "no_route" | "no_quote" | "rate_limited" | "transient";
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
  if (status === 400 || status === 404) return "no_route";
  if (status >= 200 && status < 300) return "ok";
  return "transient";
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

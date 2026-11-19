import {
  SOL_MINT,
  classifyJupiterHttp,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  parseJupiterQuote,
  quoteBackoffMs,
  quoteUrlAllowed,
  takeTokens,
  type SizeBid,
  type TokenBucket,
} from "@fomo/core";

export interface JupiterRequest {
  mint: string;
  side: "buy" | "sell";
  amount: string;
  which: "one" | "two";
  sizeUsd: number;
  solPriceUsd: number;
}

export async function collectJupiterBids(input: {
  requests: readonly JupiterRequest[];
  fetchImpl?: typeof fetch;
  bucket?: TokenBucket;
  nowMs?: number;
  apiKey?: string | null;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{
  bids: Record<string, { one: SizeBid; two: SizeBid }>;
  bucket: TokenBucket;
  requests: number;
  throttled: number;
}> {
  const nowMs = input.nowMs ?? Date.now();
  const rate = jupiterRatePerMin(Boolean(input.apiKey));
  let bucket = input.bucket ?? { tokens: rate, refilledAt: nowMs };
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const bids: Record<string, { one: SizeBid; two: SizeBid }> = {};
  let requests = 0;
  let throttled = 0;
  for (const request of input.requests) {
    const taken = takeTokens(bucket, nowMs, rate, 1);
    bucket = taken.bucket;
    if (taken.granted < 1) {
      bids[request.mint] = bids[request.mint] ?? {
        one: { ok: false, reason: "rate_limited" },
        two: { ok: false, reason: "rate_limited" },
      };
      bids[request.mint]![request.which] = { ok: false, reason: "rate_limited" };
      continue;
    }
    const inputMint = request.side === "buy" ? SOL_MINT : request.mint;
    const outputMint = request.side === "buy" ? request.mint : SOL_MINT;
    const url = jupiterQuoteUrl(inputMint, outputMint, request.amount);
    if (!quoteUrlAllowed(url)) {
      bids[request.mint] = bids[request.mint] ?? {
        one: { ok: false, reason: "transient" },
        two: { ok: false, reason: "transient" },
      };
      bids[request.mint]![request.which] = { ok: false, reason: "transient" };
      continue;
    }
    let outcome: SizeBid = { ok: false, reason: "transient" };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      requests += 1;
      try {
        const response = await fetchImpl(url, {
          headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
        });
        const kind = classifyJupiterHttp(response.status);
        if (kind === "rate_limited") {
          throttled += 1;
          await sleep(quoteBackoffMs(attempt));
          continue;
        }
        if (kind === "transient") {
          await sleep(quoteBackoffMs(attempt));
          continue;
        }
        if (kind === "no_route") {
          outcome = { ok: false, reason: "no_route" };
          break;
        }
        const body = await response.json();
        outcome = parseJupiterQuote(body, {
          sizeUsd: request.sizeUsd,
          side: request.side,
          solPriceUsd: request.solPriceUsd,
        });
        break;
      } catch {
        outcome = { ok: false, reason: "transient" };
        await sleep(quoteBackoffMs(attempt));
      }
    }
    const slot = bids[request.mint] ?? {
      one: { ok: false, reason: "no_quote" } as SizeBid,
      two: { ok: false, reason: "no_quote" } as SizeBid,
    };
    slot[request.which] = outcome;
    bids[request.mint] = slot;
  }
  return { bids, bucket, requests, throttled };
}

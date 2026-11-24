import {
  SOL_MINT,
  jupiterQuoteUrl,
  lamportsForUsd,
  outcomeFromPrices,
  parseJupiterQuote,
  quoteUrlAllowed,
  type PhaseCStore,
} from "@fomo/core";

/**
 * One-hour candidate outcomes run here, inside the screener process, at the end of each pass.
 * There is no separate service. While the screener is stopped this job does not run, and due
 * rows stay pending. A failed quote is stored as missing. It is not a loss.
 * At most OUTCOME_QUOTES_PER_PASS Jupiter quotes are spent; the rest wait for a later pass.
 */
export const OUTCOME_QUOTES_PER_PASS = 10;
const OUTCOME_SIZE_USD = 5;

export async function priceDueCandidates(input: {
  now: Date;
  store: PhaseCStore;
  solPriceUsd: number | null;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
}): Promise<{ priced: number; missing: number; waiting: number }> {
  const due = await input.store.dueCandidates(input.now, OUTCOME_QUOTES_PER_PASS);
  const waiting = Math.max(0, due.length - OUTCOME_QUOTES_PER_PASS);
  if (input.solPriceUsd === null) return { priced: 0, missing: 0, waiting: due.length };
  const amount = lamportsForUsd(OUTCOME_SIZE_USD, input.solPriceUsd);
  if (!amount) return { priced: 0, missing: 0, waiting: due.length };
  const fetchImpl = input.fetchImpl ?? fetch;
  let priced = 0;
  let missing = 0;
  for (const row of due) {
    const url = jupiterQuoteUrl(SOL_MINT, row.mint, amount);
    if (!quoteUrlAllowed(url)) {
      missing += 1;
      await input.store.saveCandidateOutcome(row.id, "missing", null, null);
      continue;
    }
    try {
      const response = await fetchImpl(url, {
        headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
      });
      if (!response.ok) {
        missing += 1;
        await input.store.saveCandidateOutcome(row.id, "missing", null, null);
        continue;
      }
      const body = await response.json();
      const bid = parseJupiterQuote(body, {
        sizeUsd: OUTCOME_SIZE_USD,
        side: "buy",
        solPriceUsd: input.solPriceUsd,
      });
      const outcome = outcomeFromPrices(row.alertPriceUsd, bid.ok ? bid.execPriceUsd : null);
      await input.store.saveCandidateOutcome(row.id, outcome.status, outcome.priceUsd, outcome.net);
      if (outcome.status === "priced") priced += 1;
      else missing += 1;
    } catch {
      missing += 1;
      await input.store.saveCandidateOutcome(row.id, "missing", null, null);
    }
  }
  return { priced, missing, waiting };
}

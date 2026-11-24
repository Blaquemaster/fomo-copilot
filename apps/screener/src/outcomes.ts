import {
  EXPERIMENT_LATENESS_MS,
  SOL_MINT,
  jupiterQuoteUrl,
  lamportsForUsd,
  outcomeFromPrices,
  parseJupiterQuote,
  quoteUrlAllowed,
  reverseNotionalUsd,
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

/**
 * One row per horizon, plus the entry and reverse quotes. A late 60-minute
 * quote is labeled late and is not stored as the exit price.
 */
export async function priceDueObservations(input: {
  now: Date;
  store: PhaseCStore;
  solPriceUsd: number | null;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
}): Promise<{ priced: number; missing: number; late: number; backlog: number }> {
  const backlog = await input.store.observationBacklog(input.now);
  const due = await input.store.dueObservations(input.now, OUTCOME_QUOTES_PER_PASS);
  if (input.solPriceUsd === null) {
    return { priced: 0, missing: 0, late: 0, backlog: backlog.due };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let priced = 0;
  let missing = 0;
  let late = 0;
  for (const row of due) {
    const latenessMs = input.now.getTime() - row.dueAt.getTime();
    const isLate = latenessMs > EXPERIMENT_LATENESS_MS;
    if (row.role === "exit" && isLate) {
      late += 1;
      await input.store.saveObservation({
        mint: row.mint,
        label: row.label,
        observedAt: input.now,
        late: true,
        priceUsd: null,
        status: "late",
      });
      continue;
    }
    const notion = row.label.endsWith("low")
      ? reverseNotionalUsd("solana_lowest_fee")
      : reverseNotionalUsd("solana_other");
    const sellAmount = row.role === "entry" ? null : row.entryOutAmount;
    const buyAmount = lamportsForUsd(notion, input.solPriceUsd);
    const amount = row.role === "entry" ? buyAmount : sellAmount;
    if (!amount) {
      missing += 1;
      await input.store.saveObservation({
        mint: row.mint,
        label: row.label,
        observedAt: input.now,
        late: isLate,
        priceUsd: null,
        status: "missing",
      });
      continue;
    }
    const url =
      row.role === "entry"
        ? jupiterQuoteUrl(SOL_MINT, row.mint, amount)
        : jupiterQuoteUrl(row.mint, SOL_MINT, amount);
    if (!quoteUrlAllowed(url)) {
      missing += 1;
      await input.store.saveObservation({
        mint: row.mint,
        label: row.label,
        observedAt: input.now,
        late: isLate,
        priceUsd: null,
        status: "missing",
      });
      continue;
    }
    try {
      const response = await fetchImpl(url, {
        headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
      });
      if (!response.ok) {
        missing += 1;
        await input.store.saveObservation({
          mint: row.mint,
          label: row.label,
          observedAt: input.now,
          late: isLate,
          priceUsd: null,
          status: "missing",
        });
        continue;
      }
      const body = await response.json();
      const bid = parseJupiterQuote(body, {
        sizeUsd: notion,
        side: row.role === "entry" ? "buy" : "sell",
        solPriceUsd: input.solPriceUsd,
      });
      const price = bid.ok ? bid.execPriceUsd : null;
      await input.store.saveObservation({
        mint: row.mint,
        label: row.label,
        observedAt: input.now,
        late: isLate,
        priceUsd: price,
        status: price === null ? "missing" : "priced",
        outAmount: bid.ok ? bid.outAmount : null,
      });
      if (price === null) missing += 1;
      else priced += 1;
      if (isLate) late += 1;
    } catch {
      missing += 1;
      await input.store.saveObservation({
        mint: row.mint,
        label: row.label,
        observedAt: input.now,
        late: isLate,
        priceUsd: null,
        status: "missing",
      });
    }
  }
  return { priced, missing, late, backlog: backlog.due };
}

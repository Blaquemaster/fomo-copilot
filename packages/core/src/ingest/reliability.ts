const BASE_MS = 1_000;
const CAP_MS = 30_000;

/** Exponential backoff with up to 20% jitter. Attempt 1 is the first retry. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(CAP_MS, BASE_MS * 2 ** (safeAttempt - 1));
  const unit = random();
  const jitter = exponential * 0.2 * (Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0);
  return Math.round(exponential + jitter);
}

export const SILENCE_MS = 60_000;

/** In-process dedupe in front of the signature unique key in Postgres. */
export class SignatureWindow {
  private readonly seen = new Set<string>();

  constructor(private readonly max = 5_000) {}

  /** Returns false when this signature and event index were already seen. */
  add(signature: string, eventIndex: number): boolean {
    const key = `${signature}:${eventIndex.toString()}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (typeof oldest === "string") this.seen.delete(oldest);
    }
    return true;
  }
}

export function silenceExceeded(input: {
  lastMessageAtMs: number;
  nowMs: number;
  alreadyAlerted: boolean;
  thresholdMs?: number;
}): boolean {
  if (input.alreadyAlerted) return false;
  return input.nowMs - input.lastMessageAtMs > (input.thresholdMs ?? SILENCE_MS);
}

/**
 * Signature pages from getSignaturesForAddress are newest-first.
 * Missing signatures are those strictly newer than the checkpoint.
 */
export function signaturesNewerThanCheckpoint(input: {
  newestFirst: readonly string[];
  checkpoint: string | null;
}): { missing: string[]; reachedCheckpoint: boolean } {
  if (input.checkpoint === null) {
    return { missing: [], reachedCheckpoint: true };
  }
  const index = input.newestFirst.indexOf(input.checkpoint);
  if (index === -1) {
    return { missing: [...input.newestFirst], reachedCheckpoint: false };
  }
  return { missing: input.newestFirst.slice(0, index), reachedCheckpoint: true };
}

export interface BackfillStep {
  missing: string[];
  fetchAnotherPage: boolean;
  gapRemains: boolean;
}

export function planBackfillPage(input: {
  newestFirst: readonly string[];
  checkpoint: string | null;
  pageWasFull: boolean;
  pagesFetched: number;
  maxPages: number;
}): BackfillStep {
  const parsed = signaturesNewerThanCheckpoint({
    newestFirst: input.newestFirst,
    checkpoint: input.checkpoint,
  });
  if (input.checkpoint === null || parsed.reachedCheckpoint) {
    return { missing: parsed.missing, fetchAnotherPage: false, gapRemains: false };
  }
  const canContinue = input.pageWasFull && input.pagesFetched < input.maxPages;
  return {
    missing: parsed.missing,
    fetchAnotherPage: canContinue,
    gapRemains: !canContinue,
  };
}

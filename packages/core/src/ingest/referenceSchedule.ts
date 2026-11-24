/** Code-only schedule. Nothing here is started by the ingestor timer. */
export const REFERENCE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** One reconciliation covers everything since the cursor, including runs that were missed. */
export function reconciliationWindow(input: {
  now: Date;
  cursorAt: Date | null;
  everyMs: number;
}): { from: Date; to: Date; missedRuns: number } {
  if (input.cursorAt === null) {
    return {
      from: new Date(input.now.getTime() - input.everyMs),
      to: input.now,
      missedRuns: 0,
    };
  }
  const elapsed = input.now.getTime() - input.cursorAt.getTime();
  return {
    from: input.cursorAt,
    to: input.now,
    missedRuns: Math.max(0, Math.floor(elapsed / input.everyMs) - 1),
  };
}

/** Fast freshness is not the retrospective reconciliation window. */
export function feedIsFresh(input: { lastEventAt: Date; now: Date; staleMs: number }): boolean {
  return input.now.getTime() - input.lastEventAt.getTime() <= input.staleMs;
}

export function referenceCheckPlan(): {
  venueRecall: { enabled: false; everyMs: number };
  walletFeedRecall: { enabled: false; everyMs: number };
} {
  return {
    venueRecall: { enabled: false, everyMs: REFERENCE_CHECK_EVERY_MS },
    walletFeedRecall: { enabled: false, everyMs: REFERENCE_CHECK_EVERY_MS },
  };
}

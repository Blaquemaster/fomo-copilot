/** Code-only schedule. Nothing here is started by the ingestor timer. */
export const REFERENCE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function referenceCheckPlan(): {
  venueRecall: { enabled: false; everyMs: number };
  walletFeedRecall: { enabled: false; everyMs: number };
} {
  return {
    venueRecall: { enabled: false, everyMs: REFERENCE_CHECK_EVERY_MS },
    walletFeedRecall: { enabled: false, everyMs: REFERENCE_CHECK_EVERY_MS },
  };
}

/** Which failures stop entries, which stop diagnostics, and which leave the stored balance alone. */
export const FAILURE_MAP = {
  credit_ceiling: { diagnostic: "stopped", ingestor: "keeps_running", newEntries: "unchanged" },
  entry_pause: {
    diagnostic: "unchanged",
    ingestor: "keeps_running",
    newEntries: "stopped",
    exits: "allowed",
  },
  signing_halt: {
    diagnostic: "unchanged",
    ingestor: "keeps_running",
    newEntries: "stopped",
    exits: "stopped",
  },
} as const;

/** The stored row is the balance after a restart. A new process does not recompute it. */
export function balanceAfterRestart(stored: { mint: string; reserved: number }): {
  mint: string;
  reserved: number;
} {
  return { mint: stored.mint, reserved: stored.reserved };
}

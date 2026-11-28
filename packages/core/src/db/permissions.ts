/**
 * Written permission map. These roles are not applied to production.
 * The signer has no database login. A process still using the application
 * role is outside this map until that connection changes.
 */
export const PERMISSION_MAP = [
  {
    process: "ingestor",
    role: "fomo_ingest",
    reads: ["raw_events"],
    writes: ["raw_events", "ingest_status", "ingest_checkpoint", "ingest_backfill"],
  },
  {
    process: "screener",
    role: "fomo_screen",
    reads: ["raw_events", "pump_trade", "wallet_fill", "tracked_wallet"],
    writes: ["phasec_candidate", "phasec_alert"],
  },
  {
    process: "execution-records",
    role: "fomo_exec",
    reads: ["phasec_candidate", "phasec_position"],
    writes: ["autobuy_intent", "phasec_execution", "phasec_quote_attempt", "phasec_quote_failure"],
    appendOnly: true,
  },
  {
    process: "reporting",
    role: "fomo_report",
    reads: [
      "raw_events",
      "phasec_candidate",
      "phasec_alert",
      "phasec_position",
      "phasec_execution",
      "autobuy_intent",
      "diagnostic_spend",
      "ingest_month",
    ],
    writes: [],
  },
  { process: "signer", role: null, reads: [], writes: [] },
] as const;

export const PERMISSIONS_APPLIED = false;

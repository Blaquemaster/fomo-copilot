/** Exact opt-in. Unset, empty, and any other value stay off. A stale TRUE does not start. */
export function serviceEnabled(flag: string | undefined): boolean {
  return flag === "true";
}

/**
 * Paper, alerts, outcomes, and shadow are separate flags.
 * Shadow does not start when a Telegram token is present.
 * Reverting a deploy workflow does not change this function.
 */
export function serviceStartDecision(input: {
  paperFlag: string | undefined;
  alertsFlag: string | undefined;
  outcomesFlag: string | undefined;
  shadowFlag: string | undefined;
  telegramToken?: string;
}): {
  paper: boolean;
  alerts: boolean;
  outcomes: boolean;
  shadow: boolean;
  shadowBlockedReason: string | null;
} {
  const telegram = (input.telegramToken ?? "").length > 0;
  const shadowWanted = serviceEnabled(input.shadowFlag);
  return {
    paper: serviceEnabled(input.paperFlag),
    alerts: serviceEnabled(input.alertsFlag),
    outcomes: serviceEnabled(input.outcomesFlag),
    shadow: shadowWanted && !telegram,
    shadowBlockedReason: shadowWanted && telegram ? "telegram_credentials_present" : null,
  };
}

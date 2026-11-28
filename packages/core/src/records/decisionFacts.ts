export const PARSER_VERSION = "solana-2026-11-28";
export const FROZEN_LIST_VERSION = "v3";

export const INCLUDED_STAGES = [
  "trench",
  "near_graduation",
  "post_graduation",
  "second_wave",
] as const;

export interface DecisionTimes {
  chainAt: string;
  observedAt: string;
  decisionAt: string;
  parserVersion: typeof PARSER_VERSION;
  listVersion: typeof FROZEN_LIST_VERSION;
}

export function decisionTimes(input: {
  chainAt: Date;
  observedAt: Date;
  decisionAt: Date;
}): DecisionTimes {
  return {
    chainAt: input.chainAt.toISOString(),
    observedAt: input.observedAt.toISOString(),
    decisionAt: input.decisionAt.toISOString(),
    parserVersion: PARSER_VERSION,
    listVersion: FROZEN_LIST_VERSION,
  };
}

/** A backfill observed after the decision was not available to that decision. */
export function eventVisibleToDecision(eventObservedAt: Date, decisionAt: Date): boolean {
  return eventObservedAt.getTime() <= decisionAt.getTime();
}

/** A decision keeps the list version it was made with. A later list is not readable. */
export function listUsable(decisionList: string, candidateList: string): boolean {
  return candidateList === decisionList;
}

/** An included stage with ready data can open. An unready or unknown stage cannot, and it is not a size. */
export function stageAdmission(
  stage: string,
  ready: boolean,
): { open: boolean; readiness: "ready" | "unavailable" } {
  if (!INCLUDED_STAGES.includes(stage as (typeof INCLUDED_STAGES)[number]) || !ready) {
    return { open: false, readiness: "unavailable" };
  }
  return { open: true, readiness: "ready" };
}

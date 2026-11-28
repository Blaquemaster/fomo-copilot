import type { DataReadiness } from "../records/readiness.js";

export interface SocialObservation {
  mint: string;
  status: "unknown" | "present";
  mentions: number | null;
  source: "fixture" | "live" | "none";
}

export interface SocialBudget {
  /** Live lookups allowed this month. Zero means the live provider is not called. */
  liveCap: number;
  liveUsed: number;
}

/**
 * A paid X provider is not called. The default cap is zero.
 * Missing or stale social data is unknown, not zero mentions.
 */
export function collectSocial(input: {
  mint: string;
  budget: SocialBudget;
  fixtureMentions?: number | null;
  liveMentions?: number | null;
  now: Date;
  staleAfterMs: number;
  fetchedAt?: Date | null;
}): { observation: SocialObservation; budget: SocialBudget; readiness: DataReadiness<number> } {
  const pack = (observation: SocialObservation, budget: SocialBudget) => ({
    observation,
    budget,
    readiness:
      observation.status === "present" && observation.mentions !== null
        ? ({ state: "ready", value: observation.mentions } as const)
        : ({ state: "unavailable", value: null } as const),
  });
  if (input.fetchedAt && input.now.getTime() - input.fetchedAt.getTime() > input.staleAfterMs) {
    return pack(
      { mint: input.mint, status: "unknown", mentions: null, source: "none" },
      input.budget,
    );
  }
  if (input.fixtureMentions !== undefined && input.fixtureMentions !== null) {
    return pack(
      { mint: input.mint, status: "present", mentions: input.fixtureMentions, source: "fixture" },
      input.budget,
    );
  }
  if (input.budget.liveCap <= 0 || input.budget.liveUsed >= input.budget.liveCap) {
    return pack(
      { mint: input.mint, status: "unknown", mentions: null, source: "none" },
      input.budget,
    );
  }
  if (input.liveMentions === undefined || input.liveMentions === null) {
    return pack(
      { mint: input.mint, status: "unknown", mentions: null, source: "live" },
      { ...input.budget, liveUsed: input.budget.liveUsed + 1 },
    );
  }
  return pack(
    { mint: input.mint, status: "present", mentions: input.liveMentions, source: "live" },
    { ...input.budget, liveUsed: input.budget.liveUsed + 1 },
  );
}

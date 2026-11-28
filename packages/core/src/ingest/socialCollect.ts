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
}): { observation: SocialObservation; budget: SocialBudget } {
  if (input.fetchedAt && input.now.getTime() - input.fetchedAt.getTime() > input.staleAfterMs) {
    return {
      observation: { mint: input.mint, status: "unknown", mentions: null, source: "none" },
      budget: input.budget,
    };
  }
  if (input.fixtureMentions !== undefined && input.fixtureMentions !== null) {
    return {
      observation: {
        mint: input.mint,
        status: "present",
        mentions: input.fixtureMentions,
        source: "fixture",
      },
      budget: input.budget,
    };
  }
  if (input.budget.liveCap <= 0 || input.budget.liveUsed >= input.budget.liveCap) {
    return {
      observation: { mint: input.mint, status: "unknown", mentions: null, source: "none" },
      budget: input.budget,
    };
  }
  if (input.liveMentions === undefined || input.liveMentions === null) {
    return {
      observation: { mint: input.mint, status: "unknown", mentions: null, source: "live" },
      budget: { ...input.budget, liveUsed: input.budget.liveUsed + 1 },
    };
  }
  return {
    observation: {
      mint: input.mint,
      status: "present",
      mentions: input.liveMentions,
      source: "live",
    },
    budget: { ...input.budget, liveUsed: input.budget.liveUsed + 1 },
  };
}

export interface DecisionLink {
  id: string;
  mint: string;
  eventIds: readonly string[];
  listVersion: string | null;
  executionId: string | null;
  readiness: "ready" | "unavailable";
}

export function decisionLink(input: {
  mint: string;
  eventIds: readonly string[];
  listVersion?: string | null;
  executionId?: string | null;
  ready: boolean;
}): DecisionLink {
  return {
    id: `${input.mint}:${input.eventIds.join(",")}`,
    mint: input.mint,
    eventIds: input.eventIds,
    listVersion: input.listVersion ?? null,
    executionId: input.executionId ?? null,
    readiness: input.ready ? "ready" : "unavailable",
  };
}

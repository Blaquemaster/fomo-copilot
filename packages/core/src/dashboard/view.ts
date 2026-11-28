export interface DashboardRequest {
  authorization: string | undefined;
  token: string;
  now: Date;
  observedAt: Date | null;
  staleAfterMs: number;
  services: readonly { name: string; mode: string }[];
  feeds: readonly { name: string; gap: boolean }[];
  decisions: readonly { id: string; readiness: "ready" | "unavailable"; reason: string | null }[];
  positions: readonly { mint: string; reserved: number }[];
  spend: { diagnosticRemaining: number | null } | null;
}

export function dashboardView(input: DashboardRequest): {
  status: number;
  body: Record<string, unknown>;
} {
  if (!input.token || input.authorization !== `Bearer ${input.token}`) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const stale =
    input.observedAt === null ||
    input.now.getTime() - input.observedAt.getTime() > input.staleAfterMs;
  return {
    status: 200,
    body: {
      services: input.services.length === 0 ? "empty" : input.services,
      feeds: input.feeds.length === 0 ? "empty" : input.feeds,
      decisions: input.decisions.length === 0 ? "empty" : input.decisions,
      positions: input.positions.length === 0 ? "empty" : input.positions,
      spend: input.spend ?? "unavailable",
      freshness: stale ? "stale" : "current",
      alerts: "held",
    },
  };
}

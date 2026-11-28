export const POLICY_VERSION = "2026-11-28.3";

export interface PolicyDecision {
  ok: boolean;
  version: typeof POLICY_VERSION;
  reason: string | null;
}

/** One gate for cash, size, liquidity, freshness, and route. A missing policy cannot write a position. */
export function applyEntryPolicy(input: {
  amount: number;
  bankroll: number;
  exitReserve: number;
  route: "available" | "unavailable";
  liquidityUsd: number | null;
  fresh: boolean;
}): PolicyDecision {
  if (input.route === "unavailable")
    return { ok: false, version: POLICY_VERSION, reason: "route_unavailable" };
  if (!input.fresh) return { ok: false, version: POLICY_VERSION, reason: "stale" };
  if (input.liquidityUsd === null)
    return { ok: false, version: POLICY_VERSION, reason: "liquidity_unknown" };
  if (input.amount + input.exitReserve > input.bankroll) {
    return { ok: false, version: POLICY_VERSION, reason: "reserved_for_exit" };
  }
  return { ok: true, version: POLICY_VERSION, reason: null };
}

export function positionWriteAllowed(policy: PolicyDecision | null): {
  written: boolean;
  reason: string;
} {
  if (policy === null || !policy.ok) return { written: false, reason: "policy_required" };
  return { written: true, reason: policy.version };
}

/**
 * Shadow acceptance. Strategy-versus-control returns are not an input and
 * cannot change the result.
 */
export interface ShadowMeasurements {
  tradesCreated: number;
  telegramSends: number;
  autoEnabled: boolean;
  unintendedProdWrites: number;
  recall: readonly { venue: string; observed: number; reference: number }[];
  dispatchWithin60s: number;
  dispatchAttempts: number;
  silentDrops: number;
  peakRequests: number;
  peakCapacity: number;
  unresolvedByArm: readonly { arm: string; unresolved: number; endpoints: number }[];
  completeMatched: number;
  projectedWalletPerDay: number;
  cashReconciled: boolean;
}

export function shadowAcceptance(input: ShadowMeasurements): {
  pass: boolean;
  checks: Record<string, boolean>;
} {
  const recallOk =
    input.recall.length > 0 &&
    input.recall.every((row) => row.reference >= 300 && row.observed / row.reference >= 0.99);
  const dispatchOk =
    input.dispatchAttempts > 0 &&
    input.silentDrops === 0 &&
    input.dispatchWithin60s / input.dispatchAttempts >= 0.99;
  const headroom =
    input.peakCapacity > 0 ? (input.peakCapacity - input.peakRequests) / input.peakCapacity : 0;
  const missingOk =
    input.unresolvedByArm.length > 0 &&
    input.unresolvedByArm.every(
      (row) => row.endpoints > 0 && row.unresolved / row.endpoints <= 0.02,
    );
  const checks = {
    isolation:
      input.tradesCreated === 0 &&
      input.telegramSends === 0 &&
      input.autoEnabled === false &&
      input.unintendedProdWrites === 0,
    recall: recallOk,
    scheduler: dispatchOk,
    headroom: headroom >= 0.3,
    missing: missingOk,
    recruitment: input.completeMatched >= 20 && input.projectedWalletPerDay >= 3,
    cash: input.cashReconciled,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

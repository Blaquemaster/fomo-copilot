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
  timelyRecall: readonly { venue: string; observed: number; reference: number }[];
  eventualRecall: readonly { venue: string; observed: number; reference: number }[];
  healthyPeriodCoverage: number;
  wholeRunAvailability: number;
  matchedGatePassing: number;
  capRelaxed: boolean;
  integrityFailure: boolean;
  spendLimitHit: boolean;
  unsafeOperation: boolean;
}

export function shadowAcceptance(input: ShadowMeasurements): {
  pass: boolean;
  checks: Record<string, boolean>;
  enrollmentStopped: boolean;
  statisticalFailure: boolean;
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
  const rate = (rows: ShadowMeasurements["timelyRecall"]) =>
    rows.length > 0 &&
    rows.every((row) => row.reference >= 300 && row.observed / row.reference >= 0.99);
  const operationsClear = !input.integrityFailure && !input.spendLimitHit && !input.unsafeOperation;
  const checks = {
    isolation:
      input.tradesCreated === 0 &&
      input.telegramSends === 0 &&
      input.autoEnabled === false &&
      input.unintendedProdWrites === 0,
    recall: recallOk,
    timelyAvailability: rate(input.timelyRecall),
    eventualRecovery: rate(input.eventualRecall),
    healthyPeriod: input.healthyPeriodCoverage >= 0.99,
    wholeRun: input.wholeRunAvailability >= 0,
    scheduler: dispatchOk,
    headroom: headroom >= 0.3,
    missing: missingOk,
    recruitment: input.matchedGatePassing >= 20 && input.projectedWalletPerDay >= 3,
    capHeld: input.capRelaxed === false,
    cash: input.cashReconciled,
    operationsClear,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    enrollmentStopped: !operationsClear,
    statisticalFailure: false,
  };
}

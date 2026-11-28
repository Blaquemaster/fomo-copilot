export interface StrategySignal {
  mint: string;
  stage: string;
  owner: string;
  amount: number;
}

export interface AdmissionResult {
  admitted: { signal: StrategySignal; reserved: number } | null;
  rejected: { signal: StrategySignal; reason: "not_admitted" | "reserved_for_exit" }[];
}

/** Two signals on one mint produce one reservation. The other signal stays not admitted. */
export function admitOne(input: {
  signals: readonly StrategySignal[];
  bankroll: number;
  exitReserve: number;
}): AdmissionResult {
  const rejected: AdmissionResult["rejected"] = [];
  let admitted: AdmissionResult["admitted"] = null;
  for (const signal of input.signals) {
    if (admitted !== null) {
      rejected.push({ signal, reason: "not_admitted" });
      continue;
    }
    if (signal.amount + input.exitReserve > input.bankroll) {
      rejected.push({ signal, reason: "reserved_for_exit" });
      continue;
    }
    admitted = { signal, reserved: signal.amount };
  }
  return { admitted, rejected };
}

export interface ExecutionEconomics {
  quote: { estimatedFee: number | null };
  simulation: { state: "held" };
  fill: null;
}

/** A quote, a simulation, and a fill stay separate. They are not added together. */
export function executionEconomics(input: { estimatedFee: number | null }): ExecutionEconomics & {
  combined: null;
} {
  return {
    quote: { estimatedFee: input.estimatedFee },
    simulation: { state: "held" },
    fill: null,
    combined: null,
  };
}

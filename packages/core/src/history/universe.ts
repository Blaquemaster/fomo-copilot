export const UNIVERSE_CAP = 300;

/** Evict the oldest mint that is not an open position or an experiment observation. */
export function admitMint(input: {
  universe: readonly string[];
  mint: string;
  protectedMints: readonly string[];
}): { universe: string[]; evicted: string | null; admitted: boolean } {
  if (input.universe.includes(input.mint)) {
    return { universe: [...input.universe], evicted: null, admitted: true };
  }
  if (input.universe.length < UNIVERSE_CAP) {
    return { universe: [...input.universe, input.mint], evicted: null, admitted: true };
  }
  const kept = new Set(input.protectedMints);
  const evict = input.universe.find((mint) => !kept.has(mint));
  if (evict === undefined) return { universe: [...input.universe], evicted: null, admitted: false };
  return {
    universe: [...input.universe.filter((mint) => mint !== evict), input.mint],
    evicted: evict,
    admitted: true,
  };
}

/**
 * Journal lookup only. This build does not call FOMO.
 * A missing lookup is null. It is never stored as tradable.
 */
export async function lookupTradableInFomo(
  mint: string,
): Promise<{ tradableInFomo: null; minutesFromAlertToListed: null }> {
  void mint;
  return { tradableInFomo: null, minutesFromAlertToListed: null };
}

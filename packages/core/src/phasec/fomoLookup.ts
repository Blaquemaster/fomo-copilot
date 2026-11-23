/**
 * FOMO (fomo.family) does not publish a public API or a documented quote/router
 * endpoint. Bitquery's September 29, 2026 chain read of FOMO's Solana signer
 * found most app trades going through the DFlow aggregator, not Jupiter
 * (~22,000 of ~26,000 DEX trades in one hour). A Jupiter SOL->mint quote is
 * therefore not a reliable proxy for "FOMO can buy this mint." Unofficial
 * third-party scrapes (for example paid x402 token pages) are not FOMO, and
 * this process does not call them. There is no read-only official check we can
 * trust, so this lookup is not used in scoring and is not called at alert time.
 */
export async function lookupTradableInFomo(
  _mint?: string,
): Promise<{ tradableInFomo: boolean | null; minutesFromAlertToListed: number | null }> {
  void _mint;
  return { tradableInFomo: null, minutesFromAlertToListed: null };
}

/** FOMO has no official public buyability check. Do not treat a missing lookup as a score. */
export const FOMO_BUYABILITY_AVAILABLE = false;

export interface ScreenRules {
  failMintAuthority: boolean;
  failFreezeAuthority: boolean;
  transferFeeBpsAbove: number;
  exitImpactPctAbove: number;
  /** Hard fail above this wallet-only top 10 share. Unset keeps the old warn-only screen. */
  top10FailAbove?: number;
  /** Hard fail above this create-slot bundle share. Unset keeps the old warn-only screen. */
  sniperFailAbove?: number;
  /** Strategy trench entries need this many tracked buyers. Controls are exempt. */
  trenchMinTrackedBuyers?: number;
  walletMaxMintsPerDay?: number;
  walletBuyFreshMinutes?: number;
  top10Warn: number;
  sniperWarn: number;
  minLiquidityUsd: number;
  minMakers1h: number;
  /** Hard fail when the entry quote's price impact exceeds this percent. Default 10, from PR #39. */
  entryImpactPctAbove?: number;
}

export interface ScreenFacts {
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  transferFeeBps: number | null;
  exitQuoteImpactPct: number | null;
  top10HoldersPct: number | null;
  sniperBundlePct: number | null;
  liquidityUsd: number | null;
  uniqueMakers1h: number | null;
  creatorSells: number;
  quoteError: boolean;
  /** Entry quote price impact in percent. Null is unmeasured (WATCH). Omitted is not yet wired. */
  entryQuoteImpactPct?: number | null;
  /**
   * True when a launch pool and create slot are known, so a sniper share can be fetched.
   * Unset keeps the default: a null sniper value is WATCH (unmeasured).
   */
  sniperFetchable?: boolean;
}

export interface ScreenResult {
  verdict: "pass" | "fail" | "watch";
  hard: string[];
  warnings: string[];
  /** True when the sniper share has not been measured yet. Kept on the entry record. */
  sniperUnmeasured: boolean;
}

const REQUIRED: Array<[keyof ScreenFacts, string]> = [
  ["mintAuthorityActive", "mint authority"],
  ["freezeAuthorityActive", "freeze authority"],
  ["exitQuoteImpactPct", "exit impact"],
  ["top10HoldersPct", "holders"],
  ["sniperBundlePct", "snipers"],
  ["liquidityUsd", "liquidity"],
  ["entryQuoteImpactPct", "entry impact"],
];

/**
 * Sniper can be fetched once we know the original launch pool and its create slot,
 * including LaunchLab, DBC, and graduated coins traced back to that origin.
 */
export function sniperIsFetchable(coin: {
  createdSlot?: number | null;
  bondingCurve?: string | null;
  poolType?: string | null;
}): boolean {
  if (coin.createdSlot === null || coin.createdSlot === undefined) return false;
  return Boolean(coin.bondingCurve);
}

export function isSniperUnmeasured(
  facts: Pick<ScreenFacts, "sniperBundlePct" | "sniperFetchable">,
): boolean {
  return facts.sniperBundlePct === null;
}

/** Known cheaper-gate hard fail: do not spend sniper credits on this coin. */
export function failsCheaperGates(
  coin: {
    mintAuthorityActive?: boolean | null;
    freezeAuthorityActive?: boolean | null;
    top10HoldersPct?: number | null;
    exitQuoteImpactPct?: number | null;
    entryQuoteImpactPct?: number | null;
    transferFeeBps?: number | null;
  },
  rules: ScreenRules,
): boolean {
  if (rules.failMintAuthority && coin.mintAuthorityActive === true) return true;
  if (rules.failFreezeAuthority && coin.freezeAuthorityActive === true) return true;
  if (
    coin.transferFeeBps !== null &&
    coin.transferFeeBps !== undefined &&
    coin.transferFeeBps > rules.transferFeeBpsAbove
  ) {
    return true;
  }
  if (
    coin.exitQuoteImpactPct !== null &&
    coin.exitQuoteImpactPct !== undefined &&
    coin.exitQuoteImpactPct > rules.exitImpactPctAbove
  ) {
    return true;
  }
  const maxEntry = rules.entryImpactPctAbove ?? 10;
  if (
    coin.entryQuoteImpactPct !== null &&
    coin.entryQuoteImpactPct !== undefined &&
    coin.entryQuoteImpactPct > maxEntry
  ) {
    return true;
  }
  if (
    rules.top10FailAbove !== undefined &&
    coin.top10HoldersPct !== null &&
    coin.top10HoldersPct !== undefined &&
    coin.top10HoldersPct > rules.top10FailAbove
  ) {
    return true;
  }
  return false;
}

/**
 * Spend sniper RPC only on coins that already pass cheaper gates, or that have a
 * wallet signal (and do not already hard-fail a cheaper gate).
 */
export function shouldFetchSniper(
  coin: {
    sniperBundlePct?: number | null;
    trackedBuyers?: number;
    createdSlot?: number | null;
    bondingCurve?: string | null;
    poolType?: string | null;
    mintAuthorityActive?: boolean | null;
    freezeAuthorityActive?: boolean | null;
    top10HoldersPct?: number | null;
    exitQuoteImpactPct?: number | null;
    transferFeeBps?: number | null;
  },
  rules: ScreenRules,
): boolean {
  if (coin.sniperBundlePct !== null && coin.sniperBundlePct !== undefined) return false;
  if (!sniperIsFetchable(coin)) return false;
  if (failsCheaperGates(coin, rules)) return false;
  if ((coin.trackedBuyers ?? 0) >= 1) return true;
  if (coin.mintAuthorityActive === null || coin.mintAuthorityActive === undefined) return false;
  if (coin.freezeAuthorityActive === null || coin.freezeAuthorityActive === undefined) return false;
  if (coin.top10HoldersPct === null || coin.top10HoldersPct === undefined) return false;
  if (coin.exitQuoteImpactPct === null || coin.exitQuoteImpactPct === undefined) return false;
  return true;
}

/** Strategy arms need a passing screen. Controls may enter while only snipers are still unmeasured. */
export function allowsEntry(screen: ScreenResult, arm: string): boolean {
  if (screen.verdict === "pass") return true;
  if (screen.verdict === "fail") return false;
  if (arm !== "random_pass") return false;
  const blocking = screen.warnings.filter(
    (warning) => warning.endsWith(" missing") || warning === "quote source error",
  );
  return blocking.length === 1 && blocking[0] === "snipers missing";
}

/** A missing required field is WATCH. A known hard failure is FAIL. */
export function screenCoin(facts: ScreenFacts, rules: ScreenRules): ScreenResult {
  const hard: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  if (rules.failMintAuthority && facts.mintAuthorityActive === true) hard.push("mint authority");
  if (rules.failFreezeAuthority && facts.freezeAuthorityActive === true) {
    hard.push("freeze authority");
  }
  if (facts.transferFeeBps !== null && facts.transferFeeBps > rules.transferFeeBpsAbove) {
    hard.push(`transfer fee ${facts.transferFeeBps.toString()} bps`);
  }
  if (facts.exitQuoteImpactPct !== null && facts.exitQuoteImpactPct > rules.exitImpactPctAbove) {
    hard.push(`exit impact ${facts.exitQuoteImpactPct.toString()}%`);
  }
  const maxEntry = rules.entryImpactPctAbove ?? 10;
  if (
    facts.entryQuoteImpactPct !== null &&
    facts.entryQuoteImpactPct !== undefined &&
    facts.entryQuoteImpactPct > maxEntry
  ) {
    hard.push(`entry impact ${facts.entryQuoteImpactPct.toString()}%`);
  }
  if (
    rules.top10FailAbove !== undefined &&
    facts.top10HoldersPct !== null &&
    facts.top10HoldersPct > rules.top10FailAbove
  ) {
    hard.push(`top 10 holders ${facts.top10HoldersPct.toFixed(1)}%`);
  }
  if (
    rules.sniperFailAbove !== undefined &&
    facts.sniperBundlePct !== null &&
    facts.sniperBundlePct > rules.sniperFailAbove
  ) {
    hard.push(`sniper bundle ${facts.sniperBundlePct.toFixed(1)}%`);
  }
  const sniperUnmeasured = isSniperUnmeasured(facts);
  for (const [key, label] of REQUIRED) {
    if (facts[key] === null) missing.push(label);
  }
  if (facts.top10HoldersPct !== null && facts.top10HoldersPct > rules.top10Warn) {
    warnings.push(`top 10 holders ${facts.top10HoldersPct.toFixed(1)}%`);
  }
  if (facts.sniperBundlePct !== null && facts.sniperBundlePct > rules.sniperWarn) {
    warnings.push(`sniper bundle ${facts.sniperBundlePct.toFixed(1)}%`);
  }
  if (sniperUnmeasured) warnings.push("sniper unmeasured");
  if (facts.liquidityUsd !== null && facts.liquidityUsd < rules.minLiquidityUsd) {
    warnings.push(`liquidity $${facts.liquidityUsd.toFixed(0)}`);
  }
  if (facts.uniqueMakers1h !== null && facts.uniqueMakers1h < rules.minMakers1h) {
    warnings.push(`makers ${facts.uniqueMakers1h.toString()}`);
  }
  if (facts.creatorSells > 0) warnings.push(`creator sells ${facts.creatorSells.toString()}`);
  if (hard.length > 0) return { verdict: "fail", hard, warnings, sniperUnmeasured };
  if (missing.length > 0 || facts.quoteError) {
    return {
      verdict: "watch",
      hard,
      sniperUnmeasured,
      warnings: [
        ...warnings,
        ...missing.map((label) => `${label} missing`),
        ...(facts.quoteError ? ["quote source error"] : []),
      ],
    };
  }
  return { verdict: "pass", hard, warnings, sniperUnmeasured };
}

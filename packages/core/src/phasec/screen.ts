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
}

export interface ScreenResult {
  verdict: "pass" | "fail" | "watch";
  hard: string[];
  warnings: string[];
}

const REQUIRED: Array<[keyof ScreenFacts, string]> = [
  ["mintAuthorityActive", "mint authority"],
  ["freezeAuthorityActive", "freeze authority"],
  ["exitQuoteImpactPct", "exit impact"],
  ["top10HoldersPct", "holders"],
  ["sniperBundlePct", "snipers"],
  ["liquidityUsd", "liquidity"],
];

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
  for (const [key, label] of REQUIRED) {
    if (facts[key] === null) missing.push(label);
  }
  if (facts.top10HoldersPct !== null && facts.top10HoldersPct > rules.top10Warn) {
    warnings.push(`top 10 holders ${facts.top10HoldersPct.toFixed(1)}%`);
  }
  if (facts.sniperBundlePct !== null && facts.sniperBundlePct > rules.sniperWarn) {
    warnings.push(`sniper bundle ${facts.sniperBundlePct.toFixed(1)}%`);
  }
  if (facts.liquidityUsd !== null && facts.liquidityUsd < rules.minLiquidityUsd) {
    warnings.push(`liquidity $${facts.liquidityUsd.toFixed(0)}`);
  }
  if (facts.uniqueMakers1h !== null && facts.uniqueMakers1h < rules.minMakers1h) {
    warnings.push(`makers ${facts.uniqueMakers1h.toString()}`);
  }
  if (facts.creatorSells > 0) warnings.push(`creator sells ${facts.creatorSells.toString()}`);
  if (hard.length > 0) return { verdict: "fail", hard, warnings };
  if (missing.length > 0 || facts.quoteError) {
    return {
      verdict: "watch",
      hard,
      warnings: [
        ...warnings,
        ...missing.map((label) => `${label} missing`),
        ...(facts.quoteError ? ["quote source error"] : []),
      ],
    };
  }
  return { verdict: "pass", hard, warnings };
}

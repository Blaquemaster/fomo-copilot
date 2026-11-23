import { encodeBase58, rpcCredits } from "@fomo/core";

function readU64(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value += BigInt(data[offset + index] ?? 0) << (8n * BigInt(index));
  }
  return value;
}

export function parseMintAccount(data: Uint8Array): {
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  supply: bigint;
} | null {
  if (data.length < 82) return null;
  const option = (offset: number) =>
    data[offset] !== 0 ||
    data[offset + 1] !== 0 ||
    data[offset + 2] !== 0 ||
    data[offset + 3] !== 0;
  return {
    mintAuthorityActive: option(0),
    freezeAuthorityActive: option(46),
    supply: readU64(data, 36),
  };
}

export function topHolderPct(amounts: readonly number[], supply: number): number | null {
  if (!(supply > 0)) return null;
  const top = amounts.slice(0, 10).reduce((sum, amount) => sum + amount, 0);
  return (top / supply) * 100;
}

/**
 * Steady-state credits for coins that reach the screen, counted once per new mint.
 * Mint account, curve account, one first-slot signature scan, and holders with owners.
 * A single pass's uncached backlog is not a day's new mints: that is what made the
 * old projection about 58x low against a full day of creates.
 */
export function screenCreditProjection(newMintsPerDay: number): {
  perDay: number;
  perMonth: number;
} {
  const perMint =
    rpcCredits("getAccountInfo") * 2 +
    rpcCredits("getSignaturesForAddress") +
    rpcCredits("getTokenLargestAccounts") +
    rpcCredits("getMultipleAccounts") * 2;
  const perDay = Math.max(0, newMintsPerDay) * perMint;
  return { perDay, perMonth: perDay * 30 };
}

export function parsePumpCurve(data: Uint8Array): {
  virtualTokenRaw: bigint;
  virtualSolLamports: bigint;
  realTokenRaw: bigint;
  realSolLamports: bigint;
} | null {
  if (data.length < 40) return null;
  return {
    virtualTokenRaw: readU64(data, 8),
    virtualSolLamports: readU64(data, 16),
    realTokenRaw: readU64(data, 24),
    realSolLamports: readU64(data, 32),
  };
}

/** Raydium LaunchLab PoolState: 8 disc + epoch u64 + 5 u8, then supply, total_base_sell, virtual_base, virtual_quote. */
export const LAUNCHLAB_VIRTUAL_BASE_OFFSET = 37;
export const LAUNCHLAB_VIRTUAL_QUOTE_OFFSET = 45;

export function parseLaunchLabCurve(data: Uint8Array): {
  virtualTokenRaw: bigint;
  virtualSolLamports: bigint;
} | null {
  if (data.length < LAUNCHLAB_VIRTUAL_QUOTE_OFFSET + 8) return null;
  return {
    virtualTokenRaw: readU64(data, LAUNCHLAB_VIRTUAL_BASE_OFFSET),
    virtualSolLamports: readU64(data, LAUNCHLAB_VIRTUAL_QUOTE_OFFSET),
  };
}

/**
 * Meteora DBC virtual pool: 8-byte disc, 64-byte VolatilityTracker, five pubkeys,
 * then base_reserve at 232 and quote_reserve at 240.
 * modeledSellQuote treats those reserves as a constant-product pool. DBC itself
 * prices from sqrt_price, so this is a rough reserve approximation.
 */
export const METEORA_BASE_RESERVE_OFFSET = 232;
export const METEORA_QUOTE_RESERVE_OFFSET = 240;

export function parseMeteoraCurve(data: Uint8Array): {
  virtualTokenRaw: bigint;
  virtualSolLamports: bigint;
} | null {
  if (data.length < METEORA_QUOTE_RESERVE_OFFSET + 8) return null;
  return {
    virtualTokenRaw: readU64(data, METEORA_BASE_RESERVE_OFFSET),
    virtualSolLamports: readU64(data, METEORA_QUOTE_RESERVE_OFFSET),
  };
}

/** Official Meteora DBC program. Inventory lives in base_vault, a token account. */
export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
/** VirtualPool: 8-byte disc + 64-byte VolatilityTracker + config + creator, then mint and vaults. */
export const DBC_BASE_MINT_OFFSET = 136;
export const DBC_BASE_VAULT_OFFSET = 168;
export const DBC_QUOTE_VAULT_OFFSET = 200;

/** Token accounts that hold DBC curve inventory. Their owners are often system wallets. */
export function parseDbcVaults(data: Uint8Array): { baseVault: string; quoteVault: string } | null {
  if (data.length < DBC_QUOTE_VAULT_OFFSET + 32) return null;
  return {
    baseVault: encodeBase58(data.subarray(DBC_BASE_VAULT_OFFSET, DBC_BASE_VAULT_OFFSET + 32)),
    quoteVault: encodeBase58(data.subarray(DBC_QUOTE_VAULT_OFFSET, DBC_QUOTE_VAULT_OFFSET + 32)),
  };
}

export function parseVenueCurve(
  data: Uint8Array,
  venue: string,
): {
  venue: "pump" | "launchlab" | "meteora";
  virtualTokenRaw: bigint;
  virtualSolLamports: bigint;
} | null {
  if (venue === "launchlab") {
    const launch = parseLaunchLabCurve(data);
    if (!launch || launch.virtualSolLamports <= 0n || launch.virtualTokenRaw <= 0n) return null;
    return { venue: "launchlab", ...launch };
  }
  if (venue === "meteora" || venue === "dbc") {
    const meteora = parseMeteoraCurve(data);
    if (!meteora || meteora.virtualSolLamports <= 0n || meteora.virtualTokenRaw <= 0n) return null;
    return { venue: "meteora", ...meteora };
  }
  if (venue !== "pump" && venue !== "pumpswap") return null;
  const pump = parsePumpCurve(data);
  if (!pump || pump.virtualSolLamports <= 0n) return null;
  const token = pump.virtualTokenRaw > 0n ? pump.virtualTokenRaw : 1n;
  return { venue: "pump", virtualSolLamports: pump.virtualSolLamports, virtualTokenRaw: token };
}

/** Virtual SOL is the reserve the curve quotes against. Real SOL is the cash in the account. */
export function curveLiquidityUsd(
  reserves: { virtualSolLamports: bigint; realSolLamports: bigint },
  solPriceUsd: number,
): number | null {
  if (!(solPriceUsd > 0)) return null;
  const virtual = Number(reserves.virtualSolLamports) / 1_000_000_000;
  const real = Number(reserves.realSolLamports) / 1_000_000_000;
  const sol = virtual > 0 ? virtual : real;
  if (!(sol > 0)) return 0;
  return sol * solPriceUsd;
}

const holderCache = new Map<string, { pct: number; at: number }>();
const HOLDER_REFRESH_MS = 6 * 60 * 60 * 1000;

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/**
 * Top 10 holder share of total supply, counting wallets only.
 * getTokenLargestAccounts lists token accounts, and before graduation the largest one is the
 * bonding curve's vault (most of the supply). After graduation the pool vaults lead. Counting
 * them put top 10 near 100% for every coin, so it said nothing about real concentration.
 * A holder counts when its token account's owner is a system-owned wallet. Program-owned
 * owners (curve, pool authority PDAs) and owners with no account are excluded.
 */
export function walletTopHolderPct(
  accounts: readonly { amount: bigint; owner: string | null; ownerProgram: string | null }[],
  supply: bigint,
  excludeOwners: ReadonlySet<string> = new Set(),
): number | null {
  if (supply <= 0n) return null;
  const wallets = accounts
    .filter(
      (row) =>
        row.amount > 0n &&
        row.owner !== null &&
        !excludeOwners.has(row.owner) &&
        row.ownerProgram === SYSTEM_PROGRAM,
    )
    .sort((left, right) => (left.amount > right.amount ? -1 : left.amount < right.amount ? 1 : 0));
  return topHolderPct(
    wallets.map((row) => Number(row.amount)),
    Number(supply),
  );
}

async function rpc<T>(
  fetchImpl: typeof fetch,
  apiKey: string,
  method: string,
  params: unknown[],
): Promise<T | null> {
  const response = await fetchImpl(
    `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { result?: T };
  return body.result ?? null;
}

export async function loadTopHolders(input: {
  apiKey: string;
  mints: readonly string[];
  supplies: ReadonlyMap<string, bigint>;
  /** Bonding curve or pool account per mint. Its vaults never count as a holder. */
  curves?: ReadonlyMap<string, string>;
  nowMs: number;
  fetchImpl?: typeof fetch;
}): Promise<{ rows: Array<{ mint: string; top10Pct: number }>; credits: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rows = [];
  let credits = 0;
  for (const mint of input.mints) {
    const cached = holderCache.get(mint);
    if (cached && input.nowMs - cached.at < HOLDER_REFRESH_MS) {
      rows.push({ mint, top10Pct: cached.pct });
      continue;
    }
    const supply = input.supplies.get(mint);
    if (supply === undefined || supply <= 0n) continue;
    try {
      const largest = await rpc<{ value?: Array<{ address?: string; amount?: string }> }>(
        fetchImpl,
        input.apiKey,
        "getTokenLargestAccounts",
        [mint],
      );
      credits += rpcCredits("getTokenLargestAccounts");
      const listed = (largest?.value ?? [])
        .map((row) => {
          try {
            return { address: row.address ?? "", amount: BigInt(row.amount ?? "0") };
          } catch {
            return { address: row.address ?? "", amount: 0n };
          }
        })
        .filter((row) => row.address !== "" && row.amount > 0n);
      const curve = input.curves?.get(mint);
      if (curve && listed.length > 0) {
        const poolInfo = await rpc<{
          value?: Array<{ owner?: string; data?: [string, string] | string } | null>;
        }>(fetchImpl, input.apiKey, "getMultipleAccounts", [[curve], { encoding: "base64" }]);
        credits += rpcCredits("getMultipleAccounts");
        const account = poolInfo?.value?.[0];
        if (account?.owner === DBC_PROGRAM) {
          const raw = account.data;
          const b64 = Array.isArray(raw) ? raw[0] : raw;
          if (typeof b64 === "string") {
            const vaults = parseDbcVaults(Uint8Array.from(Buffer.from(b64, "base64")));
            if (vaults) {
              const skip = new Set([vaults.baseVault, vaults.quoteVault]);
              for (let i = listed.length - 1; i >= 0; i -= 1) {
                if (skip.has(listed[i]?.address ?? "")) listed.splice(i, 1);
              }
            }
          }
        }
      }
      if (listed.length === 0) continue;
      const tokenInfo = await rpc<{
        value?: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null>;
      }>(fetchImpl, input.apiKey, "getMultipleAccounts", [
        listed.map((row) => row.address),
        { encoding: "jsonParsed" },
      ]);
      credits += rpcCredits("getMultipleAccounts");
      const owners = listed.map(
        (_row, index) => tokenInfo?.value?.[index]?.data?.parsed?.info?.owner ?? null,
      );
      if (owners.every((owner) => owner === null)) continue;
      const unique = [...new Set(owners.filter((owner): owner is string => owner !== null))];
      const ownerInfo = await rpc<{ value?: Array<{ owner?: string } | null> }>(
        fetchImpl,
        input.apiKey,
        "getMultipleAccounts",
        [unique, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }],
      );
      credits += rpcCredits("getMultipleAccounts");
      if (!ownerInfo?.value) continue;
      const programOf = new Map(
        unique.map((owner, index) => [owner, ownerInfo.value?.[index]?.owner ?? null]),
      );
      const pct = walletTopHolderPct(
        listed.map((row, index) => {
          const owner = owners[index] ?? null;
          return {
            amount: row.amount,
            owner,
            ownerProgram: owner === null ? null : (programOf.get(owner) ?? null),
          };
        }),
        supply,
        new Set(curve ? [curve] : []),
      );
      if (pct === null) continue;
      holderCache.set(mint, { pct, at: input.nowMs });
      rows.push({ mint, top10Pct: pct });
    } catch {
      // The coin stays WATCH until a later pass.
    }
  }
  return { rows, credits };
}

/** Newest first, so one page this size covers a young coin back to its create slot. */
export const SNIPER_SIGNATURE_LIMIT = 1000;

/**
 * Share of create-slot transactions that were not the create itself, or null when the page
 * did not reach the create slot. A limit of 20 newest signatures missed the create slot for
 * any coin with real trading, so only near-dead coins got a sniper value and could pass.
 */
export function createSlotSniperPct(
  signatures: readonly { slot?: number }[],
  createdSlot: number,
  limit = SNIPER_SIGNATURE_LIMIT,
): number | null {
  const slots = signatures.map((row) => row.slot ?? Number.NaN);
  const inSlot = slots.filter((slot) => slot === createdSlot).length;
  const oldest = slots.length === 0 ? Number.NaN : Math.min(...slots);
  const reached = slots.length < limit || oldest <= createdSlot;
  if (!reached || inSlot < 1) return null;
  return inSlot === 1 ? 0 : ((inSlot - 1) / inSlot) * 100;
}

export async function loadCreateSlotSnipers(input: {
  apiKey: string;
  coins: readonly { mint: string; bondingCurve: string; createdSlot: number }[];
  fetchImpl?: typeof fetch;
}): Promise<{ rows: Array<{ mint: string; sniperPct: number }>; credits: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rows = [];
  let credits = 0;
  for (const coin of input.coins) {
    try {
      const result = await rpc<Array<{ slot?: number }>>(
        fetchImpl,
        input.apiKey,
        "getSignaturesForAddress",
        [coin.bondingCurve, { limit: SNIPER_SIGNATURE_LIMIT }],
      );
      credits += rpcCredits("getSignaturesForAddress");
      if (!result) continue;
      const sniperPct = createSlotSniperPct(result, coin.createdSlot);
      if (sniperPct === null) continue;
      rows.push({ mint: coin.mint, sniperPct });
    } catch {
      // Unknown stays WATCH.
    }
  }
  return { rows, credits };
}

export async function loadCurveLiquidity(input: {
  apiKey: string;
  coins: readonly { mint: string; bondingCurve: string; venue?: string | null }[];
  solPriceUsd: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  rows: Array<{
    mint: string;
    liquidityUsd: number;
    virtualSolLamports: bigint;
    virtualTokenRaw: bigint;
    venue: "pump" | "launchlab" | "meteora";
  }>;
  credits: number;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rows = [];
  let credits = 0;
  for (const coin of input.coins) {
    try {
      const response = await fetchImpl(
        `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [coin.bondingCurve, { encoding: "base64" }],
          }),
        },
      );
      credits += rpcCredits("getAccountInfo");
      if (!response.ok) continue;
      const body = (await response.json()) as {
        result?: { value?: { data?: [string, string] } };
      };
      const encoded = body.result?.value?.data?.[0];
      if (!encoded) continue;
      const parsed = parseVenueCurve(Buffer.from(encoded, "base64"), coin.venue ?? "pump");
      if (!parsed) continue;
      const liquidityUsd = curveLiquidityUsd(
        { virtualSolLamports: parsed.virtualSolLamports, realSolLamports: 0n },
        input.solPriceUsd,
      );
      if (liquidityUsd === null) continue;
      rows.push({ mint: coin.mint, liquidityUsd, ...parsed });
    } catch {
      // Missing reserves stay unknown until the next pass.
    }
  }
  return { rows, credits };
}

export async function loadMintAuthorities(input: {
  apiKey: string;
  mints: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<{
  rows: Array<{
    mint: string;
    mintAuthorityActive: boolean;
    freezeAuthorityActive: boolean;
    supply: bigint;
  }>;
  credits: number;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rows = [];
  let credits = 0;
  for (const mint of input.mints) {
    try {
      const response = await fetchImpl(
        `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [mint, { encoding: "base64" }],
          }),
        },
      );
      credits += rpcCredits("getAccountInfo");
      if (!response.ok) continue;
      const body = (await response.json()) as {
        result?: { value?: { data?: [string, string] } };
      };
      const encoded = body.result?.value?.data?.[0];
      if (!encoded) continue;
      const parsed = parseMintAccount(Buffer.from(encoded, "base64"));
      if (parsed) rows.push({ mint, ...parsed });
    } catch {
      // A missed account stays WATCH until the next pass.
    }
  }
  return { rows, credits };
}

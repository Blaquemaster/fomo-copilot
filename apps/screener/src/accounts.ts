import { rpcCredits } from "@fomo/core";

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

/** One getAccountInfo per new mint, and getTokenLargestAccounts four times a day. Both are 1 credit. */
export function screenCreditProjection(newMintsPerDay: number): {
  perDay: number;
  perMonth: number;
} {
  const perMint = rpcCredits("getAccountInfo") + rpcCredits("getTokenLargestAccounts") * 4;
  const perDay = Math.max(0, newMintsPerDay) * perMint;
  return { perDay, perMonth: perDay * 30 };
}

const holderCache = new Map<string, { pct: number; at: number }>();
const HOLDER_REFRESH_MS = 6 * 60 * 60 * 1000;

export async function loadTopHolders(input: {
  apiKey: string;
  mints: readonly string[];
  supplies: ReadonlyMap<string, bigint>;
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
      const response = await fetchImpl(
        `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenLargestAccounts",
            params: [mint],
          }),
        },
      );
      credits += rpcCredits("getTokenLargestAccounts");
      if (!response.ok) continue;
      const body = (await response.json()) as {
        result?: { value?: Array<{ amount?: string }> };
      };
      const amounts = (body.result?.value ?? [])
        .map((row) => {
          try {
            return BigInt(row.amount ?? "0");
          } catch {
            return 0n;
          }
        })
        .filter((amount) => amount > 0n);
      const pct = topHolderPct(
        amounts.map((amount) => Number(amount)),
        Number(supply),
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

export async function loadMintAuthorities(input: {
  apiKey: string;
  mints: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<
  Array<{
    mint: string;
    mintAuthorityActive: boolean;
    freezeAuthorityActive: boolean;
    supply: bigint;
  }>
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rows = [];
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
  return rows;
}

import { rpcCredits } from "@fomo/core";

export function parseMintAccount(data: Uint8Array): {
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
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

export async function loadMintAuthorities(input: {
  apiKey: string;
  mints: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<Array<{ mint: string; mintAuthorityActive: boolean; freezeAuthorityActive: boolean }>> {
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

import { quoteUrlAllowed } from "../phasec/market.js";
import type { PaperArm, Stage } from "../phasec/protocol.js";
import { rpcCredits } from "../ingest/budget.js";

export type AutobuyMode = "off" | "dry_run" | "live";

/** Public key only. This build never loads or signs with a private key. */
export interface Signer {
  publicKey(): string | null;
}

export function noopSigner(): Signer {
  return { publicKey: () => null };
}

export const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v1/swap";

export interface AutobuyLimits {
  maxConcurrent: number;
  dailyLossCutoffPct: number;
  maxTradeUsd: number;
  dailyUsdCap: number;
  killed: boolean;
}

export function autobuyLimits(input: {
  maxConcurrent?: number;
  dailyLossCutoffPct?: number;
  maxTradeUsd?: number;
  dailyUsdCap?: number;
  killed?: boolean;
}): AutobuyLimits {
  return {
    maxConcurrent: input.maxConcurrent ?? 5,
    dailyLossCutoffPct: input.dailyLossCutoffPct ?? 3,
    maxTradeUsd: input.maxTradeUsd ?? 25,
    dailyUsdCap: input.dailyUsdCap ?? 100,
    killed: input.killed ?? false,
  };
}

/**
 * Live mode cannot start in this build. A signer public key and
 * AUTOBUY_LIVE_CONFIRMED are both required, and signing is not implemented.
 */
export function resolveAutobuyMode(input: {
  mode?: AutobuyMode;
  liveConfirmed?: boolean;
  signer?: Signer;
  killed?: boolean;
}): { mode: "off" | "dry_run" } {
  if (input.killed) return { mode: "off" };
  const mode = input.mode ?? "off";
  if (mode === "off") return { mode: "off" };
  if (mode === "live") {
    const signer = input.signer ?? noopSigner();
    if (!input.liveConfirmed || signer.publicKey() === null) {
      throw new Error("live autobuy refused: a signer and AUTOBUY_LIVE_CONFIRMED are required");
    }
    throw new Error("live autobuy refused: signing is not implemented");
  }
  return { mode: "dry_run" };
}

export function admitAutobuy(input: {
  arm: PaperArm | string;
  sizeUsd: number | null;
  sizePct: number;
  bankroll: number | null;
  openCount: number;
  dailySpentUsd: number;
  dailyLossPct: number;
  paused: boolean;
  limits: AutobuyLimits;
}): { ok: true } | { ok: false; reason: string } {
  if (input.limits.killed) return { ok: false, reason: "kill_switch" };
  if (input.arm === "random_pass") return { ok: false, reason: "control" };
  if (input.paused || input.dailyLossPct >= input.limits.dailyLossCutoffPct) {
    return { ok: false, reason: "daily_loss" };
  }
  if (input.openCount >= input.limits.maxConcurrent) return { ok: false, reason: "max_open" };
  if (input.sizeUsd === null || !(input.sizeUsd > 0)) return { ok: false, reason: "no_size" };
  if (input.bankroll !== null && input.bankroll > 0) {
    const stageUsd = (input.bankroll * input.sizePct) / 100;
    if (input.sizeUsd > stageUsd * 1.001) return { ok: false, reason: "stage_cap" };
  }
  if (input.sizeUsd > input.limits.maxTradeUsd) return { ok: false, reason: "trade_cap" };
  if (input.dailySpentUsd + input.sizeUsd > input.limits.dailyUsdCap) {
    return { ok: false, reason: "daily_cap" };
  }
  return { ok: true };
}

export interface AutobuyIntent {
  kind: "entry" | "exit";
  mint: string;
  arm: string;
  stage: Stage | string;
  sizeUsd: number | null;
  quotePrice: number | null;
  expectedOut: string | null;
  slippageBps: number | null;
  reason: string;
  simulated: "ok" | "err" | "skipped";
}

export async function buildJupiterSwapTx(input: {
  quoteResponse: unknown;
  userPublicKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ swapTransaction: string } | { error: string }> {
  if (!quoteUrlAllowed(JUPITER_SWAP_URL)) return { error: "swap build url blocked" };
  try {
    const response = await (input.fetchImpl ?? fetch)(JUPITER_SWAP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: input.quoteResponse,
        userPublicKey: input.userPublicKey,
        wrapAndUnwrapSol: true,
      }),
    });
    if (!response.ok) return { error: `swap build HTTP ${response.status}` };
    const body = (await response.json()) as { swapTransaction?: string };
    if (!body.swapTransaction) return { error: "swap build returned no transaction" };
    return { swapTransaction: body.swapTransaction };
  } catch {
    return { error: "swap build failed" };
  }
}

/** One standard RPC credit. Unsigned simulation only; nothing is sent. */
export async function simulateSwapTransaction(input: {
  apiKey: string;
  swapTransaction: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; error: string | null; credits: number }> {
  const credits = rpcCredits("simulateTransaction");
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: [
            input.swapTransaction,
            { encoding: "base64", replaceRecentBlockhash: true, sigVerify: false },
          ],
        }),
      },
    );
    if (!response.ok) return { ok: false, error: `simulate HTTP ${response.status}`, credits };
    const body = (await response.json()) as { result?: { value?: { err?: unknown } } };
    const err = body.result?.value?.err;
    if (err) return { ok: false, error: "simulation rejected", credits };
    return { ok: true, error: null, credits };
  } catch {
    return { ok: false, error: "simulation failed", credits };
  }
}

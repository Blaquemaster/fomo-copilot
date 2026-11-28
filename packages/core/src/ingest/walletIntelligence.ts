import { netFromDelayedMarks } from "../phasec/quote.js";
import type { EarlyBuy } from "./wallets.js";

export type MovementClass =
  "swap" | "transfer" | "wrapped_sol" | "fee" | "account" | "unclassified";

export interface WalletMeasures {
  wallet: string;
  mint: string;
  graduation: { graduated: boolean; countedAsWin: false };
  ownResult: { status: "present"; fillPriceUsd: number } | { status: "insufficient" };
  follower: {
    status: "present" | "insufficient";
    jupiterNet: number | null;
    sensitivityFomoNet: number | null;
  };
}

/** Graduation, the wallet's own fill, and a delayed follower result stay separate. */
export function walletMeasures(row: EarlyBuy, jupiterNet: number | null = null): WalletMeasures {
  const sensitivityFomoNet =
    row.delayedMarkUsd != null && row.exitMarkUsd != null
      ? netFromDelayedMarks(row.delayedMarkUsd, row.exitMarkUsd)
      : null;
  const own =
    row.fillPriceUsd != null && Number.isFinite(row.fillPriceUsd)
      ? ({ status: "present", fillPriceUsd: row.fillPriceUsd } as const)
      : ({ status: "insufficient" } as const);
  return {
    wallet: row.wallet,
    mint: row.mint,
    graduation: { graduated: row.graduated, countedAsWin: false },
    ownResult: own,
    follower: {
      status: jupiterNet === null ? "insufficient" : "present",
      jupiterNet,
      sensitivityFomoNet,
    },
  };
}

const CLASSES: readonly { name: MovementClass; words: readonly string[] }[] = [
  { name: "swap", words: ["buy", "sell", "swap", "trade"] },
  { name: "transfer", words: ["transfer", "transferchecked"] },
  { name: "wrapped_sol", words: ["wrap", "unwrap", "syncnative", "wsol"] },
  { name: "fee", words: ["fee", "commission"] },
  { name: "account", words: ["createaccount", "closeaccount", "assign"] },
];

export function classifyMovement(instructionName: string): MovementClass {
  const name = instructionName.toLowerCase().replace(/[^a-z]/g, "");
  return (
    CLASSES.find((row) => row.words.some((word) => name.includes(word)))?.name ?? "unclassified"
  );
}

export interface WalletEvidence {
  wallet: string;
  sampleSize: number;
  missing: number;
  holdingPeriodMs: number | null;
  downside: number | null;
  concentration: number | null;
}

export function walletEvidence(input: {
  wallet: string;
  rows: readonly {
    boughtAt: Date | null;
    exitedAt: Date | null;
    followerNet: number | null;
  }[];
}): WalletEvidence {
  const known = input.rows.filter((row) => row.followerNet !== null);
  const holds = input.rows
    .filter((row) => row.boughtAt !== null && row.exitedAt !== null)
    .map((row) => row.exitedAt!.getTime() - row.boughtAt!.getTime())
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
  const losses = known.map((row) => row.followerNet ?? 0).filter((value) => value < 0);
  const wins = known.map((row) => row.followerNet ?? 0).filter((value) => value > 0);
  const winSum = wins.reduce((sum, value) => sum + value, 0);
  return {
    wallet: input.wallet,
    sampleSize: input.rows.length,
    missing: input.rows.length - known.length,
    holdingPeriodMs: holds.length === 0 ? null : holds[Math.floor((holds.length - 1) / 2)]!,
    downside: losses.length === 0 ? null : Math.min(...losses),
    concentration: winSum === 0 ? null : Math.max(...wins) / winSum,
  };
}

/** A shared funder is recorded. It does not merge the wallets and it is not common control. */
export function sharedFunding(
  rows: readonly { wallet: string; funder: string | null }[],
): { funder: string; wallets: string[]; commonControl: false }[] {
  const byFunder = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.funder === null) continue;
    const wallets = byFunder.get(row.funder) ?? new Set<string>();
    wallets.add(row.wallet);
    byFunder.set(row.funder, wallets);
  }
  return [...byFunder.entries()]
    .filter(([, wallets]) => wallets.size > 1)
    .map(([funder, wallets]) => ({
      funder,
      wallets: [...wallets].sort(),
      commonControl: false as const,
    }));
}

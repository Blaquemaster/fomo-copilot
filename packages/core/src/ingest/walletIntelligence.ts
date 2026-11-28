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

export function walletPersistencePayload(rows: readonly EarlyBuy[]): {
  measures: {
    wallet: string;
    mint: string;
    kind: string;
    status: string;
    value: number | null;
  }[];
  movements: { instructionName: string; class: MovementClass }[];
  evidence: {
    wallet: string;
    sampleSize: number;
    missing: number;
    holdingPeriodMs: number | null;
    downside: number | null;
    concentration: number | null;
  }[];
  funding: { funder: string; wallet: string }[];
} {
  const buys = rows.filter((row) => row.side === "buy" && row.wallet && row.mint);
  const measures = buys.flatMap((row) => {
    const measured = walletMeasures(row, null);
    return [
      {
        wallet: row.wallet,
        mint: row.mint,
        kind: "graduation",
        status: measured.graduation.graduated ? "present" : "insufficient",
        value: measured.graduation.countedAsWin ? 1 : 0,
      },
      {
        wallet: row.wallet,
        mint: row.mint,
        kind: "own_result",
        status: measured.ownResult.status,
        value: measured.ownResult.status === "present" ? measured.ownResult.fillPriceUsd : null,
      },
      {
        wallet: row.wallet,
        mint: row.mint,
        kind: "follower",
        status: measured.follower.status,
        value: measured.follower.jupiterNet,
      },
    ];
  });
  const byWallet = new Map<string, EarlyBuy[]>();
  for (const row of buys) {
    const list = byWallet.get(row.wallet) ?? [];
    list.push(row);
    byWallet.set(row.wallet, list);
  }
  const evidence = [...byWallet.entries()].map(([wallet, list]) => {
    const report = walletEvidence({
      wallet,
      rows: list.map((row) => ({
        boughtAt: row.boughtAt instanceof Date ? row.boughtAt : null,
        exitedAt: row.delayedMarkAt instanceof Date ? row.delayedMarkAt : null,
        followerNet:
          row.delayedMarkUsd != null && row.exitMarkUsd != null
            ? row.exitMarkUsd - row.delayedMarkUsd
            : null,
      })),
    });
    return {
      wallet,
      sampleSize: report.sampleSize,
      missing: report.missing,
      holdingPeriodMs: report.holdingPeriodMs,
      downside: report.downside,
      concentration: report.concentration,
    };
  });
  return {
    measures,
    movements: buys.map((row) => ({
      instructionName: row.side,
      class: classifyMovement(row.side),
    })),
    evidence,
    funding: sharedFunding(
      buys.map((row) => ({ wallet: row.wallet, funder: row.funder ?? null })),
    ).flatMap((row) => row.wallets.map((wallet) => ({ funder: row.funder, wallet }))),
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

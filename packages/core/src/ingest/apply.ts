import { TOKEN_MAX_AGE_MS, type EventKind } from "./programs.js";
import type { Observation } from "./decode.js";

export interface CandidateDraft {
  mint: string;
  pool: string;
  poolType: Observation["poolType"];
  creatorWallet: string | null;
  firstSeenSlot: number;
  firstSeenAtMs: number;
  sourceSignature: string;
}

export interface CurveMark {
  pool: string;
  slot: number;
  atMs: number;
}

export interface GraduationMark {
  virtualPool: string;
  graduatedPool: string;
  atMs: number;
}

export interface ApplyResult {
  inserted: Observation[];
  candidates: CandidateDraft[];
  curves: CurveMark[];
  graduations: GraduationMark[];
}

export function tokenIsYoung(
  firstSeenAtMs: number | null,
  nowMs: number,
  windowMs = TOKEN_MAX_AGE_MS,
): boolean {
  if (firstSeenAtMs === null) return false;
  return nowMs - firstSeenAtMs <= windowMs && nowMs >= firstSeenAtMs;
}

/**
 * Dedupe is the caller's insertRaw boolean. This plans the candidate side effects
 * for observations that were newly stored.
 */
export function planCandidateWrites(input: {
  observation: Observation;
  nowMs: number;
  earliestFirstSeenMs: number | null;
}): {
  candidate: CandidateDraft | null;
  curve: CurveMark | null;
  graduation: GraduationMark | null;
} {
  const atMs = input.observation.blockTimeMs ?? input.nowMs;
  const base = {
    creatorWallet: input.observation.creatorWallet,
    firstSeenSlot: input.observation.slot,
    firstSeenAtMs: atMs,
    sourceSignature: input.observation.signature,
  };
  if (
    input.observation.kind === "dbc_initialize" &&
    input.observation.mint &&
    input.observation.pool
  ) {
    return {
      candidate: {
        ...base,
        mint: input.observation.mint,
        pool: input.observation.pool,
        poolType: "dbc",
      },
      curve: null,
      graduation: null,
    };
  }
  if (input.observation.kind === "dbc_curve_complete" && input.observation.pool) {
    return {
      candidate: null,
      curve: { pool: input.observation.pool, slot: input.observation.slot, atMs },
      graduation: null,
    };
  }
  if (
    input.observation.kind === "dbc_migration_damm_v2" &&
    input.observation.mint &&
    input.observation.pool
  ) {
    return {
      candidate: {
        ...base,
        mint: input.observation.mint,
        pool: input.observation.pool,
        poolType: "damm_v2",
      },
      curve: null,
      graduation:
        input.observation.virtualPool === null
          ? null
          : {
              virtualPool: input.observation.virtualPool,
              graduatedPool: input.observation.pool,
              atMs,
            },
    };
  }
  if (isAgeGated(input.observation.kind) && input.observation.mint && input.observation.pool) {
    if (!tokenIsYoung(input.earliestFirstSeenMs, atMs)) {
      return { candidate: null, curve: null, graduation: null };
    }
    return {
      candidate: {
        ...base,
        mint: input.observation.mint,
        pool: input.observation.pool,
        poolType: input.observation.poolType,
      },
      curve: null,
      graduation: null,
    };
  }
  return { candidate: null, curve: null, graduation: null };
}

function isAgeGated(kind: EventKind): boolean {
  return kind === "damm_v2_initialize" || kind === "dlmm_initialize";
}

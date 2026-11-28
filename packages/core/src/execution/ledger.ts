import { maySubmitToNetwork, type ExecutionCost } from "./contract.js";

export type RiskMode = "open" | "entries_paused" | "exits_only" | "signing_halt";

export interface Reservation {
  id: string;
  mint: string;
  purpose: "entry" | "exit" | "reconciliation";
  amount: number;
}

export interface RiskAuthorization {
  intentId: string;
  txMessage: string;
  wallet: string;
  assets: readonly string[];
  maxSpend: number;
  maxFees: number;
  expiresAt: number;
}

export interface LedgerEvent {
  intentId: string;
  kind: string;
  at: number;
}

export class ExecutionLedger {
  readonly events: LedgerEvent[] = [];
  readonly reservations: Reservation[] = [];
  readonly authorizations: RiskAuthorization[] = [];

  constructor(
    private readonly bankroll: number,
    private readonly exitReserve: number,
  ) {}

  private append(intentId: string, kind: string, at: number): void {
    this.events.push({ intentId, kind, at });
  }

  reserve(
    input: Reservation & { at: number; mode: RiskMode },
  ): { ok: true } | { ok: false; reason: string } {
    if (
      input.purpose === "entry" &&
      (input.mode === "entries_paused" || input.mode === "exits_only")
    ) {
      this.append(input.id, "reserve_refused", input.at);
      return { ok: false, reason: input.mode };
    }
    if (input.mode === "signing_halt") {
      this.append(input.id, "reserve_refused", input.at);
      return { ok: false, reason: "signing_halt" };
    }
    const used = this.reservations.reduce((sum, row) => sum + row.amount, 0);
    const protectedCash = input.purpose === "entry" ? this.exitReserve : 0;
    if (used + input.amount + protectedCash > this.bankroll) {
      this.append(input.id, "reserve_refused", input.at);
      return { ok: false, reason: "reserved_for_exit" };
    }
    this.reservations.push({
      id: input.id,
      mint: input.mint,
      purpose: input.purpose,
      amount: input.amount,
    });
    this.append(input.id, "reserved", input.at);
    return { ok: true };
  }

  authorize(
    input: RiskAuthorization & { at: number; reserved: boolean },
  ): { ok: true } | { ok: false; reason: string } {
    if (!input.reserved) return { ok: false, reason: "reservation_required" };
    if (this.authorizations.some((row) => row.intentId === input.intentId)) {
      return { ok: false, reason: "single_intent" };
    }
    this.authorizations.push({
      intentId: input.intentId,
      txMessage: input.txMessage,
      wallet: input.wallet,
      assets: input.assets,
      maxSpend: input.maxSpend,
      maxFees: input.maxFees,
      expiresAt: input.expiresAt,
    });
    this.append(input.intentId, "authorized", input.at);
    return { ok: true };
  }

  matches(input: {
    authorization: RiskAuthorization;
    txMessage: string;
    wallet: string;
    assets: readonly string[];
    spend: number;
    fees: number;
    at: number;
  }): boolean {
    return (
      input.authorization.txMessage === input.txMessage &&
      input.authorization.wallet === input.wallet &&
      input.authorization.assets.join(",") === input.assets.join(",") &&
      input.spend <= input.authorization.maxSpend &&
      input.fees <= input.authorization.maxFees &&
      input.at <= input.authorization.expiresAt
    );
  }

  submit(at: number, intentId: string): { ok: false; reason: "submission_boundary_held" } {
    this.append(intentId, "submission_held", at);
    maySubmitToNetwork();
    return { ok: false, reason: "submission_boundary_held" };
  }
}

export function estimatedFee(cost: ExecutionCost): number {
  return (cost.platformFee ?? 0) + (cost.networkFee ?? 0) + (cost.tip ?? 0);
}

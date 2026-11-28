import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import {
  emptyCost,
  replacementAllowed,
  reviewInstructions,
  type ExecutionCost,
  type ExecutionState,
  type ReviewedInstruction,
  type RouteCoverage,
} from "./contract.js";
import { ExecutionLedger, type RiskMode } from "./ledger.js";

export interface KillSwitches {
  entriesPaused: boolean;
  exitsOnly: boolean;
  signingPaused: boolean;
}

export interface ExecutionOrder {
  id: string;
  mint: string;
  stage: RouteCoverage["stage"];
  side: "buy" | "sell";
  owner: string;
  state: ExecutionState;
  reserved: number;
  decisionAt: number;
  submittedAt: number | null;
  latencyMs: number | null;
  coverage: RouteCoverage;
  cost: ExecutionCost;
  signature: string | null;
  reason: string | null;
}

export interface TestSigner {
  kind: "test";
  publicKey: string;
  privateKey: KeyObject;
}

export function createTestSigner(): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    kind: "test",
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    privateKey,
  };
}

export class ExecutionBook {
  readonly orders: ExecutionOrder[] = [];
  readonly ledger: ExecutionLedger;
  cashReserved = 0;

  constructor(
    private readonly switches: KillSwitches,
    private readonly signer: TestSigner | null,
    bankroll: number,
    exitReserve = 0,
  ) {
    this.ledger = new ExecutionLedger(bankroll, exitReserve);
  }

  private mode(): RiskMode {
    if (this.switches.signingPaused) return "signing_halt";
    if (this.switches.exitsOnly) return "exits_only";
    if (this.switches.entriesPaused) return "entries_paused";
    return "open";
  }

  signal(input: {
    mint: string;
    stage: RouteCoverage["stage"];
    side: "buy" | "sell";
    owner: string;
    amount: number;
    coverage: RouteCoverage;
    instructions: readonly ReviewedInstruction[];
    allowedAccounts: readonly string[];
    at: number;
  }): ExecutionOrder {
    const existing = this.orders.find((order) => order.mint === input.mint && order.side === "buy");
    if (input.side === "buy" && existing && !replacementAllowed(existing.state)) {
      return this.record({
        ...input,
        state: existing.state,
        reserved: 0,
        reason: "replacement_blocked",
        signature: null,
        submittedAt: null,
      });
    }
    if (input.side === "buy" && (this.switches.entriesPaused || this.switches.exitsOnly)) {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: this.switches.exitsOnly ? "exits_only" : "entries_paused",
        signature: null,
        submittedAt: null,
      });
    }
    if (input.coverage.buy === "unavailable" || input.coverage.sell === "unavailable") {
      return this.record({
        ...input,
        state: "unfilled",
        reserved: 0,
        reason: "route_unavailable",
        signature: null,
        submittedAt: null,
      });
    }
    if (this.switches.signingPaused) {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: "signing_paused",
        signature: null,
        submittedAt: null,
      });
    }
    const reservation = this.ledger.reserve({
      id: `${input.mint}:${input.side}`,
      mint: input.mint,
      purpose: input.side === "buy" ? "entry" : "exit",
      amount: input.amount,
      at: input.at,
      mode: this.mode(),
    });
    if (!reservation.ok) {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: reservation.reason,
        signature: null,
        submittedAt: null,
      });
    }
    const review = reviewInstructions({
      instructions: input.instructions,
      reservedAmount: input.amount,
      allowedDestination: input.mint,
      allowedAccounts: input.allowedAccounts,
    });
    if (!review.ok) {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: review.reason,
        signature: null,
        submittedAt: null,
      });
    }
    if (this.signer === null || this.signer.kind !== "test") {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: "signer_refused",
        signature: null,
        submittedAt: null,
      });
    }
    const txMessage = `${input.mint}:${input.amount}:${input.at}`;
    const authorization = this.ledger.authorize({
      intentId: `${input.mint}:${input.side}`,
      txMessage,
      wallet: input.owner,
      assets: [input.mint],
      maxSpend: input.amount,
      maxFees: 0,
      expiresAt: input.at,
      at: input.at,
      reserved: true,
    });
    if (!authorization.ok) {
      return this.record({
        ...input,
        state: "rejected",
        reserved: 0,
        reason: authorization.reason,
        signature: null,
        submittedAt: null,
      });
    }
    const signature = sign(null, Buffer.from(txMessage), this.signer.privateKey).toString(
      "base64url",
    );
    const held = this.ledger.submit(input.at, `${input.mint}:${input.side}`);
    if (input.side === "buy") this.cashReserved += input.amount;
    return this.record({
      ...input,
      state: "authorized",
      reserved: input.side === "buy" ? input.amount : 0,
      reason: held.reason,
      signature,
      submittedAt: null,
    });
  }

  markUncertain(id: string): void {
    const order = this.orders.find((item) => item.id === id);
    if (order) order.state = "uncertain";
  }

  timeout(id: string, at: number): ExecutionOrder | null {
    const order = this.orders.find((item) => item.id === id);
    if (!order) return null;
    if (order.state === "uncertain" || order.state === "submitted") {
      order.reason = "timeout_is_not_a_new_buy";
      return order;
    }
    order.state = "rejected";
    order.reason = "timeout";
    order.latencyMs = at - order.decisionAt;
    return order;
  }

  private record(input: {
    mint: string;
    stage: RouteCoverage["stage"];
    side: "buy" | "sell";
    owner: string;
    amount: number;
    coverage: RouteCoverage;
    at: number;
    state: ExecutionState;
    reserved: number;
    reason: string | null;
    signature: string | null;
    submittedAt: number | null;
  }): ExecutionOrder {
    const order: ExecutionOrder = {
      id: `${input.mint}:${input.side}:${this.orders.length}`,
      mint: input.mint,
      stage: input.stage,
      side: input.side,
      owner: input.owner,
      state: input.state,
      reserved: input.reserved,
      decisionAt: input.at,
      submittedAt: input.submittedAt,
      latencyMs:
        input.state === "authorized"
          ? 0
          : input.submittedAt === null
            ? null
            : input.submittedAt - input.at,
      coverage: input.coverage,
      cost: emptyCost(),
      signature: input.signature,
      reason: input.reason,
    };
    this.orders.push(order);
    return order;
  }
}

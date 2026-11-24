import { describe, expect, it } from "vitest";

import { inUnrecoveredGap } from "../ingest/feedAlerts.js";
import { fillAmountUsable } from "../ingest/fillCheck.js";
import { serviceEnabled } from "../runtime/serviceGate.js";
import { bookScaleHalf, quotedRoundTrip } from "./quote.js";
import { exitStateFor } from "./quoteState.js";
import { shouldBookDead } from "./dead.js";

const bid = (price: number) => ({
  ok: true as const,
  execPriceUsd: price,
  midPriceUsd: price,
  impactPct: 1,
  feeUsd: 0,
  sizeUsd: 10,
  liquidityUsd: 1000,
  inAmount: "1",
  outAmount: "1",
});

describe("combined behavior", () => {
  it("flags an entry made during an outage and does not restart paper by itself", () => {
    const gap = {
      start: new Date("2026-11-23T12:56:58.000Z"),
      end: new Date("2026-11-23T13:15:33.000Z"),
    };
    expect(inUnrecoveredGap(new Date("2026-11-23T13:00:00.000Z"), [gap])).toBe(true);
    expect(serviceEnabled(undefined)).toBe(false);
  });

  it("does not book a migration as dead while the new pool is tradable", () => {
    expect(
      shouldBookDead({
        streak: {
          streak: 3,
          firstAt: new Date(0),
          lastAt: new Date(120_000),
        },
        now: new Date(120_000),
        requiredStreak: 3,
        gapMs: 60_000,
        pool: "tradable",
      }),
    ).toBe(false);
  });

  it("does not treat a duplicate null amount as a quantity", () => {
    expect(fillAmountUsable({ mint: "coin", solAmount: null, tokenAmount: null }).usable).toBe(
      false,
    );
  });

  it("keeps the scale-out accounting and leaves a partial sale off unless asked", () => {
    const entry = bid(1);
    const peak = bid(1.5);
    const booked = bookScaleHalf(entry, peak);
    expect(booked?.quote).toBe(1.5);
    expect(quotedRoundTrip(entry, bid(0.7))).toBeLessThan(0);
  });

  it("keeps a missing quote unresolved instead of booking a loss", () => {
    expect(
      exitStateFor({
        bid: undefined,
        horizonReached: true,
        onChainUntradable: false,
        transferRestricted: false,
        netIfPriced: null,
      }).state,
    ).toBe("unresolved");
  });
});

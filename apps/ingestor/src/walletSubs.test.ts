import { Writable } from "node:stream";

import { createLogger, MICROS_PER_CREDIT } from "@fomo/core";
import { describe, expect, it } from "vitest";

import { createWalletSubscriptions, type WalletSubSocket } from "./walletSubs.js";

describe("wallet subscriptions", () => {
  it("replaces the live set and unsubscribes when the cap is reached", () => {
    const socket = fakeSocket();
    const wallets = ["old-wallet"];
    const subs = createWalletSubscriptions({
      ws: socket,
      logger: logger(),
      capMicros: 2n * MICROS_PER_CREDIT,
      spentMicros: 0n,
      wallets: () => wallets,
    });
    subs.subscribe();
    const first = JSON.parse(socket.sent[0] ?? "{}") as { id: number; method: string };
    expect(first.method).toBe("parsedTransactionSubscribe");
    expect(first.id).toBe(10);
    subs.onConfirmed(10, 77);
    expect(subs.isWalletEvent(77)).toBe(true);
    expect(subs.isWalletEvent(1)).toBe(false);
    wallets.splice(0, 1, "new-wallet");
    subs.subscribe();
    expect(socket.sent.some((frame) => frame.includes("parsedTransactionUnsubscribe"))).toBe(true);
    const created = socket.sent.filter((frame) => frame.includes("parsedTransactionSubscribe"));
    const second = JSON.parse(created.at(-1) ?? "{}") as { id: number };
    expect(socket.sent.at(-1)).toContain("new-wallet");
    subs.onConfirmed(second.id, 88);
    subs.noteCredit(MICROS_PER_CREDIT);
    subs.noteCredit(MICROS_PER_CREDIT);
    const unsubs = socket.sent.filter((frame) => frame.includes("parsedTransactionUnsubscribe"));
    expect(unsubs.some((frame) => frame.includes("88"))).toBe(true);
    expect(subs.metric().open).toBe(false);
  });
});

function fakeSocket(): WalletSubSocket & { sent: string[] } {
  return {
    readyState: 1,
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
  };
}

function logger() {
  return createLogger({
    level: "error",
    app: "ingestor",
    destination: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
}

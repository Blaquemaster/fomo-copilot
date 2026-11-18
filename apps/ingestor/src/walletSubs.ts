import {
  WALLET_TRACK_PROGRAMS,
  WALLET_TRADE_NAMES,
  chunkWallets,
  walletBudgetOpen,
  type Logger,
} from "@fomo/core";

export interface WalletSubSocket {
  readyState: number;
  send: (data: string) => void;
}

export interface WalletSubMetric {
  open: boolean;
  spentMicros: bigint;
  capMicros: bigint;
  subscriptions: number;
}

/**
 * Live wallet subscriptions on one socket. The cap check uses the month already
 * stored plus credits seen since the last flush. Hitting the cap unsubscribes
 * immediately. A later list change unsubscribes the old set and subscribes the new one.
 */
export function createWalletSubscriptions(input: {
  ws: WalletSubSocket;
  logger: Logger;
  capMicros: bigint;
  spentMicros: bigint;
  wallets: () => readonly string[];
}): {
  subscribe: () => void;
  noteCredit: (micros: bigint) => void;
  settleFlushed: (micros: bigint) => void;
  onConfirmed: (requestId: number, subscriptionId: number) => void;
  ownsRequest: (requestId: number) => boolean;
  isWalletEvent: (subscriptionId: number) => boolean;
  metric: () => WalletSubMetric;
} {
  let nextId = 10;
  let generation = 0;
  let accounted = input.spentMicros;
  let pending = 0n;
  let stopped = !walletBudgetOpen(accounted, input.capMicros);
  let subscribedKey = "";
  const pendingGen = new Map<number, number>();
  const owned = new Set<number>();
  const live = new Set<number>();
  const seen = new Set<number>();

  const alloc = (): number => {
    const id = nextId;
    nextId += 1;
    if (nextId === 1000) nextId = 40_000;
    owned.add(id);
    return id;
  };

  const send = (payload: unknown): void => {
    if (input.ws.readyState !== 1) return;
    input.ws.send(JSON.stringify(payload));
  };

  const unsubscribe = (subscriptionId: number): void => {
    send({
      jsonrpc: "2.0",
      id: alloc(),
      method: "parsedTransactionUnsubscribe",
      params: [subscriptionId],
    });
  };

  const stop = (): void => {
    const ids = [...live];
    live.clear();
    subscribedKey = "";
    if (!stopped) {
      stopped = true;
      input.logger.warn(
        {
          metric: "wallet_subscribe_capped",
          spentMicros: (accounted + pending).toString(),
          capMicros: input.capMicros.toString(),
          unsubscribed: ids.length,
        },
        "wallet subscription unsubscribed; feature credit cap reached",
      );
    }
    for (const id of ids) unsubscribe(id);
  };

  const subscribe = (): void => {
    const wallets = [...input.wallets()];
    const key = wallets.slice().sort().join(",");
    if (stopped) {
      if (live.size > 0) stop();
      return;
    }
    if (key === subscribedKey && (live.size > 0 || wallets.length === 0)) return;
    for (const id of live) unsubscribe(id);
    live.clear();
    generation += 1;
    const gen = generation;
    subscribedKey = key;
    if (input.ws.readyState !== 1 || wallets.length === 0) return;
    for (const chunk of chunkWallets(wallets)) {
      const id = alloc();
      pendingGen.set(id, gen);
      send({
        jsonrpc: "2.0",
        id,
        method: "parsedTransactionSubscribe",
        params: [
          {
            programs: [...WALLET_TRACK_PROGRAMS],
            instructionNames: [...WALLET_TRADE_NAMES],
            accounts: { include: chunk },
            includeFailed: false,
            includeCpi: true,
          },
          { commitment: "confirmed", details: "matched" },
        ],
      });
    }
    input.logger.info(
      {
        metric: "wallet_subscribe",
        open: true,
        wallets: wallets.length,
        spentMicros: (accounted + pending).toString(),
        capMicros: input.capMicros.toString(),
      },
      "wallet subscription updated",
    );
  };

  return {
    subscribe,
    noteCredit: (micros) => {
      if (micros <= 0n) return;
      pending += micros;
      if (!walletBudgetOpen(accounted + pending, input.capMicros)) stop();
    },
    settleFlushed: (micros) => {
      if (micros <= 0n) return;
      accounted += micros;
      pending -= micros;
      if (pending < 0n) pending = 0n;
      if (!walletBudgetOpen(accounted + pending, input.capMicros)) stop();
    },
    onConfirmed: (requestId, subscriptionId) => {
      const gen = pendingGen.get(requestId);
      pendingGen.delete(requestId);
      if (gen === undefined) return;
      seen.add(subscriptionId);
      if (stopped || gen !== generation) {
        unsubscribe(subscriptionId);
        return;
      }
      live.add(subscriptionId);
    },
    ownsRequest: (requestId) => owned.has(requestId),
    isWalletEvent: (subscriptionId) => seen.has(subscriptionId),
    metric: () => ({
      open: !stopped && live.size > 0,
      spentMicros: accounted + pending,
      capMicros: input.capMicros,
      subscriptions: live.size,
    }),
  };
}

export interface MinuteBar {
  mint: string;
  minute: string;
  volume: number | null;
  gap: boolean;
  observed: boolean;
}

export interface RawMarketEvent {
  mint: string;
  at: string;
  volume: number;
  kind: "swap" | "liquidity";
}

/** Covered minutes with no swap are volume 0. Minutes outside coverage are gaps. */
export function minuteAggregates(input: {
  mint: string;
  from: Date;
  to: Date;
  trades: readonly { at: Date; volume: number }[];
  coveredMinutes?: readonly Date[];
}): MinuteBar[] {
  const start = Math.floor(input.from.getTime() / 60_000) * 60_000;
  const end = Math.floor(input.to.getTime() / 60_000) * 60_000;
  const volumes = new Map<number, number>();
  const covered = new Set<number>();
  for (const minute of input.coveredMinutes ?? []) {
    covered.add(Math.floor(minute.getTime() / 60_000) * 60_000);
  }
  for (const trade of input.trades) {
    const minute = Math.floor(trade.at.getTime() / 60_000) * 60_000;
    if (minute < start || minute > end) continue;
    covered.add(minute);
    volumes.set(minute, (volumes.get(minute) ?? 0) + trade.volume);
  }
  const bars: MinuteBar[] = [];
  for (let minute = start; minute <= end; minute += 60_000) {
    const volume = volumes.get(minute);
    const seen = covered.has(minute);
    bars.push({
      mint: input.mint,
      minute: new Date(minute).toISOString(),
      volume: volume ?? (seen ? 0 : null),
      gap: !seen,
      observed: seen,
    });
  }
  return bars;
}

export function rawMarketEvidence(
  mint: string,
  events: readonly { at: Date; volume: number; kind: "swap" | "liquidity" }[],
): RawMarketEvent[] {
  return events.map((event) => ({
    mint,
    at: event.at.toISOString(),
    volume: event.volume,
    kind: event.kind,
  }));
}

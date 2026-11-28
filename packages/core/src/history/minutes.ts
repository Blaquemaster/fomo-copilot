export interface MinuteBar {
  mint: string;
  minute: string;
  volume: number | null;
  gap: boolean;
}

/** One row per minute. A minute with no observed swap is a gap, not a zero. */
export function minuteAggregates(input: {
  mint: string;
  from: Date;
  to: Date;
  trades: readonly { at: Date; volume: number }[];
}): MinuteBar[] {
  const start = Math.floor(input.from.getTime() / 60_000) * 60_000;
  const end = Math.floor(input.to.getTime() / 60_000) * 60_000;
  const volumes = new Map<number, number>();
  for (const trade of input.trades) {
    const minute = Math.floor(trade.at.getTime() / 60_000) * 60_000;
    if (minute < start || minute > end) continue;
    volumes.set(minute, (volumes.get(minute) ?? 0) + trade.volume);
  }
  const bars: MinuteBar[] = [];
  for (let minute = start; minute <= end; minute += 60_000) {
    const volume = volumes.get(minute);
    bars.push({
      mint: input.mint,
      minute: new Date(minute).toISOString(),
      volume: volume ?? null,
      gap: volume === undefined,
    });
  }
  return bars;
}

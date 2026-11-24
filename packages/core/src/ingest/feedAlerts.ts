/** A venue with no stored event for this long raises a staleness alert. */
export const VENUE_STALE_MS = 10 * 60 * 1000;
/** Block time to row insert above this raises a lag alert. */
export const BLOCK_LAG_MS = 60 * 1000;

export function venueStaleAlert(input: {
  venue: string;
  lastEventAt: Date | null;
  now: Date;
  staleMs?: number;
}): string | null {
  if (input.lastEventAt === null) return `${input.venue} feed stale: no events yet`;
  const age = input.now.getTime() - input.lastEventAt.getTime();
  const limit = input.staleMs ?? VENUE_STALE_MS;
  if (age < limit) return null;
  return `${input.venue} feed stale: last event ${Math.round(age / 1000).toString()}s ago`;
}

export function blockLagAlert(input: {
  venue: string;
  blockTimeMs: number | null;
  recordedAt: Date;
  lagMs?: number;
}): string | null {
  if (input.blockTimeMs === null) return null;
  const lag = input.recordedAt.getTime() - input.blockTimeMs;
  const limit = input.lagMs ?? BLOCK_LAG_MS;
  if (lag < limit) return null;
  return `${input.venue} block-to-record lag ${Math.round(lag / 1000).toString()}s`;
}

/** True when an alert time falls inside an unrecovered ingest gap window. */
export function inUnrecoveredGap(
  at: Date,
  gaps: readonly { start: Date; end: Date }[],
): boolean {
  const time = at.getTime();
  return gaps.some((gap) => time >= gap.start.getTime() && time <= gap.end.getTime());
}

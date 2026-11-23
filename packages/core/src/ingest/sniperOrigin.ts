/**
 * Launch-origin helpers for the create-slot sniper screen.
 * Graduated AMM rows (damm_v2, pumpswap, Raydium, etc.) still measure snipers
 * on the original pump curve, LaunchLab pool, or DBC virtual pool.
 */

export const SNIPER_CREATE_KINDS = [
  "pump_create",
  "pump_create_v2",
  "launchlab_initialize",
  "dbc_initialize",
] as const;

export type SniperCreateKind = (typeof SNIPER_CREATE_KINDS)[number];
export type SniperOriginVenue = "pump" | "launchlab" | "dbc";

export interface LaunchCreateEvent {
  mint: string;
  kind: string;
  pool: string | null;
  virtualPool?: string | null;
  slot: number;
  signature?: string;
}

export interface LaunchOrigin {
  mint: string;
  launchPool: string;
  createdSlot: number;
  venue: SniperOriginVenue;
  signature?: string;
}

export function isSniperCreateKind(kind: string): kind is SniperCreateKind {
  return (SNIPER_CREATE_KINDS as readonly string[]).includes(kind);
}

export function sniperOriginVenue(kind: string): SniperOriginVenue | null {
  if (kind === "pump_create" || kind === "pump_create_v2") return "pump";
  if (kind === "launchlab_initialize") return "launchlab";
  if (kind === "dbc_initialize") return "dbc";
  return null;
}

/** Pool account whose signatures we scan: LaunchLab pool state or DBC virtual pool. */
export function launchPoolFromCreate(event: LaunchCreateEvent): string | null {
  if (event.kind === "dbc_initialize") return event.virtualPool ?? event.pool;
  return event.pool;
}

/**
 * Earliest create event for the mint. A later graduation does not change the origin.
 * If no create is known, the coin is unmeasured.
 */
export function resolveLaunchOrigin(
  mint: string,
  creates: readonly LaunchCreateEvent[],
): LaunchOrigin | null {
  const matches: LaunchOrigin[] = [];
  for (const event of creates) {
    if (event.mint !== mint) continue;
    const venue = sniperOriginVenue(event.kind);
    const launchPool = launchPoolFromCreate(event);
    if (venue === null || !launchPool) continue;
    matches.push({
      mint,
      launchPool,
      createdSlot: event.slot,
      venue,
      signature: event.signature,
    });
  }
  if (matches.length === 0) return null;
  matches.sort((left, right) => left.createdSlot - right.createdSlot);
  return matches[0] ?? null;
}

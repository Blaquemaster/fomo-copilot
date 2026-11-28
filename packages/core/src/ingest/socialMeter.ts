/** Pay-per-use price for one returned post read. This is an estimate, not a subscription. */
export const POST_READ_USD = 0.005;
export const PLANNED_MONTHLY_READS = 384_000;

export function pricedWorkload(reads = PLANNED_MONTHLY_READS): number {
  return Number((reads * POST_READ_USD).toFixed(2));
}

export class SocialMeter {
  private readonly cache = new Map<string, { posts: string[]; at: number }>();
  private readonly seen = new Set<string>();
  readonly readsByEndpoint: Record<string, number> = {};

  constructor(private readonly maxPosts: number) {}

  read(input: {
    endpoint: string;
    mint: string;
    posts: readonly string[];
    now: number;
    cacheMs: number;
  }): { posts: string[]; chargedReads: number; usd: number; cached: boolean } {
    const key = `${input.endpoint}:${input.mint}`;
    const cached = this.cache.get(key);
    if (cached && input.now - cached.at <= input.cacheMs) {
      return { posts: cached.posts, chargedReads: 0, usd: 0, cached: true };
    }
    const bounded = input.posts.slice(0, this.maxPosts);
    const fresh = bounded.filter((id) => !this.seen.has(id));
    for (const id of fresh) this.seen.add(id);
    this.readsByEndpoint[input.endpoint] =
      (this.readsByEndpoint[input.endpoint] ?? 0) + fresh.length;
    this.cache.set(key, { posts: [...bounded], at: input.now });
    return {
      posts: [...bounded],
      chargedReads: fresh.length,
      usd: Number((fresh.length * POST_READ_USD).toFixed(4)),
      cached: false,
    };
  }
}

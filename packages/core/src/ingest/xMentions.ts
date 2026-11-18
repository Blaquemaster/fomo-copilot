/**
 * X mention counts. The live free search runs on the bot side.
 * This process only accepts a pluggable source. The default source reads a fixture.
 */

export interface XMention {
  mint: string | null;
  ticker: string | null;
  handle: string;
  mentionedAt: string;
  postUrl: string;
}

export interface XMentionQuery {
  mint?: string | null;
  ticker?: string | null;
}

export interface XMentionSource {
  search(query: XMentionQuery): Promise<XMention[]>;
}

export interface XMentionSummary {
  mentionCount: number;
  handles: string[];
}

export function summarizeMentions(rows: readonly XMention[]): XMentionSummary {
  const handles = new Set<string>();
  for (const row of rows) {
    const handle = row.handle.replace(/^@/, "").trim();
    if (handle) handles.add(handle);
  }
  return { mentionCount: rows.length, handles: [...handles].sort() };
}

export const FIXTURE_X_MENTIONS: readonly XMention[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    ticker: "WSOL",
    handle: "example_caller",
    mentionedAt: "2026-11-18T12:00:00.000Z",
    postUrl: "https://x.com/example_caller/status/1",
  },
  {
    mint: "So11111111111111111111111111111111111111112",
    ticker: "WSOL",
    handle: "example_second",
    mentionedAt: "2026-11-18T12:05:00.000Z",
    postUrl: "https://x.com/example_second/status/2",
  },
];

export class FixtureXMentionSource implements XMentionSource {
  constructor(private readonly rows: readonly XMention[]) {}

  search(query: XMentionQuery): Promise<XMention[]> {
    const mint = query.mint?.trim() ?? "";
    const ticker = query.ticker?.trim().toLowerCase() ?? "";
    if (!mint && !ticker) return Promise.resolve([...this.rows]);
    const found = this.rows.filter((row) => {
      if (mint && row.mint === mint) return true;
      if (ticker && row.ticker?.toLowerCase() === ticker) return true;
      return false;
    });
    return Promise.resolve(found);
  }
}

/** Drop text that could be treated as an instruction. Counts and handles only. */
export function sanitizeMentionHandle(handle: string): string {
  return handle.replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
}

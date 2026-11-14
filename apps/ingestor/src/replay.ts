import { pathToFileURL } from "node:url";

import {
  canonicalEvents,
  createPool,
  decodeRpcTransaction,
  loadEnv,
  planReplayPage,
  replayListingContinues,
  withinCreditCap,
  type BackfillSignature,
} from "@fomo/core";

import { getTransaction, heliusRpc } from "./helius.js";

const DEFAULT_CAP = 150;
const DEFAULT_SCHEMA = "scratch_replay";

interface ReplayArgs {
  fromSlot: number;
  toSlot: number;
  programs: string[];
  schema: string;
  creditCap: number;
  before: string | null;
  until: string | null;
  anchorSignature: string | null;
}

export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  let fromSlot: number | null = null;
  let toSlot: number | null = null;
  const programs: string[] = [];
  let schema = DEFAULT_SCHEMA;
  let creditCap = DEFAULT_CAP;
  let before: string | null = null;
  let until: string | null = null;
  let anchorSignature: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      flag === "--from-slot" ||
      flag === "--to-slot" ||
      flag === "--schema" ||
      flag === "--credit-cap" ||
      flag === "--before" ||
      flag === "--until" ||
      flag === "--anchor-signature"
    ) {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
    }
    if (flag === "--from-slot") fromSlot = strictSlot(value ?? "");
    else if (flag === "--to-slot") toSlot = strictSlot(value ?? "");
    else if (flag === "--schema") schema = assertSchema(value ?? "");
    else if (flag === "--credit-cap") creditCap = strictCap(value ?? "");
    else if (flag === "--before") before = strictSignature(value ?? "");
    else if (flag === "--until") until = strictSignature(value ?? "");
    else if (flag === "--anchor-signature") anchorSignature = strictSignature(value ?? "");
    else if (flag === "--programs") {
      if (value === undefined) throw new Error("--programs needs a value");
      index += 1;
      for (const program of value.split(",")) {
        const trimmed = program.trim();
        if (trimmed.length > 0) programs.push(trimmed);
      }
    } else if (flag !== undefined) {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (fromSlot === null || toSlot === null)
    throw new Error("--from-slot and --to-slot are required");
  if (fromSlot > toSlot) throw new Error("--from-slot must be <= --to-slot");
  if (programs.length === 0) throw new Error("--programs is required");
  return {
    fromSlot,
    toSlot,
    programs,
    schema: assertSchema(schema),
    creditCap,
    before,
    until,
    anchorSignature,
  };
}

function strictSignature(value: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value)) {
    throw new Error("signature must be base58");
  }
  return value;
}

function strictSlot(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`slot must be an integer, got ${value}`);
  return Number(value);
}

function strictCap(value: string): number {
  if (!/^[0-9]+$/.test(value) || Number(value) < 1)
    throw new Error("--credit-cap must be a positive integer");
  return Number(value);
}

export function assertSchema(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error("schema must be a lowercase identifier");
  }
  if (name === "public" || name.startsWith("pg_")) {
    throw new Error("refusing to write the live schema");
  }
  return name;
}

async function signaturePage(
  apiKey: string,
  programId: string,
  before: string | undefined,
  until: string | null,
  onCall: () => void,
): Promise<{ rawLength: number; oldestSignature: string | null; rows: BackfillSignature[] }> {
  const config: Record<string, unknown> = { limit: 100, commitment: "confirmed" };
  if (before) config["before"] = before;
  if (until) config["until"] = until;
  onCall();
  const result = await heliusRpc({
    apiKey,
    method: "getSignaturesForAddress",
    params: [programId, config],
  });
  if (!Array.isArray(result)) return { rawLength: 0, oldestSignature: null, rows: [] };
  const rows: BackfillSignature[] = [];
  let oldestSignature: string | null = null;
  for (const row of result) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as { signature?: unknown; slot?: unknown; err?: unknown };
    if (typeof record.signature !== "string") continue;
    oldestSignature = record.signature;
    rows.push({
      signature: record.signature,
      slot: typeof record.slot === "number" ? record.slot : null,
      failed: record.err != null,
    });
  }
  return { rawLength: result.length, oldestSignature, rows };
}

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2));
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  const schema = assertSchema(args.schema);
  const qualified = `"${schema}".replay_events`;
  let credits = 0;
  let capHit = false;
  const events: ReturnType<typeof canonicalEvents> = [];
  try {
    const client = await pool.connect();
    try {
      await client.query(`create schema if not exists "${schema}"`);
      await client.query(
        `create table if not exists ${qualified} (
          signature text not null,
          event_index integer not null,
          slot bigint not null,
          program_id text not null,
          event_kind text not null,
          mint text,
          pool text,
          payload jsonb not null,
          primary key (signature, event_index)
        )`,
      );
      for (const programId of args.programs) {
        let before: string | undefined = args.before ?? args.anchorSignature ?? undefined;
        const wanted: BackfillSignature[] = [];
        while (!capHit) {
          if (!withinCreditCap(credits, 1, args.creditCap)) {
            capHit = true;
            break;
          }
          const page = await signaturePage(
            env.HELIUS_API_KEY,
            programId,
            before,
            args.until,
            () => {
              credits += 1;
            },
          );
          if (page.rawLength === 0) break;
          const step = planReplayPage({
            newestFirst: page.rows,
            fromSlot: args.fromSlot,
            toSlot: args.toSlot,
          });
          wanted.push(...step.inWindow);
          if (!replayListingContinues(page.rawLength, step.reachedFrom)) break;
          if (!page.oldestSignature) break;
          before = page.oldestSignature;
        }
        for (const row of wanted) {
          if (!withinCreditCap(credits, 1, args.creditCap)) {
            capHit = true;
            break;
          }
          const beforeCredits = credits;
          let result: unknown;
          try {
            result = await getTransaction(env.HELIUS_API_KEY, row.signature, () => {
              credits += 1;
            });
          } catch {
            if (credits === beforeCredits) credits += 1;
            continue;
          }
          if (result == null) continue;
          const decoded = canonicalEvents(decodeRpcTransaction(result, row.signature).observations);
          for (const observation of decoded) {
            events.push(observation);
            await client.query(
              `insert into ${qualified}
                (signature, event_index, slot, program_id, event_kind, mint, pool, payload)
               values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
               on conflict (signature, event_index) do nothing`,
              [
                observation.signature,
                events.length - 1,
                observation.slot,
                observation.programId,
                observation.kind,
                observation.mint,
                observation.pool,
                JSON.stringify(observation),
              ],
            );
          }
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schema,
        fromSlot: args.fromSlot,
        toSlot: args.toSlot,
        programs: args.programs,
        before: args.before,
        until: args.until,
        anchorSignature: args.anchorSignature,
        creditsUsed: credits,
        creditCap: args.creditCap,
        capHit,
        events,
      },
      null,
      2,
    )}\n`,
  );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}

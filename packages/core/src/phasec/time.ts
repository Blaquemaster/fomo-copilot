import { ET } from "./protocol.js";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(now: Date, timeZone = ET): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = new Map(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(map.get("hour") ?? "0");
  return {
    year: Number(map.get("year") ?? "0"),
    month: Number(map.get("month") ?? "0"),
    day: Number(map.get("day") ?? "0"),
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.get("minute") ?? "0"),
    second: Number(map.get("second") ?? "0"),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (instant.getTime() - (instant.getMilliseconds() % 1000));
}

export function etDay(now: Date): string {
  const parts = zonedParts(now);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year.toString()}-${month}-${day}`;
}

export function nextEtMidnight(now: Date): Date {
  return etDayRange(now).end;
}

export function etDayRange(now: Date): { day: string; start: Date; end: Date } {
  const parts = zonedParts(now);
  const startGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const start = new Date(startGuess.getTime() - offsetMs(startGuess, ET));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day: etDay(now), start, end };
}

export function etWeekStart(now: Date): string {
  const parts = zonedParts(now);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const weekday = new Date(utc).getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  return new Date(utc - delta * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Overnight windows wrap. The end minute is exclusive, so 07:00 delivers the digest. */
export function inQuietHours(now: Date, window: string, timeZone = ET): boolean {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
  if (!match) return false;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  const parts = zonedParts(now, timeZone);
  const minute = parts.hour * 60 + parts.minute;
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

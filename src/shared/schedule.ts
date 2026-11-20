/**
 * Time helpers for the daily drip. Pure functions of a UTC millisecond time and an IANA timezone, so the server's tick and
 * its tests agree on what "today" and "inside the send window" mean for a campaign.
 */

const MIN_MS = 60_000;

export interface ZonedClock {
  /** Minutes since local midnight, 0 to 1439. */
  minuteOfDay: number;
  /** Seconds past the minute. */
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The local wall-clock time in `timeZone` at `ms`. An unknown timezone falls back to UTC rather than throwing. */
export function zonedClock(ms: number, timeZone: string): ZonedClock {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return { minuteOfDay: hour * 60 + Number(parts.minute), second: Number(parts.second) };
}

/** "09:30" to minutes since midnight. */
export const hhmmToMinutes = (hhmm: string): number => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * The UTC time at which the local day containing `ms` began. Working back from the local clock means it is right in every
 * timezone, including half-hour offsets. On the one day a year the clock changes mid-day it can be an hour out, which
 * only affects how many of that day's sends are counted.
 */
export function dayStartMs(ms: number, timeZone: string): number {
  const { minuteOfDay, second } = zonedClock(ms, timeZone);
  return Math.floor(ms / 1000) * 1000 - second * 1000 - minuteOfDay * MIN_MS;
}

/** Whether `ms` is inside the daily send window [start, end) in the campaign's timezone. */
export function inSendWindow(ms: number, timeZone: string, start: string, end: string): boolean {
  const { minuteOfDay } = zonedClock(ms, timeZone);
  return minuteOfDay >= hhmmToMinutes(start) && minuteOfDay < hhmmToMinutes(end);
}

/** Whole minutes left in today's window, at least 1 while inside it, 0 outside it. */
export function minutesLeftInWindow(ms: number, timeZone: string, start: string, end: string): number {
  if (!inSendWindow(ms, timeZone, start, end)) return 0;
  const { minuteOfDay } = zonedClock(ms, timeZone);
  return Math.max(1, hhmmToMinutes(end) - minuteOfDay);
}

/** Whole minutes left in the local day containing `ms`, at least 1. */
export function minutesLeftInDay(ms: number, timeZone: string): number {
  return Math.max(1, 1440 - zonedClock(ms, timeZone).minuteOfDay);
}

/** Whether `ms` falls on the same local day (in `timeZone`) as `otherMs`. */
export function sameLocalDay(ms: number, otherMs: number, timeZone: string): boolean {
  return dayStartMs(ms, timeZone) === dayStartMs(otherMs, timeZone);
}

/**
 * How many to send in this tick so the day's remaining allowance is spread across what is left of the window, instead of
 * going out in one burst: remaining / minutes left, rounded up, never more than `maxPerTick`.
 */
export function pacedBudget(remainingToday: number, minutesLeft: number, maxPerTick: number): number {
  if (remainingToday <= 0 || minutesLeft <= 0) return 0;
  return Math.min(maxPerTick, Math.ceil(remainingToday / minutesLeft));
}

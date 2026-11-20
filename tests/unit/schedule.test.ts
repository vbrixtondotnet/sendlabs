import { describe, expect, it } from "vitest";
import { dayStartMs, hhmmToMinutes, inSendWindow, minutesLeftInDay, minutesLeftInWindow, pacedBudget, sameLocalDay, zonedClock } from "../../src/shared/schedule";

const LA = "America/Los_Angeles";
// 16 Nov 2026 is standard time in Los Angeles (UTC-8) and in Manila (UTC+8).
const at = (h: number, m = 0, s = 0, day = 17) => Date.UTC(2026, 10, day, h, m, s);

describe("zonedClock", () => {
  it("reads the local time in a timezone, with midnight as 0 (never 24)", () => {
    expect(zonedClock(at(18, 30, 15), LA)).toEqual({ minuteOfDay: 10 * 60 + 30, second: 15 });
    expect(zonedClock(at(8, 0), LA).minuteOfDay).toBe(0);
    expect(zonedClock(at(0, 0), "UTC").minuteOfDay).toBe(0);
    expect(zonedClock(at(16, 30), "Asia/Manila").minuteOfDay).toBe(0 * 60 + 30); // 00:30 the next day, UTC+8
  });

  it("handles half-hour offsets, and falls back to UTC for a timezone it does not know", () => {
    expect(zonedClock(at(0, 0), "Asia/Kolkata").minuteOfDay).toBe(5 * 60 + 30);
    expect(zonedClock(at(12, 0), "Not/AZone").minuteOfDay).toBe(12 * 60);
  });
});

describe("hhmmToMinutes", () => {
  it("converts HH:MM", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("23:59")).toBe(1439);
  });
});

describe("dayStartMs", () => {
  it("is local midnight, whatever the time of day, in the campaign's timezone", () => {
    expect(dayStartMs(at(18, 30, 15), LA)).toBe(at(8, 0, 0)); // 10:30 LA -> 00:00 LA = 08:00Z
    expect(dayStartMs(at(7, 59, 59), LA)).toBe(at(8, 0, 0, 16)); // still the 16th in LA
    expect(dayStartMs(at(8, 0, 0), LA)).toBe(at(8, 0, 0));
    expect(dayStartMs(at(20, 0), "Asia/Manila")).toBe(at(16, 0, 0)); // 04:00 on the 18th in Manila -> 00:00 = 16:00Z on the 17th
  });
});

describe("send window", () => {
  it("is inside from the start up to, not including, the end", () => {
    expect(inSendWindow(at(17, 0), LA, "09:00", "17:00")).toBe(true); // 09:00 LA
    expect(inSendWindow(at(16, 59), LA, "09:00", "17:00")).toBe(false);
    expect(inSendWindow(at(0, 59), LA, "09:00", "17:00")).toBe(true); // 16:59 LA
    expect(inSendWindow(at(1, 0), LA, "09:00", "17:00")).toBe(false); // 17:00 LA
    expect(inSendWindow(at(5, 0), LA, "09:00", "17:00")).toBe(false);
  });

  it("counts the minutes left, at least 1 inside the window and 0 outside it", () => {
    expect(minutesLeftInWindow(at(18, 0), LA, "09:00", "17:00")).toBe(7 * 60);
    expect(minutesLeftInWindow(at(0, 59, 30), LA, "09:00", "17:00")).toBe(1);
    expect(minutesLeftInWindow(at(5, 0), LA, "09:00", "17:00")).toBe(0);
  });
});

describe("pacedBudget", () => {
  it("spreads what is left over the minutes left, rounded up, capped per pass", () => {
    expect(pacedBudget(500, 480, 8)).toBe(2);
    expect(pacedBudget(30, 420, 8)).toBe(1);
    expect(pacedBudget(2000, 1, 8)).toBe(8);
    expect(pacedBudget(3, 1, 8)).toBe(3);
  });

  it("is nothing when the day's allowance is used up or the window is closed", () => {
    expect(pacedBudget(0, 100, 8)).toBe(0);
    expect(pacedBudget(-5, 100, 8)).toBe(0);
    expect(pacedBudget(100, 0, 8)).toBe(0);
  });
});

describe("launch-day helpers", () => {
  it("counts the minutes left in the local day, at least 1", () => {
    expect(minutesLeftInDay(at(8, 0), LA)).toBe(1440); // local midnight
    expect(minutesLeftInDay(at(5, 0), LA)).toBe(180); // 21:00 in Los Angeles
    expect(minutesLeftInDay(at(7, 59, 30), LA)).toBe(1); // 23:59
  });

  it("tells whether two moments are on the same local day", () => {
    expect(sameLocalDay(at(5, 0), at(18, 0, 0, 16), LA)).toBe(true); // 21:00 on the 16th and 10:00 on the 16th in LA
    expect(sameLocalDay(at(5, 0), at(5, 0, 0, 18), LA)).toBe(false);
  });
});

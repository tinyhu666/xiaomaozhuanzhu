import { afterEach, beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key)
};

import {
  __resetWeeklyRecapForTests,
  checkWeeklyRecapEligibility,
  computeWeeklyRecap,
  consumeWeeklyRecap,
  isoWeekKey
} from "../utils/weekly-recap";
import type { CompletedSession } from "../utils/api";

beforeEach(() => storage.clear());
afterEach(() => storage.clear());

function s(endedAt: string, durationMinutes: number, subject: string | null = null, id = "x"): CompletedSession {
  return {
    id,
    subject,
    mode: "free",
    durationMinutes,
    pomodoroCycles: 0,
    startedAt: endedAt,
    endedAt
  };
}

describe("isoWeekKey", () => {
  it("returns the ISO week label for a typical mid-week date", () => {
    // 2026-05-17 is a Sunday → ISO week 20 of 2026
    expect(isoWeekKey(new Date("2026-05-15T08:00:00.000Z"))).toBe("2026-W20");
  });

  it("handles year boundaries correctly (early Jan dates)", () => {
    // 2026-01-01 is a Thursday → ISO 2026-W01
    expect(isoWeekKey(new Date("2026-01-01T08:00:00.000Z"))).toBe("2026-W01");
  });
});

describe("computeWeeklyRecap", () => {
  it("aggregates totals + session counts across the week", () => {
    // ISO Week 20 of 2026 = May 11 (Mon) - May 17 (Sun)
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z"); // = Mon 00:00 Shanghai
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 30, "会计", "a"),
      s("2026-05-12T08:00:00.000Z", 45, "审计", "b"),
      s("2026-05-13T08:00:00.000Z", 60, "会计", "c")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.totalMinutes).toBe(135);
    expect(recap.sessionCount).toBe(3);
    expect(recap.dailyMinutes.reduce((a, b) => a + b, 0)).toBe(135);
  });

  it("buckets per-day correctly (Mon=index 0)", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    // Tue (May 12) + Sat (May 16) each 40 min
    const sessions = [
      s("2026-05-12T08:00:00.000Z", 40, null, "a"),
      s("2026-05-16T08:00:00.000Z", 40, null, "b")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.dailyMinutes[1]).toBe(40); // Tue
    expect(recap.dailyMinutes[5]).toBe(40); // Sat
    expect(recap.dailyMinutes[0]).toBe(0);
  });

  it("picks the top 2 subjects by minutes", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 30, "会计", "a"),
      s("2026-05-12T08:00:00.000Z", 80, "审计", "b"),
      s("2026-05-13T08:00:00.000Z", 60, "财管", "c"),
      s("2026-05-14T08:00:00.000Z", 20, "战略", "d")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.topSubjects.length).toBe(2);
    expect(recap.topSubjects[0].name).toBe("审计");
    expect(recap.topSubjects[0].minutes).toBe(80);
    expect(recap.topSubjects[1].name).toBe("财管");
  });

  it("buildChange: noPrior when prior week is empty", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const sessions = [s("2026-05-11T08:00:00.000Z", 60, null, "a")];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.change.kind).toBe("noPrior");
  });

  it("buildChange: up when this week beats prior week", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const sessions = [
      // Prior week (May 4-10): 60 min
      s("2026-05-05T08:00:00.000Z", 60, null, "prior"),
      // This week: 120 min
      s("2026-05-11T08:00:00.000Z", 120, null, "this")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.change.kind).toBe("up");
    if (recap.change.kind === "up") {
      expect(recap.change.deltaMinutes).toBe(60);
      expect(recap.change.percent).toBe(100);
    }
  });

  it("suggestion: starter nudge for a 0-minute week", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const recap = computeWeeklyRecap([], weekStartUtc);
    expect(recap.suggestion).toMatch(/25 分钟|拉起来/);
  });

  it("suggestion: diversification when one subject dominates > 60%", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 500, "会计", "a"),
      s("2026-05-12T08:00:00.000Z", 50, "审计", "b")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.suggestion).toMatch(/会计/);
    expect(recap.suggestion).toMatch(/分给/);
  });

  it("suggestion: catch-up hint for an unseen subject", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    // Touched all 6 except 战略, balanced
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 60, "会计", "a"),
      s("2026-05-12T08:00:00.000Z", 60, "审计", "b"),
      s("2026-05-13T08:00:00.000Z", 60, "税法", "c"),
      s("2026-05-14T08:00:00.000Z", 60, "财管", "d"),
      s("2026-05-15T08:00:00.000Z", 60, "经济法", "e")
    ];
    const recap = computeWeeklyRecap(sessions, weekStartUtc);
    expect(recap.suggestion).toMatch(/战略/);
  });

  it("rangeLabel formats single-month ranges as 'M 月 D 日 – D 日'", () => {
    const weekStartUtc = new Date("2026-05-10T16:00:00.000Z");
    const recap = computeWeeklyRecap([], weekStartUtc);
    expect(recap.rangeLabel).toBe("5 月 11 日 – 17 日");
  });
});

describe("checkWeeklyRecapEligibility", () => {
  it("Sunday after 18:00 Shanghai is eligible", () => {
    // 2026-05-17 Sun 18:30 Shanghai = 10:30 UTC same day
    const sundayEvening = new Date("2026-05-17T10:30:00.000Z");
    const e = checkWeeklyRecapEligibility(sundayEvening);
    expect(e.eligible).toBe(true);
    expect(e.recapWeekKey).toBe("2026-W20");
  });

  it("Monday before 06:00 Shanghai is eligible (recaps prior week)", () => {
    // 2026-05-18 Mon 05:30 Shanghai = 2026-05-17 21:30 UTC
    const earlyMonday = new Date("2026-05-17T21:30:00.000Z");
    const e = checkWeeklyRecapEligibility(earlyMonday);
    expect(e.eligible).toBe(true);
    expect(e.recapWeekKey).toBe("2026-W20"); // last week
  });

  it("mid-week Wednesday is not directly eligible", () => {
    // 2026-05-20 Wed 12:00 Shanghai = 04:00 UTC
    const midWeek = new Date("2026-05-20T04:00:00.000Z");
    const e = checkWeeklyRecapEligibility(midWeek);
    expect(e.eligible).toBe(false);
  });
});

describe("consumeWeeklyRecap", () => {
  beforeEach(() => __resetWeeklyRecapForTests());

  it("fires on Sunday evening when there is data, then storage-gates", () => {
    const sundayEvening = new Date("2026-05-17T10:30:00.000Z"); // Shanghai 18:30 Sun
    const sessions = [s("2026-05-13T08:00:00.000Z", 60, "会计", "a")];
    const first = consumeWeeklyRecap(sessions, sundayEvening);
    expect(first).not.toBeNull();
    expect(first?.weekKey).toBe("2026-W20");
    // Second call same window → null (storage gated)
    const second = consumeWeeklyRecap(sessions, sundayEvening);
    expect(second).toBeNull();
  });

  it("returns null on Sunday evening with no data", () => {
    const sundayEvening = new Date("2026-05-17T10:30:00.000Z");
    expect(consumeWeeklyRecap([], sundayEvening)).toBeNull();
  });

  it("catches up on a missed week if opened mid-week (Tue-Sat)", () => {
    // User missed Sun + Mon; opens app Wed afternoon. Should still fire
    // last-week recap.
    const wedAfternoon = new Date("2026-05-20T08:00:00.000Z"); // Shanghai Wed 16:00
    const sessions = [s("2026-05-13T08:00:00.000Z", 60, "会计", "a")]; // last week
    const recap = consumeWeeklyRecap(sessions, wedAfternoon);
    expect(recap?.weekKey).toBe("2026-W20");
  });

  it("does not refire after a catch-up fire", () => {
    const wedAfternoon = new Date("2026-05-20T08:00:00.000Z");
    const sessions = [s("2026-05-13T08:00:00.000Z", 60, "会计", "a")];
    consumeWeeklyRecap(sessions, wedAfternoon);
    const second = consumeWeeklyRecap(sessions, wedAfternoon);
    expect(second).toBeNull();
  });

  it("returns null and marks-seen when the prior week had zero data (silent week)", () => {
    const sundayEvening = new Date("2026-05-17T10:30:00.000Z");
    // No sessions at all
    const recap = consumeWeeklyRecap([], sundayEvening);
    expect(recap).toBeNull();
    // Even with data added later, we still don't fire — week is marked
    const sessionsLater = [s("2026-05-13T08:00:00.000Z", 60, null, "a")];
    const second = consumeWeeklyRecap(sessionsLater, sundayEvening);
    expect(second).toBeNull();
  });
});

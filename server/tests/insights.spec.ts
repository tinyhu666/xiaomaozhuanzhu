import { describe, expect, it } from "vitest";

import {
  buildHourlyPattern,
  buildWeekdayPattern,
  findBestWeek
} from "../src/domain/stats";
import type { DailyStat, StudySession } from "../src/types";

function completedSession(overrides: Partial<StudySession> = {}): StudySession {
  const base: StudySession = {
    id: "s1",
    userId: "u1",
    status: "completed",
    mode: "free",
    startedAt: "2026-05-13T06:00:00.000Z", // 14:00 Shanghai
    endedAt: "2026-05-13T07:30:00.000Z",   // 15:30 Shanghai
    currentPauseStartedAt: null,
    pauseSegments: [],
    durationMinutes: 90,
    pomodoroCycles: 0,
    summary: "",
    subject: null,
    tags: [],
    createdAt: "2026-05-13T06:00:00.000Z",
    updatedAt: "2026-05-13T07:30:00.000Z"
  };
  return { ...base, ...overrides };
}

function dailyStat(date: string, totalMinutes: number): DailyStat {
  return {
    userId: "u1",
    date,
    totalMinutes,
    sessionCount: 1,
    heatLevel: 1,
    streakDays: 1,
    updatedAt: `${date}T00:00:00.000Z`
  };
}

describe("buildHourlyPattern", () => {
  it("splits a single session at Shanghai hour boundaries", () => {
    const session = completedSession(); // 14:00 → 15:30 SH
    const pattern = buildHourlyPattern([session]);
    expect(pattern[14]).toBe(60);
    expect(pattern[15]).toBe(30);
    // Every other hour stays zero.
    expect(pattern.reduce((sum, value) => sum + value, 0)).toBe(90);
  });

  it("excludes paused intervals so a 1h pause doesn't get credit", () => {
    const session = completedSession({
      startedAt: "2026-05-13T06:00:00.000Z", // 14:00 SH
      endedAt: "2026-05-13T09:00:00.000Z",   // 17:00 SH (3h wall)
      pauseSegments: [
        // Pause 14:30 → 15:30 SH (1h pause)
        { startedAt: "2026-05-13T06:30:00.000Z", endedAt: "2026-05-13T07:30:00.000Z" }
      ]
    });
    const pattern = buildHourlyPattern([session]);
    // 14:00–14:30 → 30 min at hour 14
    expect(pattern[14]).toBe(30);
    // 14:30–15:30 paused, no credit
    expect(pattern[15]).toBe(30); // 15:30–16:00 → 30 min
    expect(pattern[16]).toBe(60); // 16:00–17:00 → 60 min
    expect(pattern.reduce((sum, value) => sum + value, 0)).toBe(120);
  });

  it("ignores non-completed sessions", () => {
    const running = completedSession({ status: "running", endedAt: null });
    const pattern = buildHourlyPattern([running]);
    expect(pattern.every((m) => m === 0)).toBe(true);
  });

  it("handles a session that crosses Shanghai midnight", () => {
    // 22:30 SH → 01:30 SH next day = 14:30 UTC → 17:30 UTC
    const session = completedSession({
      startedAt: "2026-05-13T14:30:00.000Z",
      endedAt: "2026-05-13T17:30:00.000Z"
    });
    const pattern = buildHourlyPattern([session]);
    expect(pattern[22]).toBe(30);
    expect(pattern[23]).toBe(60);
    expect(pattern[0]).toBe(60);
    expect(pattern[1]).toBe(30);
    expect(pattern.reduce((sum, value) => sum + value, 0)).toBe(180);
  });
});

describe("buildWeekdayPattern", () => {
  it("buckets a Wednesday entry into index 2 (0=Mon)", () => {
    // 2026-05-13 is a Wednesday
    const pattern = buildWeekdayPattern([dailyStat("2026-05-13", 90)]);
    expect(pattern[2]).toBe(90); // Wed
    expect(pattern[0]).toBe(0);  // Mon
  });

  it("averages across multiple Mondays", () => {
    // 2026-05-11 (Mon) + 2026-05-18 (Mon)
    const pattern = buildWeekdayPattern([
      dailyStat("2026-05-11", 60),
      dailyStat("2026-05-18", 120)
    ]);
    expect(pattern[0]).toBe(90); // avg(60, 120)
  });

  it("returns all zeros for empty input", () => {
    expect(buildWeekdayPattern([])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("findBestWeek", () => {
  it("picks the calendar week with the highest cumulative minutes", () => {
    // Week 1: 2026-05-11 (Mon) — Sun 2026-05-17
    // Week 2: 2026-05-18 (Mon) — Sun 2026-05-24
    const result = findBestWeek([
      dailyStat("2026-05-13", 60),  // Week 1
      dailyStat("2026-05-15", 30),  // Week 1 → 90 total
      dailyStat("2026-05-19", 200), // Week 2 → 200 total
      dailyStat("2026-05-22", 50)   // Week 2 → 250 total
    ]);
    expect(result).toEqual({ weekStart: "2026-05-18", totalMinutes: 250 });
  });

  it("returns null on empty input", () => {
    expect(findBestWeek([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { EXAM_DATES, getExamSchedule } from "../src/domain/exam-dates";

describe("CPA exam-date schedule", () => {
  it("returns all six subjects with future-or-zero days for a date inside the announcement window", () => {
    // 2025-04-15 — both 2024 and 2025 schedules are listed, 2025 is
    // current; user should see official 2025 dates.
    const schedule = getExamSchedule(new Date("2025-04-15T00:00:00Z"));
    expect(schedule).toHaveLength(6);
    const accounting = schedule.find((s) => s.subject === "会计")!;
    expect(accounting.date).toBe("2025-08-23");
    expect(accounting.fallback).toBe(false);
    expect(accounting.sourceYear).toBe(2025);
    expect(accounting.daysRemaining).toBe(130);

    const audit = schedule.find((s) => s.subject === "审计")!;
    expect(audit.date).toBe("2025-08-24");
    expect(audit.fallback).toBe(false);
  });

  it("falls back to previous year schedule (with year swapped) when current year is missing", () => {
    // 2027 has no entry yet → derive from the most recent official (2026),
    // swapping the year to 2027. (2026 is now official — see EXAM_DATES.)
    const schedule = getExamSchedule(new Date("2027-04-01T00:00:00Z"));
    const accounting = schedule.find((s) => s.subject === "会计")!;
    expect(accounting.date).toBe("2027-08-29");
    expect(accounting.fallback).toBe(true);
    expect(accounting.sourceYear).toBe(2026);

    const audit = schedule.find((s) => s.subject === "审计")!;
    expect(audit.date).toBe("2027-08-30");
    expect(audit.fallback).toBe(true);
  });

  it("uses the official 2026 schedule (8/29–30) without a 参考 fallback", () => {
    const schedule = getExamSchedule(new Date("2026-07-10T00:00:00Z"));
    const accounting = schedule.find((s) => s.subject === "会计")!;
    expect(accounting.date).toBe("2026-08-29");
    expect(accounting.fallback).toBe(false);
    expect(accounting.sourceYear).toBe(2026);
    const audit = schedule.find((s) => s.subject === "审计")!;
    expect(audit.date).toBe("2026-08-30");
    expect(audit.fallback).toBe(false);
  });

  it("rolls a past in-year date forward by one year so users always see a future countdown", () => {
    // 2025-10-01 — Aug 23/24 already happened.
    const schedule = getExamSchedule(new Date("2025-10-01T00:00:00Z"));
    const accounting = schedule.find((s) => s.subject === "会计")!;
    expect(accounting.date).toBe("2026-08-23");
    expect(accounting.fallback).toBe(true);
    expect(accounting.daysRemaining).toBeGreaterThan(0);
  });

  it("days_remaining is 0 when the date is today", () => {
    const today = new Date("2025-08-23T00:00:00Z");
    const schedule = getExamSchedule(today);
    const accounting = schedule.find((s) => s.subject === "会计")!;
    expect(accounting.date).toBe("2025-08-23");
    expect(accounting.daysRemaining).toBe(0);
  });

  it("EXAM_DATES has all six subjects per listed year", () => {
    const subjects = ["会计", "审计", "税法", "财管", "经济法", "战略"];
    for (const year of Object.keys(EXAM_DATES)) {
      for (const subject of subjects) {
        expect(EXAM_DATES[Number(year)][subject as keyof (typeof EXAM_DATES)[number]]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  buildSubjectBalance,
  buildSubjectSummary,
  formatDuration,
  getDailyQuote,
  getSessionActions,
  validateCompletionDraft
} from "../utils/view-models";

describe("miniprogram view models", () => {
  it("returns timer actions for each session state", () => {
    expect(getSessionActions(null)).toEqual(["start"]);
    expect(getSessionActions("running")).toEqual(["pause", "complete"]);
    expect(getSessionActions("paused")).toEqual(["resume", "complete"]);
  });

  it("validates completion draft requirements (v0.24: empty form is valid)", () => {
    // v0.24 — empty form is OK; the "tap submit, done" path is the
    // explicit value-prop of this version. Only oversize fields fail.
    expect(
      validateCompletionDraft({ summary: "", photos: [] })
    ).toEqual({ valid: true, message: "" });

    expect(
      validateCompletionDraft({
        summary: "今天把会计分录重新梳理了一遍",
        photos: [{ fileId: "cloud://demo/a.jpg", objectKey: "checkins/a.jpg" }]
      })
    ).toEqual({ valid: true, message: "" });

    // Oversize summary still fails (server enforces, client guards early).
    expect(
      validateCompletionDraft({ summary: "x".repeat(81), photos: [] })
    ).toEqual({ valid: false, message: "总结最多 80 字" });

    // Too many photos still fails.
    expect(
      validateCompletionDraft({
        summary: "",
        photos: Array.from({ length: 4 }, (_, i) => ({
          fileId: `cloud://demo/${i}.jpg`,
          objectKey: `${i}.jpg`
        }))
      })
    ).toEqual({ valid: false, message: "最多上传 3 张照片" });
  });

  it("builds a stable month grid for the heat calendar", () => {
    const grid = buildMonthGrid("2026-04", {
      "2026-04-16": { totalMinutes: 120, heatLevel: 3 },
      "2026-04-17": { totalMinutes: 45, heatLevel: 1 }
    });

    expect(grid).toHaveLength(35);
    expect(grid.find((item) => item.date === "2026-04-16")).toMatchObject({
      day: 16,
      heatLevel: 3
    });
    expect(grid.find((item) => item.date === "2026-04-17")).toMatchObject({
      day: 17,
      totalMinutes: 45
    });
  });

  it("expands to six rows for long months", () => {
    const grid = buildMonthGrid("2026-08", {});

    expect(grid).toHaveLength(42);
    expect(grid.at(-1)?.date).toBe("2026-09-06");
  });

  it("formats duration into human friendly labels", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59)).toBe("59m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(125)).toBe("2h 5m");
  });

  it("returns one of the bilingual quote pairs", () => {
    const quote = getDailyQuote("2026-04-18");
    expect(typeof quote.en).toBe("string");
    expect(typeof quote.zh).toBe("string");
    expect(quote.en.length).toBeGreaterThan(0);
    expect(quote.zh.length).toBeGreaterThan(0);
  });

  it("builds subject summaries with formatted durations", () => {
    expect(
      buildSubjectSummary([
        { subject: "会计", totalMinutes: 75 },
        { subject: "审计", totalMinutes: 140 }
      ])
    ).toEqual([
      { subject: "审计", totalMinutes: 140, durationText: "2h 20m" },
      { subject: "会计", totalMinutes: 75, durationText: "1h 15m" }
    ]);
  });

  // v0.33 — B1 科目×考期 平衡复盘
  describe("buildSubjectBalance", () => {
    it("ranks an exam-imminent neglected subject as urgent and first", () => {
      const result = buildSubjectBalance(
        [
          { subject: "会计", totalMinutes: 6000, targetMinutes: 6000 }, // reached
          { subject: "审计", totalMinutes: 0, targetMinutes: 600 }       // neglected, exam in 5 days
        ],
        [
          { subject: "会计", daysRemaining: 90 },
          { subject: "审计", daysRemaining: 5 }
        ]
      );
      expect(result[0].subject).toBe("审计");
      expect(result[0].tier).toBe("urgent");
      // 600 remaining over 5 days = 120/day
      expect(result[0].requiredDailyMinutes).toBe(120);
      // reached subject sinks to the bottom
      expect(result[result.length - 1].subject).toBe("会计");
      expect(result[result.length - 1].tier).toBe("reached");
    });

    it("computes required daily minutes by remaining gap / days left", () => {
      const [item] = buildSubjectBalance(
        [{ subject: "财管", totalMinutes: 100, targetMinutes: 1000 }],
        [{ subject: "财管", daysRemaining: 30 }]
      );
      // (1000-100)/30 = 30/day → ontrack (<45)
      expect(item.remainingMinutes).toBe(900);
      expect(item.requiredDailyMinutes).toBe(30);
      expect(item.tier).toBe("ontrack");
      expect(item.progressPercent).toBe(10);
    });

    it("marks a reached subject and reports 0 required minutes", () => {
      const [item] = buildSubjectBalance(
        [{ subject: "战略", totalMinutes: 700, targetMinutes: 600 }],
        [{ subject: "战略", daysRemaining: 40 }]
      );
      expect(item.tier).toBe("reached");
      expect(item.remainingMinutes).toBe(0);
      expect(item.requiredDailyMinutes).toBe(0);
      expect(item.progressPercent).toBe(100);
    });

    it("orders tiers urgent → behind → ontrack → reached", () => {
      const tiers = buildSubjectBalance(
        [
          { subject: "会计", totalMinutes: 600, targetMinutes: 600 },  // reached
          { subject: "审计", totalMinutes: 0, targetMinutes: 1800 },   // behind (1800/30=60/day)
          { subject: "税法", totalMinutes: 0, targetMinutes: 300 },    // ontrack (300/30=10/day)
          { subject: "财管", totalMinutes: 0, targetMinutes: 4000 }    // urgent (4000/30=134/day)
        ],
        [
          { subject: "会计", daysRemaining: 30 },
          { subject: "审计", daysRemaining: 30 },
          { subject: "税法", daysRemaining: 30 },
          { subject: "财管", daysRemaining: 30 }
        ]
      ).map((item) => item.tier);
      expect(tiers).toEqual(["urgent", "behind", "ontrack", "reached"]);
    });

    it("does not crash when a subject is missing from the exam schedule", () => {
      const [item] = buildSubjectBalance(
        [{ subject: "经济法", totalMinutes: 30, targetMinutes: 300 }],
        [] // no schedule entry → daysRemaining defaults to 0
      );
      expect(item.daysRemaining).toBe(0);
      // remaining 270 over max(1,0)=1 day → all "today"
      expect(item.requiredDailyMinutes).toBe(270);
      expect(item.tier).toBe("urgent");
    });
  });

});

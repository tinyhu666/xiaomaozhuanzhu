import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
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

});

import { describe, expect, it } from "vitest";

import {
  buildAuthorizedProfile,
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

  it("validates completion draft requirements", () => {
    expect(
      validateCompletionDraft({
        summary: "",
        photos: []
      })
    ).toEqual({
      valid: false,
      message: "请先上传 1 张学习照片，并填写一句话总结"
    });

    expect(
      validateCompletionDraft({
        summary: "今天把会计分录重新梳理了一遍",
        photos: [
          {
            fileId: "cloud://demo/a.jpg",
            objectKey: "checkins/a.jpg"
          }
        ]
      })
    ).toEqual({
      valid: true,
      message: ""
    });
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

  it("returns a deterministic bilingual quote for a date", () => {
    expect(getDailyQuote("2026-04-18")).toEqual({
      en: "One page at a time.",
      zh: "一页一页，也是在前进。"
    });
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

  it("normalizes authorized wechat profile data", () => {
    expect(
      buildAuthorizedProfile({
        nickName: "  小猫专注  ",
        avatarUrl: "https://wx.qlogo.cn/mmopen/vi_32/demo/132"
      })
    ).toEqual({
      nickname: "小猫专注",
      avatarUrl: "https://wx.qlogo.cn/mmopen/vi_32/demo/0"
    });
  });
});

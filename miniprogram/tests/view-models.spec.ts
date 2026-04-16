import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  formatDuration,
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
      message: "请先上传 1 张学习照片并填写一句话总结"
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

  it("formats duration into human friendly labels", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59)).toBe("59m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(125)).toBe("2h 5m");
  });
});

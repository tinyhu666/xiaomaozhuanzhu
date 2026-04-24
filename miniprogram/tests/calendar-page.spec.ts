import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMonthGrid } from "../utils/view-models";

const apiMocks = vi.hoisted(() => ({
  getCalendar: vi.fn(),
  getCalendarDay: vi.fn(),
  getTempUrls: vi.fn()
}));

vi.mock("../utils/api", () => apiMocks);

type CalendarPageDefinition = {
  data: Record<string, unknown>;
  loadDay(date: string): Promise<void>;
  pickSelectedDate(grid: ReturnType<typeof buildMonthGrid>): string;
  [key: string]: unknown;
};

type CalendarPageInstance = CalendarPageDefinition & {
  route: string;
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
};

function instantiatePage(definition: CalendarPageDefinition) {
  return {
    ...definition,
    route: "pages/calendar/index",
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }
  } as CalendarPageInstance;
}

async function loadCalendarPageDefinition() {
  let captured: CalendarPageDefinition | undefined;
  vi.stubGlobal("Page", (options: CalendarPageDefinition) => {
    captured = options;
    return options;
  });

  await import("../pages/calendar/index");

  if (!captured) {
    throw new Error("Calendar page definition was not registered");
  }

  return captured;
}

describe("calendar page selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-05-01T10:00:00+08:00"));
    vi.stubGlobal("wx", {
      showToast: vi.fn()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("prefers the hottest in-month day when there is no selected date for the current month", async () => {
    const definition = await loadCalendarPageDefinition();
    const page = instantiatePage(definition);

    page.setData({
      month: "2026-04",
      selectedDate: ""
    });

    const grid = buildMonthGrid("2026-04", {
      "2026-04-10": { totalMinutes: 60, heatLevel: 2 },
      "2026-04-18": { totalMinutes: 180, heatLevel: 4 },
      "2026-04-20": { totalMinutes: 30, heatLevel: 1 }
    });

    expect(page.pickSelectedDate(grid)).toBe("2026-04-18");
  });

  it("shows day detail with stored file ids when temp-url lookup fails", async () => {
    apiMocks.getCalendarDay.mockResolvedValue({
      date: "2026-04-22",
      totalMinutes: 95,
      sessionCount: 1,
      heatLevel: 2,
      sessions: [
        {
          id: "session-1",
          summary: "Finished audit drills.",
          subjects: ["Audit"],
          tags: ["steady"],
          totalMinutes: 95,
          photos: [
            {
              objectKey: "checkins/a.jpg",
              fileId: "cloud://demo/checkins/a.jpg"
            }
          ]
        }
      ]
    });
    apiMocks.getTempUrls.mockRejectedValue(new Error("temp url service unavailable"));

    const definition = await loadCalendarPageDefinition();
    const page = instantiatePage(definition);

    await page.loadDay("2026-04-22");

    expect(page.data.selectedDetail).toEqual(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            id: "session-1",
            photos: [
              expect.objectContaining({
                objectKey: "checkins/a.jpg",
                tempUrl: "cloud://demo/checkins/a.jpg"
              })
            ]
          })
        ]
      })
    );
    expect(wx.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "temp url service unavailable",
        icon: "none"
      })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getCalendarDay: vi.fn(),
  getTempUrls: vi.fn()
}));

vi.mock("../utils/api", () => apiMocks);

type DayPageDefinition = {
  data: Record<string, unknown>;
  loadDay(date: string): Promise<void>;
  [key: string]: unknown;
};

type DayPageInstance = DayPageDefinition & {
  route: string;
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
};

function instantiatePage(definition: DayPageDefinition) {
  return {
    ...definition,
    route: "package-calendar/day/index",
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }
  } as DayPageInstance;
}

async function loadDayPageDefinition() {
  let captured: DayPageDefinition | undefined;
  vi.stubGlobal("Page", (options: DayPageDefinition) => {
    captured = options;
    return options;
  });

  await import("../package-calendar/day/index");

  if (!captured) {
    throw new Error("Day page definition was not registered");
  }

  return captured;
}

describe("calendar day page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("wx", {
      showToast: vi.fn(),
      previewImage: vi.fn()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the stored fileId when a temp url is unavailable", async () => {
    apiMocks.getCalendarDay.mockResolvedValue({
      date: "2026-04-22",
      totalMinutes: 95,
      sessionCount: 1,
      heatLevel: 2,
      sessions: [
        {
          id: "session-1",
          summary: "把今天的审计题顺完了。",
          subjects: ["审计"],
          tags: ["顺利"],
          totalMinutes: 95,
          photos: [
            {
              objectKey: "checkins/a.jpg",
              fileId: "cloud://demo/checkins/a.jpg"
            },
            {
              objectKey: "checkins/b.jpg",
              fileId: "cloud://demo/checkins/b.jpg"
            }
          ]
        }
      ]
    });
    apiMocks.getTempUrls.mockResolvedValue({
      items: [
        {
          objectKey: "checkins/a.jpg",
          url: "https://cdn.example.com/checkins/a.jpg"
        }
      ]
    });

    const definition = await loadDayPageDefinition();
    const page = instantiatePage(definition);

    await page.loadDay("2026-04-22");

    expect(apiMocks.getTempUrls).toHaveBeenCalledWith(["checkins/a.jpg", "checkins/b.jpg"]);
    expect(page.data.sessions).toEqual([
      expect.objectContaining({
        id: "session-1",
        subjectText: "审计",
        photos: [
          {
            objectKey: "checkins/a.jpg",
            url: "https://cdn.example.com/checkins/a.jpg"
          },
          {
            objectKey: "checkins/b.jpg",
            url: "cloud://demo/checkins/b.jpg"
          }
        ]
      })
    ]);
  });
});

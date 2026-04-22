import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  completeSession: vi.fn(),
  uploadCheckinPhoto: vi.fn()
}));

vi.mock("../utils/api", async () => {
  const actual = await vi.importActual("../utils/api");
  return {
    ...actual,
    completeSession: apiMocks.completeSession,
    uploadCheckinPhoto: apiMocks.uploadCheckinPhoto
  };
});

type CompletePageDefinition = {
  data: Record<string, unknown>;
  choosePhotos(): Promise<void>;
  toggleSubject(event: { currentTarget: { dataset: { value: string } } }): void;
  toggleTag(event: { currentTarget: { dataset: { value: string } } }): void;
  submit(): Promise<void>;
  [key: string]: unknown;
};

type CompletePageInstance = CompletePageDefinition & {
  route: string;
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
};

function instantiatePage(definition: CompletePageDefinition) {
  return {
    ...definition,
    route: "package-session/complete/index",
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }
  } as CompletePageInstance;
}

async function loadCompletePageDefinition() {
  let captured: CompletePageDefinition | undefined;
  vi.stubGlobal("Page", (options: CompletePageDefinition) => {
    captured = options;
    return options;
  });

  await import("../package-session/complete/index");

  if (!captured) {
    throw new Error("Complete page definition was not registered");
  }

  return captured;
}

describe("complete page photo uploads", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("wx", {
      chooseMedia: vi.fn().mockResolvedValue({
        tempFiles: [{ tempFilePath: "a.jpg" }, { tempFilePath: "b.jpg" }]
      }),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      showToast: vi.fn(),
      switchTab: vi.fn()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps successful uploads and shows a partial failure toast", async () => {
    apiMocks.uploadCheckinPhoto
      .mockResolvedValueOnce({
        fileId: "cloud://demo/a.jpg",
        objectKey: "checkins/a.jpg",
        localPath: "a.jpg"
      })
      .mockRejectedValueOnce(new Error("Upload failed"));

    const definition = await loadCompletePageDefinition();
    const page = instantiatePage(definition);

    await page.choosePhotos();

    expect(apiMocks.uploadCheckinPhoto).toHaveBeenCalledTimes(2);
    expect(page.data.photos).toEqual([
      {
        fileId: "cloud://demo/a.jpg",
        objectKey: "checkins/a.jpg",
        localPath: "a.jpg"
      }
    ]);
    expect(wx.showLoading).toHaveBeenCalledWith({
      title: "上传中"
    });
    expect(wx.hideLoading).toHaveBeenCalledTimes(1);
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "已上传1张，1张失败",
      icon: "none"
    });
  });

  it("tracks subject and tag selection state and submits multiple subjects", async () => {
    apiMocks.completeSession.mockResolvedValue({
      session: {
        id: "session-1",
        durationMinutes: 90,
        status: "completed"
      },
      dailyStats: {
        totalMinutes: 90,
        heatLevel: 2,
        streakDays: 1
      }
    });

    const definition = await loadCompletePageDefinition();
    const page = instantiatePage(definition);

    expect(page.data.subjectOptions).toEqual([
      { value: "会计", active: false },
      { value: "审计", active: false },
      { value: "税法", active: false },
      { value: "财管", active: false },
      { value: "经济法", active: false },
      { value: "战略", active: false }
    ]);
    expect(page.data.tagOptions).toEqual([
      { value: "顺利", active: false },
      { value: "卡住", active: false },
      { value: "高效", active: false },
      { value: "复习", active: false },
      { value: "刷题", active: false },
      { value: "新课", active: false }
    ]);

    page.toggleSubject({ currentTarget: { dataset: { value: "审计" } } });
    page.toggleSubject({ currentTarget: { dataset: { value: "税法" } } });
    page.toggleTag({ currentTarget: { dataset: { value: "高效" } } });

    page.setData({
      sessionId: "session-1",
      summary: "今天把审计和税法一起推进了。",
      photos: [
        {
          fileId: "cloud://demo/photo-1.jpg",
          objectKey: "checkins/2026/04/photo-1.jpg",
          localPath: "photo-1.jpg"
        }
      ]
    });

    await page.submit();

    expect(page.data.subjectOptions).toEqual([
      { value: "会计", active: false },
      { value: "审计", active: true },
      { value: "税法", active: true },
      { value: "财管", active: false },
      { value: "经济法", active: false },
      { value: "战略", active: false }
    ]);
    expect(page.data.tagOptions).toEqual([
      { value: "顺利", active: false },
      { value: "卡住", active: false },
      { value: "高效", active: true },
      { value: "复习", active: false },
      { value: "刷题", active: false },
      { value: "新课", active: false }
    ]);
    expect(apiMocks.completeSession).toHaveBeenCalledWith("session-1", {
      summary: "今天把审计和税法一起推进了。",
      subjects: ["审计", "税法"],
      tags: ["高效"],
      photos: [
        {
          fileId: "cloud://demo/photo-1.jpg",
          objectKey: "checkins/2026/04/photo-1.jpg"
        }
      ]
    });
  });
});

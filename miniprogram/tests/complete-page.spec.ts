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
});

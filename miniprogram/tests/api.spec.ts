import { beforeEach, describe, expect, it, vi } from "vitest";

describe("miniprogram api helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("batches temp-url requests in groups of 30 and merges the response", async () => {
    const init = vi.fn();
    const callContainer = vi.fn(async ({ data }: { data: { objectKeys: string[] } }) => ({
      data: {
        items: data.objectKeys.map((objectKey) => ({
          objectKey,
          url: `https://example.com/${objectKey}`,
          expiresAt: "2026-04-21T12:00:00.000Z"
        }))
      }
    }));

    vi.stubGlobal("wx", {
      cloud: {
        init,
        callContainer
      }
    });

    const { getTempUrls } = await import("../utils/api");
    const objectKeys = Array.from({ length: 61 }, (_item, index) => `checkins/${index}.jpg`);

    const response = await getTempUrls(objectKeys);

    expect(init).toHaveBeenCalledTimes(1);
    expect(callContainer).toHaveBeenCalledTimes(3);
    expect(callContainer.mock.calls.map(([payload]) => payload.data.objectKeys.length)).toEqual([30, 30, 1]);
    expect(response.items).toHaveLength(61);
    expect(response.items.at(0)).toEqual({
      objectKey: "checkins/0.jpg",
      url: "https://example.com/checkins/0.jpg",
      expiresAt: "2026-04-21T12:00:00.000Z"
    });
    expect(response.items.at(-1)?.objectKey).toBe("checkins/60.jpg");
  });

  it("adds a bearer token to authenticated container requests", async () => {
    const init = vi.fn();
    const callContainer = vi.fn(async () => ({
      data: {
        profile: {
          id: "user-1",
          nickname: "Token User",
          avatarUrl: "",
          profileCompleted: false,
          shareSlug: "slug-1",
          isPublic: false,
          requireWechatAuth: true
        },
        needsOnboarding: true,
        serverTime: "2026-04-21T12:00:00.000Z"
      }
    }));
    const setStorageSync = vi.fn();

    vi.stubGlobal("wx", {
      setStorageSync,
      cloud: {
        init,
        callContainer
      }
    });

    const { bootstrapProfile, setSessionToken } = await import("../utils/api");
    setSessionToken("session-token");
    await bootstrapProfile();

    expect(setStorageSync).toHaveBeenCalledWith("cpa.sessionToken", "session-token");
    expect(init).toHaveBeenCalledTimes(1);
    expect(callContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/me/bootstrap",
        header: expect.objectContaining({
          "X-WX-SERVICE": "cpa-study-checkin",
          Authorization: "Bearer session-token"
        })
      })
    );
  });

  it("posts the WeChat login code without a bearer token and stores the returned session token", async () => {
    const init = vi.fn();
    const callContainer = vi.fn(async () => ({
      data: {
        token: "fresh-session-token",
        profile: {
          id: "user-1",
          nickname: "",
          avatarUrl: "",
          profileCompleted: false,
          shareSlug: "slug-1",
          isPublic: false,
          requireWechatAuth: true
        },
        needsOnboarding: true,
        serverTime: "2026-04-21T12:00:00.000Z"
      }
    }));
    const setStorageSync = vi.fn();

    vi.stubGlobal("wx", {
      setStorageSync,
      cloud: {
        init,
        callContainer
      }
    });

    const { getSessionToken, loginWithWechatCode } = await import("../utils/api");
    const response = await loginWithWechatCode("wechat-code");

    expect(init).toHaveBeenCalledTimes(1);
    expect(callContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/auth/login",
        data: {
          code: "wechat-code"
        },
        header: {
          "X-WX-SERVICE": "cpa-study-checkin",
          "content-type": "application/json"
        }
      })
    );
    expect(setStorageSync).toHaveBeenCalledWith("cpa.sessionToken", "fresh-session-token");
    expect(getSessionToken()).toBe("fresh-session-token");
    expect(response.token).toBe("fresh-session-token");
  });

  it("still uses cloud upload for check-in photos", async () => {
    const init = vi.fn();
    const uploadFile = vi.fn(async () => ({
      fileID: "cloud://env/checkins/1.jpg"
    }));

    vi.stubGlobal("wx", {
      cloud: {
        init,
        uploadFile
      }
    });

    const { uploadCheckinPhoto } = await import("../utils/api");
    const response = await uploadCheckinPhoto("/tmp/checkin.jpg");

    expect(init).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(response.fileId).toBe("cloud://env/checkins/1.jpg");
    expect(response.objectKey).toContain("checkins/");
  });
});

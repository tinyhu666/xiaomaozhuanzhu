import { beforeEach, describe, expect, it, vi } from "vitest";

describe("miniprogram api helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("batches temp-url requests in groups of 30 and merges the response", async () => {
    const request = vi.fn(
      ({
        data,
        success
      }: {
        data: { objectKeys: string[] };
        success: (response: unknown) => void;
      }) => {
        success({
          statusCode: 200,
          data: {
            items: data.objectKeys.map((objectKey) => ({
              objectKey,
              url: `https://example.com/${objectKey}`,
              expiresAt: "2026-04-21T12:00:00.000Z"
            }))
          }
        });
      }
    );

    vi.stubGlobal("wx", {
      request
    });

    const { getTempUrls } = await import("../utils/api");
    const objectKeys = Array.from({ length: 61 }, (_item, index) => `checkins/${index}.jpg`);

    const response = await getTempUrls(objectKeys);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([payload]) => payload.data.objectKeys.length)).toEqual([30, 30, 1]);
    expect(response.items).toHaveLength(61);
    expect(response.items.at(0)).toEqual({
      objectKey: "checkins/0.jpg",
      url: "https://example.com/checkins/0.jpg",
      expiresAt: "2026-04-21T12:00:00.000Z"
    });
    expect(response.items.at(-1)?.objectKey).toBe("checkins/60.jpg");
  });

  it("adds a bearer token to authenticated https requests", async () => {
    const request = vi.fn(({ success }: { success: (response: unknown) => void }) => {
      success({
        statusCode: 200,
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
      });
    });
    const setStorageSync = vi.fn();

    vi.stubGlobal("wx", {
      request,
      setStorageSync
    });

    const { bootstrapProfile, setSessionToken } = await import("../utils/api");
    setSessionToken("session-token");
    await bootstrapProfile();

    expect(setStorageSync).toHaveBeenCalledWith("cpa.sessionToken", "session-token");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.lofttt.com/api/me/bootstrap",
        header: expect.objectContaining({
          Authorization: "Bearer session-token"
        })
      })
    );
  });

  it("posts the WeChat login code without a bearer token and stores the returned session token", async () => {
    const request = vi.fn(({ success }: { success: (response: unknown) => void }) => {
      success({
        statusCode: 200,
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
      });
    });
    const setStorageSync = vi.fn();

    vi.stubGlobal("wx", {
      request,
      setStorageSync
    });

    const { getSessionToken, loginWithWechatCode } = await import("../utils/api");
    const response = await loginWithWechatCode("wechat-code");

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.lofttt.com/api/auth/login",
        data: {
          code: "wechat-code"
        },
        header: {
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

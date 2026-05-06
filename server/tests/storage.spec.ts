import { describe, expect, it, vi } from "vitest";

import {
  HybridStorageClient,
  detectStorageMode,
  type StorageClient
} from "../src/storage/default-storage";

function fakeClient(label: string, behavior: (items: Array<{ objectKey: string; fileId?: string }>) => Promise<Array<{ objectKey: string; url: string; expiresAt: string }>>): StorageClient {
  return {
    getTemporaryUrls: vi.fn(behavior).mockName(label) as StorageClient["getTemporaryUrls"]
  };
}

describe("detectStorageMode", () => {
  it("identifies wechat-hybrid when both cloudrun and token credentials are present", () => {
    expect(
      detectStorageMode({
        WECHAT_OPENAPI_INTERNAL: "1",
        WECHAT_CLOUD_ENV: "prod",
        WECHAT_APP_ID: "app",
        WECHAT_APP_SECRET: "secret"
      })
    ).toBe("wechat-hybrid");
  });

  it("falls through to wechat-token when only token credentials exist", () => {
    expect(
      detectStorageMode({
        WECHAT_CLOUD_ENV: "prod",
        WECHAT_APP_ID: "app",
        WECHAT_APP_SECRET: "secret"
      })
    ).toBe("wechat-token");
  });

  it("identifies wechat-cloudrun when only cloudrun env is set", () => {
    expect(
      detectStorageMode({
        WECHAT_OPENAPI_INTERNAL: "1",
        WECHAT_CLOUD_ENV: "prod"
      })
    ).toBe("wechat-cloudrun");
  });

  it("falls through to default when no credentials are present", () => {
    expect(detectStorageMode({})).toBe("default");
  });
});

describe("HybridStorageClient", () => {
  const items = [{ objectKey: "checkins/a.jpg", fileId: "cloud://demo/a.jpg" }];

  it("uses the primary client when it returns resolvable URLs", async () => {
    const primary = fakeClient("primary", async () => [
      { objectKey: "checkins/a.jpg", url: "https://primary.example/a.jpg", expiresAt: "x" }
    ]);
    const fallback = fakeClient("fallback", async () => {
      throw new Error("fallback should not be called");
    });

    const client = new HybridStorageClient(primary, fallback, "primary", "fallback");
    const result = await client.getTemporaryUrls(items);

    expect(result[0].url).toBe("https://primary.example/a.jpg");
    expect(primary.getTemporaryUrls).toHaveBeenCalledOnce();
    expect(fallback.getTemporaryUrls).not.toHaveBeenCalled();
  });

  it("falls back when primary throws", async () => {
    const primary = fakeClient("primary", async () => {
      throw new Error("WeChat batchdownloadfile failed: access_token missing (41001)");
    });
    const fallback = fakeClient("fallback", async () => [
      { objectKey: "checkins/a.jpg", url: "https://fallback.example/a.jpg", expiresAt: "x" }
    ]);

    const client = new HybridStorageClient(primary, fallback, "primary", "fallback");
    const result = await client.getTemporaryUrls(items);

    expect(result[0].url).toBe("https://fallback.example/a.jpg");
    expect(primary.getTemporaryUrls).toHaveBeenCalledOnce();
    expect(fallback.getTemporaryUrls).toHaveBeenCalledOnce();
  });

  it("falls back when primary returns rows with no URLs (silent failure)", async () => {
    const primary = fakeClient("primary", async () => [
      { objectKey: "checkins/a.jpg", url: "", expiresAt: "x" }
    ]);
    const fallback = fakeClient("fallback", async () => [
      { objectKey: "checkins/a.jpg", url: "https://fallback.example/a.jpg", expiresAt: "x" }
    ]);

    const client = new HybridStorageClient(primary, fallback, "primary", "fallback");
    const result = await client.getTemporaryUrls(items);

    expect(result[0].url).toBe("https://fallback.example/a.jpg");
    expect(fallback.getTemporaryUrls).toHaveBeenCalledOnce();
  });

  it("does not fall back when items have no fileIds (nothing to resolve)", async () => {
    const primary = fakeClient("primary", async () => [
      { objectKey: "checkins/a.jpg", url: "", expiresAt: "x" }
    ]);
    const fallback = fakeClient("fallback", async () => {
      throw new Error("fallback should not be called");
    });

    const client = new HybridStorageClient(primary, fallback, "primary", "fallback");
    const result = await client.getTemporaryUrls([{ objectKey: "checkins/a.jpg" }]);

    expect(result).toHaveLength(1);
    expect(fallback.getTemporaryUrls).not.toHaveBeenCalled();
  });
});

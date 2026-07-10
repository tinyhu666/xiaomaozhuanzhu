import { afterEach, describe, expect, it } from "vitest";

import {
  DefaultStorageClient,
  createStorageClient,
  detectStorageMode
} from "../src/storage/default-storage";

describe("detectStorageMode", () => {
  it("identifies cos when all COS credentials are present", () => {
    expect(
      detectStorageMode({
        COS_SECRET_ID: "id",
        COS_SECRET_KEY: "key",
        COS_BUCKET: "bucket-123",
        COS_REGION: "ap-shanghai"
      })
    ).toBe("cos");
  });

  it("falls through to default when COS credentials are incomplete", () => {
    expect(detectStorageMode({ COS_SECRET_ID: "id", COS_BUCKET: "bucket-123" })).toBe("default");
  });

  it("falls through to default when no credentials are present", () => {
    expect(detectStorageMode({})).toBe("default");
  });
});

describe("DefaultStorageClient", () => {
  it("returns a placeholder URL (no real backend configured)", async () => {
    const client = new DefaultStorageClient();
    const [item] = await client.getTemporaryUrls([{ objectKey: "uploads/u/x.jpg" }]);
    expect(item.objectKey).toBe("uploads/u/x.jpg");
    expect(item.url).toContain("/uploads/u/x.jpg");
  });
});

describe("createStorageClient (COS mode)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("signs a COS GET url for the objectKey and exposes upload credentials", async () => {
    process.env.COS_SECRET_ID = "AKIDTESTTESTTESTTESTTESTTESTTEST";
    process.env.COS_SECRET_KEY = "TESTSECRETKEYTESTSECRETKEYTEST12";
    process.env.COS_BUCKET = "xiaomao-1259551686";
    process.env.COS_REGION = "ap-shanghai";
    delete process.env.STORAGE_PUBLIC_BASE_URL;

    const client = createStorageClient();
    const [item] = await client.getTemporaryUrls([{ objectKey: "uploads/u/x.jpg" }]);
    expect(item.url).toContain("xiaomao-1259551686.cos.ap-shanghai.myqcloud.com/uploads/u/x.jpg");
    expect(item.url).toContain("q-sign-algorithm=sha1");

    const [cred] = await client.createUploadCredentials!([{ objectKey: "uploads/u/y.jpg" }]);
    expect(cred.method).toBe("PUT");
    expect(cred.uploadUrl).toContain("q-signature=");
    expect(cred.publicUrl).toBe(
      "https://xiaomao-1259551686.cos.ap-shanghai.myqcloud.com/uploads/u/y.jpg"
    );
  });
});

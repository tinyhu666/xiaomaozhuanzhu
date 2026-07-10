import type { TemporaryUrl } from "../types";

export type StorageQuery = { objectKey: string; fileId?: string };

/**
 * v0.40 (M2) — direct-upload credential. The server picks a safe,
 * user-namespaced objectKey and signs a short-lived PUT URL; the
 * miniprogram uploads the file bytes straight to COS, then submits the
 * objectKey back (in complete/profile). publicUrl is the bucket path
 * (private bucket → resolved to a signed GET on read via cos:// refs).
 */
export type UploadCredentialRequest = { objectKey: string };
export type UploadCredential = {
  objectKey: string;
  method: "PUT";
  uploadUrl: string;
  publicUrl: string;
  expiresAt: string;
};

export interface StorageClient {
  getTemporaryUrls(items: StorageQuery[]): Promise<TemporaryUrl[]>;
  /**
   * Issue presigned direct-upload credentials. Only the COS client
   * implements it; the placeholder DefaultStorageClient leaves it
   * undefined and the upload-credential route 503s. Callers MUST decide
   * the objectKey themselves (this method only signs) so a client can't
   * inject an arbitrary path.
   */
  createUploadCredentials?(items: UploadCredentialRequest[]): Promise<UploadCredential[]>;
}

export class DefaultStorageClient implements StorageClient {
  async getTemporaryUrls(items: StorageQuery[]) {
    const baseUrl = process.env.STORAGE_PUBLIC_BASE_URL ?? "https://temp.example.com";
    return items.map(
      (item): TemporaryUrl => ({
        objectKey: item.objectKey,
        url: `${baseUrl.replace(/\/$/, "")}/${item.objectKey}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
      })
    );
  }
}

// v0.45 — 微信云托管/云开发 storage (WechatHttpStorageClient + batchdownloadfile)
// was removed. The server now stores all media on 腾讯云 COS; only "cos"
// and the "default" placeholder remain.
export type StorageMode = "cos" | "default";

export function detectStorageMode(
  env: Partial<Record<string, string | undefined>> = process.env
): StorageMode {
  if (env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET && env.COS_REGION) return "cos";
  return "default";
}

export function createStorageClient(): StorageClient {
  if (
    process.env.COS_SECRET_ID &&
    process.env.COS_SECRET_KEY &&
    process.env.COS_BUCKET &&
    process.env.COS_REGION
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const COS = require("cos-nodejs-sdk-v5");
    const client = new COS({
      SecretId: process.env.COS_SECRET_ID,
      SecretKey: process.env.COS_SECRET_KEY
    });
    const bucket = process.env.COS_BUCKET;
    const region = process.env.COS_REGION;
    const publicBase = (
      process.env.STORAGE_PUBLIC_BASE_URL ?? `https://${bucket}.cos.${region}.myqcloud.com`
    ).replace(/\/$/, "");

    return {
      async getTemporaryUrls(items: StorageQuery[]) {
        const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
        return items.map((item) => ({
          objectKey: item.objectKey,
          url: client.getObjectUrl({
            Bucket: bucket,
            Region: region,
            Key: item.objectKey,
            Sign: true,
            Expires: 1800
          }),
          expiresAt
        }));
      },
      async createUploadCredentials(items: UploadCredentialRequest[]) {
        // 15-min window: long enough for a retried upload on slow mobile,
        // short enough that a leaked URL is near-useless.
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        return items.map((item) => ({
          objectKey: item.objectKey,
          method: "PUT" as const,
          // The PUT URL intentionally does NOT sign request headers (no
          // `Headers` passed). The client therefore sends an UNSIGNED
          // Content-Type, which COS accepts. If header signing is ever
          // added here, the client's putToCos Content-Type must be removed
          // or signed in lockstep or every upload 403s (SignatureDoesNotMatch).
          uploadUrl: client.getObjectUrl({
            Bucket: bucket,
            Region: region,
            Key: item.objectKey,
            Method: "PUT",
            Sign: true,
            Expires: 900
          }),
          publicUrl: `${publicBase}/${item.objectKey}`,
          expiresAt
        }));
      }
    } satisfies StorageClient;
  }

  return new DefaultStorageClient();
}

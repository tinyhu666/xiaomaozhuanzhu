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
   * Issue presigned direct-upload credentials. Optional: only the COS
   * client implements it; on 云托管 (wx.cloud.uploadFile) it's undefined
   * and the route 503s. Callers MUST decide the objectKey themselves
   * (this method only signs) so a client can't inject an arbitrary path.
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

type WechatAuthMode =
  | { kind: "cloudrun" }
  | { kind: "token"; appId: string; appSecret: string };

export class WechatHttpStorageClient implements StorageClient {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly env: string,
    private readonly auth: WechatAuthMode
  ) {}

  private get baseUrl() {
    return this.auth.kind === "cloudrun"
      ? "http://api.weixin.qq.com"
      : "https://api.weixin.qq.com";
  }

  private async resolveUrlWithAuth(path: string) {
    if (this.auth.kind === "cloudrun") {
      return `${this.baseUrl}${path}`;
    }
    const token = await this.getAccessToken();
    const separator = path.includes("?") ? "&" : "?";
    return `${this.baseUrl}${path}${separator}access_token=${encodeURIComponent(token)}`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.auth.kind !== "token") {
      throw new Error("getAccessToken called in cloudrun mode");
    }
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.value;
    }
    const url =
      `${this.baseUrl}/cgi-bin/token` +
      `?grant_type=client_credential&appid=${encodeURIComponent(this.auth.appId)}&secret=${encodeURIComponent(this.auth.appSecret)}`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!data.access_token) {
      throw new Error(`WeChat access_token failed: ${data.errmsg ?? "unknown"} (${data.errcode ?? "?"})`);
    }
    this.cachedToken = {
      value: data.access_token,
      expiresAt: now + (data.expires_in ?? 7200) * 1000
    };
    return data.access_token;
  }

  async getTemporaryUrls(items: StorageQuery[]) {
    const expiresAt = new Date(Date.now() + 7200 * 1000).toISOString();
    const resolvable = items.filter((item) => Boolean(item.fileId));
    if (!resolvable.length) {
      return items.map((item) => ({ objectKey: item.objectKey, url: "", expiresAt }));
    }

    const url = await this.resolveUrlWithAuth("/tcb/batchdownloadfile");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        env: this.env,
        file_list: resolvable.map((item) => ({
          fileid: item.fileId,
          max_age: 7200
        }))
      })
    });
    const data = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      file_list?: Array<{ fileid: string; download_url: string; status: number }>;
    };
    if (data.errcode) {
      throw new Error(`WeChat batchdownloadfile failed: ${data.errmsg ?? "unknown"} (${data.errcode})`);
    }

    const urlMap = new Map<string, string>();
    for (const file of data.file_list ?? []) {
      if (file.status === 0 && file.download_url) {
        urlMap.set(file.fileid, file.download_url);
      }
    }

    return items.map((item) => ({
      objectKey: item.objectKey,
      url: item.fileId ? urlMap.get(item.fileId) ?? "" : "",
      expiresAt
    }));
  }
}

export type StorageMode =
  | "wechat-cloudrun"
  | "wechat-token"
  | "wechat-hybrid"
  | "cos"
  | "default";

export function detectStorageMode(
  env: Partial<Record<string, string | undefined>> = process.env
): StorageMode {
  const cloudrunReady = env.WECHAT_OPENAPI_INTERNAL === "1" && Boolean(env.WECHAT_CLOUD_ENV);
  const tokenReady = Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && env.WECHAT_CLOUD_ENV);
  if (cloudrunReady && tokenReady) return "wechat-hybrid";
  if (cloudrunReady) return "wechat-cloudrun";
  if (tokenReady) return "wechat-token";
  if (env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET && env.COS_REGION) return "cos";
  return "default";
}

/**
 * Tries the primary storage client first. If it throws OR returns
 * URL-less items (the typical "platform didn't sign my request"
 * outcome), automatically retries via a fallback client. Used to make
 * cloud-run + token configuration resilient: if the platform's
 * access_token auto-injection is broken, the AppSecret-based path
 * recovers without touching the deployment.
 */
export class HybridStorageClient implements StorageClient {
  constructor(
    private readonly primary: StorageClient,
    private readonly fallback: StorageClient,
    private readonly primaryLabel: string,
    private readonly fallbackLabel: string
  ) {}

  async getTemporaryUrls(items: StorageQuery[]) {
    try {
      const result = await this.primary.getTemporaryUrls(items);
      const resolvable = items.filter((item) => Boolean(item.fileId));
      const someResolved = result.some((row) => row.url);
      if (resolvable.length === 0 || someResolved) return result;
      throw new Error(`${this.primaryLabel} returned no URLs`);
    } catch (error) {
      console.warn(
        `[storage] ${this.primaryLabel} failed, falling back to ${this.fallbackLabel}:`,
        error instanceof Error ? error.message : error
      );
      return this.fallback.getTemporaryUrls(items);
    }
  }
}

export function createStorageClient(): StorageClient {
  const cloudrunClient =
    process.env.WECHAT_OPENAPI_INTERNAL === "1" && process.env.WECHAT_CLOUD_ENV
      ? new WechatHttpStorageClient(process.env.WECHAT_CLOUD_ENV, { kind: "cloudrun" })
      : null;

  const tokenClient =
    process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET && process.env.WECHAT_CLOUD_ENV
      ? new WechatHttpStorageClient(process.env.WECHAT_CLOUD_ENV, {
          kind: "token",
          appId: process.env.WECHAT_APP_ID,
          appSecret: process.env.WECHAT_APP_SECRET
        })
      : null;

  if (cloudrunClient && tokenClient) {
    return new HybridStorageClient(cloudrunClient, tokenClient, "cloudrun", "token");
  }
  if (cloudrunClient) return cloudrunClient;
  if (tokenClient) return tokenClient;

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

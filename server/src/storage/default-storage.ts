import type { TemporaryUrl } from "../types";

export type StorageQuery = { objectKey: string; fileId?: string };

export interface StorageClient {
  getTemporaryUrls(items: StorageQuery[]): Promise<TemporaryUrl[]>;
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

export class WechatHttpStorageClient implements StorageClient {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly env: string
  ) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.value;
    }
    const url =
      "https://api.weixin.qq.com/cgi-bin/token" +
      `?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
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

    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `https://api.weixin.qq.com/tcb/batchdownloadfile?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: this.env,
          file_list: resolvable.map((item) => ({
            fileid: item.fileId,
            max_age: 7200
          }))
        })
      }
    );
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

export function createStorageClient(): StorageClient {
  if (
    process.env.WECHAT_APP_ID &&
    process.env.WECHAT_APP_SECRET &&
    process.env.WECHAT_CLOUD_ENV
  ) {
    return new WechatHttpStorageClient(
      process.env.WECHAT_APP_ID,
      process.env.WECHAT_APP_SECRET,
      process.env.WECHAT_CLOUD_ENV
    );
  }

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

    return {
      async getTemporaryUrls(items: StorageQuery[]) {
        const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
        return items.map((item) => ({
          objectKey: item.objectKey,
          url: client.getObjectUrl({
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: item.objectKey,
            Sign: true,
            Expires: 1800
          }),
          expiresAt
        }));
      }
    } satisfies StorageClient;
  }

  return new DefaultStorageClient();
}

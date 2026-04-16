import type { TemporaryUrl } from "../types";

export interface StorageClient {
  getTemporaryUrls(objectKeys: string[]): Promise<TemporaryUrl[]>;
}

export class DefaultStorageClient implements StorageClient {
  async getTemporaryUrls(objectKeys: string[]) {
    const baseUrl = process.env.STORAGE_PUBLIC_BASE_URL ?? "https://temp.example.com";
    return objectKeys.map(
      (objectKey): TemporaryUrl => ({
        objectKey,
        url: `${baseUrl.replace(/\/$/, "")}/${objectKey}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
      })
    );
  }
}

export function createStorageClient() {
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
      async getTemporaryUrls(objectKeys: string[]) {
        const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
        return objectKeys.map((objectKey) => ({
          objectKey,
          url: client.getObjectUrl({
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: objectKey,
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

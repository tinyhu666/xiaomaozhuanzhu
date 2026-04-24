import type { StorageClient } from "./storage/default-storage";

const AVATAR_STORAGE_PREFIX = "storage://";

export function isAvatarStorageRef(value: string) {
  return extractAvatarObjectKey(value).length > 0;
}

export function isPersistedAvatarValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (isAvatarStorageRef(trimmed)) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function buildAvatarStorageRef(objectKey: string) {
  const normalized = objectKey.trim().replace(/^\/+/, "");
  return `${AVATAR_STORAGE_PREFIX}${normalized}`;
}

export function extractAvatarObjectKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(AVATAR_STORAGE_PREFIX)) {
    return "";
  }

  return trimmed.slice(AVATAR_STORAGE_PREFIX.length).replace(/^\/+/, "").trim();
}

export async function resolveAvatarUrl(value: string, storage: StorageClient) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const objectKey = extractAvatarObjectKey(trimmed);
  if (!objectKey) {
    return trimmed;
  }

  const [item] = await storage.getTemporaryUrls([objectKey]);
  return item?.url ?? "";
}

export async function resolveAvatarUrlMap(
  items: Array<{
    id: string;
    avatarUrl: string;
  }>,
  storage: StorageClient
) {
  const objectKeys = [...new Set(items.map((item) => extractAvatarObjectKey(item.avatarUrl)).filter(Boolean))];
  const tempUrlByObjectKey = new Map<string, string>();

  if (objectKeys.length) {
    const tempUrls = await storage.getTemporaryUrls(objectKeys);
    for (const item of tempUrls) {
      tempUrlByObjectKey.set(item.objectKey, item.url);
    }
  }

  return new Map(
    items.map((item) => {
      const objectKey = extractAvatarObjectKey(item.avatarUrl);
      return [item.id, objectKey ? tempUrlByObjectKey.get(objectKey) ?? "" : item.avatarUrl];
    })
  );
}

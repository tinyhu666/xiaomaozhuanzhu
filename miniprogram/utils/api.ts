import { runtimeConfig } from "../config/runtime";
import type {
  CalendarDayResponse,
  HomeResponse,
  ProfileDashboardResponse,
  SessionPhoto,
  UserProfile
} from "../types/models";

let cloudReady = false;
let sessionToken = "";
const SESSION_TOKEN_STORAGE_KEY = "cpa.sessionToken";

function ensureCloudReady() {
  if (cloudReady) return;
  wx.cloud.init({
    env: runtimeConfig.cloudEnv,
    traceUser: true
  });
  cloudReady = true;
}

type RequestOptions = {
  path: string;
  method?: "GET" | "POST";
  data?: Record<string, unknown>;
  skipAuth?: boolean;
};

type TempUrlResponse = {
  items: Array<{ objectKey: string; url: string; expiresAt: string }>;
};

function requestApi<T>({ path, method = "GET", data, skipAuth = false }: RequestOptions) {
  const header: Record<string, string> = {
  };
  if (!skipAuth) {
    const token = getSessionToken();
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }
  }
  if (method === "POST") {
    header["content-type"] = "application/json";
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${runtimeConfig.apiBaseUrl}${path}`,
      method,
      header,
      data: method === "POST" ? data ?? {} : data,
      success(response) {
        const payload = response.data as
          | {
              error?: {
                code: string;
                message: string;
              };
            }
          | string
          | null
          | undefined;

        if (payload && typeof payload === "object" && "error" in payload && payload.error) {
          reject(new Error(payload.error.message));
          return;
        }

        const statusCode = response.statusCode;
        if (typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300)) {
          const fallback = typeof payload === "string" && payload.length > 0 ? payload : `HTTP ${statusCode}`;
          reject(new Error(`${method} ${path} failed: ${fallback}`));
          return;
        }

        resolve(payload as T);
      },
      fail(error) {
        reject(new Error(error.errMsg || `${method} ${path} failed`));
      }
    });
  });
}

export function hydrateSessionToken() {
  if (sessionToken) {
    return sessionToken;
  }

  const storageApi = wx as typeof wx & {
    getStorageSync?: (key: string) => string;
  };
  const stored = storageApi.getStorageSync?.(SESSION_TOKEN_STORAGE_KEY);
  sessionToken = typeof stored === "string" ? stored.trim() : "";
  return sessionToken;
}

export function getSessionToken() {
  return sessionToken || hydrateSessionToken();
}

export function setSessionToken(token: string | null) {
  sessionToken = token?.trim() ?? "";
  const storageApi = wx as typeof wx & {
    removeStorageSync?: (key: string) => void;
    setStorageSync?: (key: string, value: string) => void;
  };

  if (sessionToken) {
    storageApi.setStorageSync?.(SESSION_TOKEN_STORAGE_KEY, sessionToken);
    return;
  }

  storageApi.removeStorageSync?.(SESSION_TOKEN_STORAGE_KEY);
}

export function bootstrapProfile() {
  return requestApi<{
    profile: UserProfile;
    needsOnboarding: boolean;
    serverTime: string;
  }>({
    path: "/me/bootstrap",
    method: "POST"
  });
}

export async function loginWithWechatCode(code: string) {
  const result = await requestApi<{
    token: string;
    profile: UserProfile;
    needsOnboarding: boolean;
    serverTime: string;
  }>({
    path: "/auth/login",
    method: "POST",
    data: { code },
    skipAuth: true
  });

  setSessionToken(result.token);
  return result;
}

export function saveProfile(payload: {
  nickname: string;
  avatarUrl: string;
  isPublic?: boolean;
  requireWechatAuth?: boolean;
}) {
  return requestApi<{
    profile: UserProfile;
  }>({
    path: "/me/profile",
    method: "POST",
    data: payload
  });
}

export function getHome(quoteEvent: "advance" | "peek" = "advance") {
  return requestApi<HomeResponse>({
    path: `/home?quoteEvent=${quoteEvent}`
  });
}

export function startSession() {
  return requestApi<{ session: HomeResponse["activeSession"]; reused: boolean }>({
    path: "/sessions/start",
    method: "POST"
  });
}

export function pauseSession(sessionId: string) {
  return requestApi<{ session: HomeResponse["activeSession"] }>({
    path: `/sessions/${sessionId}/pause`,
    method: "POST"
  });
}

export function resumeSession(sessionId: string) {
  return requestApi<{ session: HomeResponse["activeSession"] }>({
    path: `/sessions/${sessionId}/resume`,
    method: "POST"
  });
}

export function completeSession(
  sessionId: string,
  payload: {
    summary: string;
    subjects: string[];
    tags: string[];
    photos: SessionPhoto[];
  }
) {
  return requestApi<{
    session: {
      id: string;
      durationMinutes: number;
      status: string;
    };
    dailyStats: {
      totalMinutes: number;
      heatLevel: number;
      streakDays: number;
    };
  }>({
    path: `/sessions/${sessionId}/complete`,
    method: "POST",
    data: payload
  });
}

export function getCalendar(month: string) {
  return requestApi<{
    month: string;
    days: Record<string, HomeResponse["today"]>;
  }>({
    path: `/calendar?month=${month}`
  });
}

export function getCalendarDay(date: string) {
  return requestApi<CalendarDayResponse>({
    path: `/calendar/${date}`
  });
}

export function getProfileDashboard() {
  return requestApi<ProfileDashboardResponse>({
    path: "/me/dashboard"
  });
}

export async function getTempUrls(objectKeys: string[]) {
  const uniqueKeys = [...new Set(objectKeys.filter((item) => item))];
  if (!uniqueKeys.length) {
    return { items: [] } satisfies TempUrlResponse;
  }

  const responses: TempUrlResponse[] = [];
  for (let index = 0; index < uniqueKeys.length; index += 30) {
    responses.push(
      await requestApi<TempUrlResponse>({
        path: "/storage/temp-urls",
        method: "POST",
        data: { objectKeys: uniqueKeys.slice(index, index + 30) }
      })
    );
  }

  return {
    items: responses.flatMap((response) => response.items)
  } satisfies TempUrlResponse;
}

export async function uploadCheckinPhoto(localPath: string) {
  ensureCloudReady();
  const timestamp = Date.now();
  const extension = localPath.split(".").pop() || "jpg";
  const objectKey = `checkins/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${timestamp}.${extension}`;
  const result = await wx.cloud.uploadFile({
    cloudPath: objectKey,
    filePath: localPath,
    config: {
      env: runtimeConfig.cloudEnv
    }
  });

  return {
    fileId: result.fileID,
    objectKey,
    localPath
  };
}

export async function uploadWechatAvatar(localPath: string) {
  ensureCloudReady();
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const extension = localPath.split(".").pop() || "jpg";
  const objectKey = `avatars/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${timestamp}-${randomSuffix}.${extension}`;
  const result = await wx.cloud.uploadFile({
    cloudPath: objectKey,
    filePath: localPath,
    config: {
      env: runtimeConfig.cloudEnv
    }
  });

  return {
    fileId: result.fileID,
    objectKey,
    localPath
  };
}

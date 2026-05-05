import { runtimeConfig } from "../config/runtime";
import type {
  CalendarDayResponse,
  HomeResponse,
  ProfileDashboardResponse,
  PublicProfileResponse,
  SessionPhoto,
  UserProfile
} from "../types/models";

let cloudReady = false;

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
};

const COLD_START_RETRY_DELAYS = [400, 1200];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrMsg(error: unknown): string {
  if (typeof error === "object" && error && "errMsg" in error) {
    return String((error as { errMsg: string }).errMsg);
  }
  return String(error);
}

function isLikelyColdStart(errMsg: string) {
  return (
    errMsg.includes("102002") ||
    errMsg.includes("502") ||
    errMsg.includes("503") ||
    errMsg.includes("504") ||
    errMsg.toLowerCase().includes("timeout") ||
    errMsg.toLowerCase().includes("request:fail")
  );
}

async function callContainer<T>({ path, method = "GET", data }: RequestOptions) {
  ensureCloudReady();

  const header: Record<string, string> = {
    "X-WX-SERVICE": runtimeConfig.service
  };
  if (method === "POST") {
    header["content-type"] = "application/json";
  }

  const callOnce = () =>
    wx.cloud.callContainer({
      config: {
        env: runtimeConfig.cloudEnv
      },
      path: `${runtimeConfig.basePath}${path}`,
      method,
      header,
      data: method === "POST" ? data ?? {} : data
    });

  let response: { data: unknown; statusCode?: number } | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= COLD_START_RETRY_DELAYS.length; attempt += 1) {
    try {
      response = await callOnce();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const errMsg = extractErrMsg(error);
      if (attempt < COLD_START_RETRY_DELAYS.length && isLikelyColdStart(errMsg)) {
        await delay(COLD_START_RETRY_DELAYS[attempt]);
        continue;
      }
      break;
    }
  }

  if (lastError) {
    const errMsg = extractErrMsg(lastError);
    if (errMsg.includes("102002")) {
      throw new Error("后端正在唤醒，请稍后再试");
    }
    if (errMsg.includes("100002")) {
      throw new Error("云托管环境 ID 不正确，请联系管理员");
    }
    if (errMsg.toLowerCase().includes("timeout")) {
      throw new Error("网络超时，请稍后再试");
    }
    throw new Error(errMsg || "网络请求失败");
  }

  if (!response) {
    throw new Error("网络请求失败");
  }

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
    throw new Error(payload.error.message);
  }

  const statusCode = (response as { statusCode?: number }).statusCode;
  if (typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300)) {
    const fallback = typeof payload === "string" && payload.length > 0 ? payload : `HTTP ${statusCode}`;
    throw new Error(`${method} ${path} 失败：${fallback}`);
  }

  return response.data as T;
}

export async function warmUpBackend() {
  ensureCloudReady();
  try {
    await wx.cloud.callContainer({
      config: {
        env: runtimeConfig.cloudEnv
      },
      path: "/health",
      method: "GET",
      header: {
        "X-WX-SERVICE": runtimeConfig.service
      }
    });
  } catch (error) {
    // Best-effort warmup. Swallow errors so app launch never fails.
    console.info("[api] warmup failed (will retry on real call)", error);
  }
}

export function bootstrapProfile() {
  return callContainer<{
    profile: UserProfile;
    needsOnboarding: boolean;
    serverTime: string;
  }>({
    path: "/me/bootstrap",
    method: "POST"
  });
}

export function saveProfile(payload: {
  nickname: string;
  avatarUrl: string;
  isPublic?: boolean;
  requireWechatAuth?: boolean;
}) {
  return callContainer<{
    profile: UserProfile;
  }>({
    path: "/me/profile",
    method: "POST",
    data: payload
  });
}

export function getHome() {
  return callContainer<HomeResponse>({
    path: "/home"
  });
}

export function startSession() {
  return callContainer<{ session: HomeResponse["activeSession"]; reused: boolean }>({
    path: "/sessions/start",
    method: "POST"
  });
}

export function pauseSession(sessionId: string) {
  return callContainer<{ session: HomeResponse["activeSession"] }>({
    path: `/sessions/${sessionId}/pause`,
    method: "POST"
  });
}

export function resumeSession(sessionId: string) {
  return callContainer<{ session: HomeResponse["activeSession"] }>({
    path: `/sessions/${sessionId}/resume`,
    method: "POST"
  });
}

export function abandonSession(sessionId: string) {
  return callContainer<{ session: { id: string; status: string } }>({
    path: `/sessions/${sessionId}/abandon`,
    method: "POST"
  });
}

export function makeupSession() {
  return callContainer<{ makeupDate: string; streakDays: number }>({
    path: `/sessions/makeup`,
    method: "POST"
  });
}

export function completeSession(
  sessionId: string,
  payload: {
    summary: string;
    subject: string | null;
    tags: string[];
    photos: SessionPhoto[];
  }
) {
  return callContainer<{
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
  return callContainer<{
    month: string;
    days: Record<string, HomeResponse["today"]>;
  }>({
    path: `/calendar?month=${month}`
  });
}

export function getCalendarDay(date: string) {
  return callContainer<CalendarDayResponse>({
    path: `/calendar/${date}`
  });
}

export function getShareMe() {
  return callContainer<{
    profile: UserProfile;
    summary: {
      totalMinutes: number;
      currentStreakDays: number;
    };
  }>({
    path: "/share/me"
  });
}

export function getProfileDashboard() {
  return callContainer<ProfileDashboardResponse>({
    path: "/me/dashboard"
  });
}

export function updateShareSettings(payload: { isPublic: boolean; requireWechatAuth: boolean }) {
  return callContainer<{
    publicProfile: {
      isPublic: boolean;
      requireWechatAuth: boolean;
      shareSlug: string;
    };
  }>({
    path: "/share/me",
    method: "POST",
    data: payload
  });
}

export function getPublicProfile(slug: string) {
  return callContainer<PublicProfileResponse>({
    path: `/public/${slug}`
  });
}

export function getTempUrls(items: Array<{ objectKey: string; fileId?: string }>) {
  return callContainer<{
    items: Array<{ objectKey: string; url: string; expiresAt: string }>;
  }>({
    path: "/storage/temp-urls",
    method: "POST",
    data: { items }
  });
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

export async function uploadAvatar(localPath: string) {
  ensureCloudReady();
  const timestamp = Date.now();
  const extension = localPath.split(".").pop()?.split("?")[0] || "jpg";
  const cloudPath = `avatars/${timestamp}.${extension}`;
  const result = await wx.cloud.uploadFile({
    cloudPath,
    filePath: localPath,
    config: {
      env: runtimeConfig.cloudEnv
    }
  });

  return {
    fileId: result.fileID,
    objectKey: cloudPath
  };
}

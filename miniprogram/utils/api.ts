import { runtimeConfig } from "../config/runtime";
import type {
  CalendarDayResponse,
  HomeResponse,
  ProfileDashboardResponse,
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

type TempUrlResponse = {
  items: Array<{ objectKey: string; url: string; expiresAt: string }>;
};

async function callContainer<T>({ path, method = "GET", data }: RequestOptions) {
  ensureCloudReady();

  const header: Record<string, string> = {
    "X-WX-SERVICE": runtimeConfig.service
  };
  if (method === "POST") {
    header["content-type"] = "application/json";
  }

  const response = await wx.cloud.callContainer({
    config: {
      env: runtimeConfig.cloudEnv
    },
    path: `${runtimeConfig.basePath}${path}`,
    method,
    header,
    data: method === "POST" ? data ?? {} : data
  });

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
    throw new Error(`${method} ${path} failed: ${fallback}`);
  }

  return response.data as T;
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

export function getHome(quoteEvent: "advance" | "peek" = "advance") {
  return callContainer<HomeResponse>({
    path: `/home?quoteEvent=${quoteEvent}`
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

export function getProfileDashboard() {
  return callContainer<ProfileDashboardResponse>({
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
      await callContainer<TempUrlResponse>({
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

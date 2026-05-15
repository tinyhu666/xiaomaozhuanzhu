import { runtimeConfig } from "../config/runtime";
import type {
  CalendarDayResponse,
  HomeResponse,
  NewsCategory,
  NewsDetailResponse,
  NewsListResponse,
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

/**
 * Stable anonymous identifier for this install. Generated lazily on first
 * use, persisted in `wx.setStorageSync` so it survives reopens / restarts.
 * It is sent on every API call as `X-CLIENT-UID`. The server uses this as
 * a fallback when `X-WX-OPENID` is unavailable, and merges anonymous
 * history into the WeChat-bound user once openid arrives.
 *
 * NOTE: clearing miniprogram storage (rare) creates a new clientUid; if
 * the user has openid, the server still resolves them correctly via
 * openid and re-attaches the new clientUid.
 */
const CLIENT_UID_STORAGE_KEY = "cpa.clientUid";

function generateClientUid() {
  // RFC 4122 v4-shaped UUID using Math.random (sufficient for a per-device
  // identifier; not used for cryptographic purposes).
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const value = (Math.random() * 16) | 0;
    const hex = char === "x" ? value : (value & 0x3) | 0x8;
    return hex.toString(16);
  });
}

let cachedClientUid: string | null = null;

export function getOrCreateClientUid(): string {
  if (cachedClientUid) return cachedClientUid;
  try {
    const existing = wx.getStorageSync(CLIENT_UID_STORAGE_KEY);
    if (typeof existing === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) {
      cachedClientUid = existing;
      return existing;
    }
  } catch (error) {
    console.warn("[api] read clientUid failed", error);
  }
  const fresh = generateClientUid();
  try {
    wx.setStorageSync(CLIENT_UID_STORAGE_KEY, fresh);
  } catch (error) {
    console.warn("[api] persist clientUid failed", error);
  }
  cachedClientUid = fresh;
  return fresh;
}

type RequestOptions = {
  path: string;
  method?: "GET" | "POST";
  data?: Record<string, unknown>;
};

// Two retry profiles:
//   - cold-start: backend is up but the cloud-run instance is waking
//     (102002 / 5xx / timeout / HTML gateway error). WeChat 云托管
//     cold-start is 5–15s for Node containers, so we budget up to ~7s
//     of retries before surfacing a failure. The first try is fast
//     because the warmup ping at app launch usually pre-heats things;
//     later retries back off so we don't hammer the gateway while it
//     is waking the container.
//   - transient network: request:fail / connection reset. Retry once
//     with a short delay so a flaky cell signal recovers, but don't
//     punish a genuinely-offline user with multiple long waits.
const COLD_START_RETRY_DELAYS = [500, 1500, 2500, 2500];
const NETWORK_RETRY_DELAYS = [250];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrMsg(error: unknown): string {
  if (typeof error === "object" && error && "errMsg" in error) {
    return String((error as { errMsg: string }).errMsg);
  }
  return String(error);
}

type RetryKind = "cold-start" | "network" | "none";

function classifyError(errMsg: string): RetryKind {
  if (errMsg.includes("102002")) return "cold-start";
  if (errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("504")) return "cold-start";
  if (errMsg.toLowerCase().includes("timeout")) return "cold-start";
  if (errMsg.toLowerCase().includes("request:fail")) return "network";
  return "none";
}

async function callContainer<T>({ path, method = "GET", data }: RequestOptions) {
  ensureCloudReady();

  const header: Record<string, string> = {
    "X-WX-SERVICE": runtimeConfig.service,
    "X-CLIENT-UID": getOrCreateClientUid()
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
  let coldAttempts = 0;
  let networkAttempts = 0;
  // Keep looping until we either succeed or run out of the matching
  // retry budget for this error kind.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      response = await callOnce();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const errMsg = extractErrMsg(error);
      const kind = classifyError(errMsg);
      if (kind === "cold-start" && coldAttempts < COLD_START_RETRY_DELAYS.length) {
        await delay(COLD_START_RETRY_DELAYS[coldAttempts]);
        coldAttempts += 1;
        continue;
      }
      if (kind === "network" && networkAttempts < NETWORK_RETRY_DELAYS.length) {
        await delay(NETWORK_RETRY_DELAYS[networkAttempts]);
        networkAttempts += 1;
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
    if (errMsg.toLowerCase().includes("request:fail")) {
      throw new Error("网络连接异常，请检查网络后重试");
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
  // Pre-create the clientUid before any real call so even the first
  // /me/bootstrap arrives carrying our anonymous fallback identifier.
  getOrCreateClientUid();
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

export function startSession(payload: { subject?: string | null; mode?: "free" | "pomodoro" } = {}) {
  return callContainer<{ session: HomeResponse["activeSession"]; reused: boolean }>({
    path: "/sessions/start",
    method: "POST",
    data: payload
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
    pomodoroCycles?: number;
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

export type PracticeDifficulty = "basic" | "intermediate" | "exam";

export type GeneratedQuestion = {
  id: string;
  subject: string;
  difficulty: PracticeDifficulty;
  question: string;
  options: string[];
};

export type PracticeGradeResult = {
  questionId: string;
  correct: boolean;
  correctAnswer: string;
  explanation: string;
  usedToday: number;
  dailyLimit: number;
};

export type Mistake = {
  id: string;
  subject: string;
  difficulty: PracticeDifficulty;
  question: string;
  options: string[];
  correctAnswer: string;
  userAnswer: string | null;
  aiExplanation: string | null;
  isCorrect: boolean | null;
  isMastered: boolean;
  createdAt: string;
  answeredAt: string | null;
};

export function generatePracticeQuiz(payload: {
  subject: string;
  difficulty: PracticeDifficulty;
  count?: number;
}) {
  return callContainer<{
    questions: GeneratedQuestion[];
    usedToday: number;
    dailyLimit: number;
  }>({
    path: "/ai/practice/generate",
    method: "POST",
    data: payload
  });
}

export function gradePracticeAnswer(payload: { questionId: string; userAnswer: string }) {
  return callContainer<PracticeGradeResult>({
    path: "/ai/practice/grade",
    method: "POST",
    data: payload
  });
}

export function listMistakes(params: { limit?: number; includeMastered?: boolean } = {}) {
  const query: string[] = [];
  if (params.limit) query.push(`limit=${params.limit}`);
  if (params.includeMastered) query.push(`includeMastered=1`);
  const qs = query.length ? `?${query.join("&")}` : "";
  return callContainer<{ items: Mistake[] }>({
    path: `/me/mistakes${qs}`
  });
}

export function setMistakeMastered(id: string, mastered: boolean) {
  return callContainer<{ item: Mistake }>({
    path: `/me/mistakes/${encodeURIComponent(id)}/mastered`,
    method: "POST",
    data: { mastered }
  });
}

export function askAi(payload: {
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  return callContainer<{
    answer: string;
    usedToday: number;
    dailyLimit: number;
  }>({
    path: "/ai/ask",
    method: "POST",
    data: payload
  });
}

export function getNewsList(params: { category?: NewsCategory | "all"; limit?: number; before?: string } = {}) {
  const queryParts: string[] = [];
  if (params.category && params.category !== "all") queryParts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.limit) queryParts.push(`limit=${params.limit}`);
  if (params.before) queryParts.push(`before=${encodeURIComponent(params.before)}`);
  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  return callContainer<NewsListResponse>({
    path: `/news${query}`
  });
}

export function getNewsDetail(id: string) {
  return callContainer<NewsDetailResponse>({
    path: `/news/${encodeURIComponent(id)}`
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

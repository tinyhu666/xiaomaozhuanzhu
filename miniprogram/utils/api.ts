import { runtimeConfig } from "../config/runtime";
import type {
  Badge,
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
// v0.21: extended cold-start budget. WeChat 云托管 Node containers
// can take 10-15s to wake from completely cold; the 7s budget from
// v0.20 was just shy of that and produced spurious "加载失败" toasts
// on first open. New schedule sums to ~13.5s with five back-offs.
const COLD_START_RETRY_DELAYS = [500, 1500, 2500, 3500, 5500];
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

/**
 * v0.43 — user-friendly error for non-2xx responses WITHOUT a structured
 * `{error:{message}}` body (those keep the server's Chinese copy). Pages
 * toast `error.message` directly, so "POST /xxx 失败：HTTP 400" leaked raw
 * transport details to users. Technical detail goes to the console only.
 */
function httpStatusError(method: string, path: string, statusCode: number, rawBody: unknown): Error {
  console.warn(`[api] ${method} ${path} HTTP ${statusCode}`, rawBody);
  if (statusCode === 400 || statusCode === 422) return new Error("请求参数有误，请重试");
  if (statusCode === 401 || statusCode === 403) return new Error("登录状态已失效，请重新进入小程序");
  if (statusCode === 404) return new Error("服务暂不可用，请稍后再试");
  if (statusCode >= 500) return new Error("服务异常，请稍后再试");
  return new Error(`请求失败（${statusCode}），请稍后再试`);
}

type RetryKind = "cold-start" | "network" | "none";

function classifyError(errMsg: string): RetryKind {
  if (errMsg.includes("102002")) return "cold-start";
  if (errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("504")) return "cold-start";
  if (errMsg.toLowerCase().includes("timeout")) return "cold-start";
  if (errMsg.toLowerCase().includes("request:fail")) return "network";
  return "none";
}

async function callContainerCloud<T>({ path, method = "GET", data }: RequestOptions) {
  ensureCloudReady();

  const header: Record<string, string> = {
    "X-WX-SERVICE": runtimeConfig.service,
    "X-CLIENT-UID": getOrCreateClientUid(),
    "X-CLIENT-VERSION": runtimeConfig.appVersion
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
    throw httpStatusError(method, path, statusCode, payload);
  }

  return response.data as T;
}

/* -------------------------------------------------------------------------- */
/*  v0.41 (M3) — VPS transport: wx.request + wx.login Bearer token              */
/* -------------------------------------------------------------------------- */

/** True when the client should talk HTTPS to the VPS instead of 云托管. */
function isHttpMode(): boolean {
  return Boolean(runtimeConfig.apiBaseUrl);
}

const SESSION_TOKEN_STORAGE_KEY = "cpa.sessionToken";
let cachedSessionToken: string | null = null;

function getStoredSessionToken(): string {
  if (cachedSessionToken) return cachedSessionToken;
  try {
    const existing = wx.getStorageSync(SESSION_TOKEN_STORAGE_KEY);
    if (typeof existing === "string" && existing) {
      cachedSessionToken = existing;
      return existing;
    }
  } catch (error) {
    console.warn("[api] read session token failed", error);
  }
  return "";
}

function setStoredSessionToken(token: string) {
  cachedSessionToken = token || null;
  try {
    if (token) {
      wx.setStorageSync(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      wx.removeStorageSync(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("[api] persist session token failed", error);
  }
}

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error("wx.login 未返回 code"))),
      fail: (error) => reject(new Error(extractErrMsg(error) || "wx.login 失败"))
    });
  });
}

/** Exchange a fresh wx.login code for a signed session token (VPS mode). */
async function loginForToken(): Promise<string> {
  const code = await wxLoginCode();
  // Bare request WITHOUT a bearer — this call is how we obtain one.
  const res = await httpRequestWithRetry({ path: "/auth/login", method: "POST", data: { code } }, {
    skipAuth: true
  });
  const body = finalizeHttp<{ token?: string }>({ path: "/auth/login", method: "POST" }, res);
  const token = body?.token ?? "";
  if (!token) throw new Error("登录失败：服务端未返回 token");
  setStoredSessionToken(token);
  return token;
}

// Coalesce concurrent logins: at launch several pages may fire requests
// at once; without this each would call wx.login (single-use codes) and
// race to store a token. One inflight login is shared by all callers.
let inflightLogin: Promise<string> | null = null;

function relogin(): Promise<string> {
  if (inflightLogin) return inflightLogin;
  inflightLogin = loginForToken().finally(() => {
    inflightLogin = null;
  });
  return inflightLogin;
}

async function ensureSessionToken(): Promise<string> {
  return getStoredSessionToken() || relogin();
}

type HttpResult = { statusCode: number; data: unknown };
type HttpExtra = { bearer?: string; skipAuth?: boolean };

function httpRequestOnce(opts: RequestOptions, extra: HttpExtra): Promise<HttpResult> {
  const header: Record<string, string> = {
    "X-CLIENT-UID": getOrCreateClientUid(),
    "X-CLIENT-VERSION": runtimeConfig.appVersion
  };
  if (opts.method === "POST") {
    header["content-type"] = "application/json";
  }
  if (!extra.skipAuth && extra.bearer) {
    header["Authorization"] = `Bearer ${extra.bearer}`;
  }
  const url = `${runtimeConfig.apiBaseUrl}${runtimeConfig.basePath}${opts.path}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: opts.method ?? "GET",
      header,
      data: opts.method === "POST" ? opts.data ?? {} : opts.data,
      success: (res) => resolve({ statusCode: res.statusCode, data: res.data }),
      fail: (error) => reject(error)
    });
  });
}

/**
 * Single request with the same retry profiles as the 云托管 path:
 *   - 5xx (502/503/504) ⇒ treat like a cold-start / deploy window → back off.
 *   - request:fail / timeout ⇒ transient network → one quick retry.
 * 4xx (incl. 401/404) are real responses, returned as-is for the caller
 * to interpret (callHttp turns 401 into a silent re-login).
 */
async function httpRequestWithRetry(opts: RequestOptions, extra: HttpExtra): Promise<HttpResult> {
  let coldAttempts = 0;
  let networkAttempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await httpRequestOnce(opts, extra);
      const is5xx = res.statusCode >= 500 && res.statusCode <= 599;
      if (is5xx && coldAttempts < COLD_START_RETRY_DELAYS.length) {
        await delay(COLD_START_RETRY_DELAYS[coldAttempts]);
        coldAttempts += 1;
        continue;
      }
      return res;
    } catch (error) {
      const kind = classifyError(extractErrMsg(error));
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
      const errMsg = extractErrMsg(error);
      if (errMsg.toLowerCase().includes("timeout")) throw new Error("网络超时，请稍后再试");
      if (errMsg.toLowerCase().includes("request:fail")) throw new Error("网络连接异常，请检查网络后重试");
      throw new Error(errMsg || "网络请求失败");
    }
  }
}

/** Map the HTTP response into either a typed body or a thrown Error. */
function finalizeHttp<T>(opts: RequestOptions, res: HttpResult): T {
  const payload = res.data as
    | { error?: { code: string; message: string } }
    | string
    | null
    | undefined;
  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
    throw new Error(payload.error.message);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw httpStatusError(opts.method ?? "GET", opts.path, res.statusCode, payload);
  }
  return res.data as T;
}

async function callHttp<T>(opts: RequestOptions): Promise<T> {
  // Public endpoints need no bearer: /auth/login bootstraps auth (attaching
  // one would recurse), and /app-config must work pre-login AND during a
  // maintenance window. Everything else gets a token first, with a single
  // silent re-login on a 401 (token expired / secret rotated).
  const isPublic = opts.path === "/auth/login" || opts.path === "/app-config";
  if (isPublic) {
    return finalizeHttp<T>(opts, await httpRequestWithRetry(opts, { skipAuth: true }));
  }
  const bearer = await ensureSessionToken();
  let res = await httpRequestWithRetry(opts, { bearer });
  if (res.statusCode === 401) {
    setStoredSessionToken("");
    const fresh = await relogin();
    res = await httpRequestWithRetry(opts, { bearer: fresh });
  }
  return finalizeHttp<T>(opts, res);
}

/**
 * Transport dispatcher. Every exported API function calls this; it picks
 * the 云托管 or VPS transport from runtimeConfig.apiBaseUrl so the cutover
 * is a one-line config flip with no call-site churn.
 */
async function callContainer<T>(opts: RequestOptions): Promise<T> {
  return isHttpMode() ? callHttp<T>(opts) : callContainerCloud<T>(opts);
}

export async function warmUpBackend() {
  if (isHttpMode()) {
    // VPS: pre-create the clientUid and (best-effort) log in so the first
    // real call already carries a Bearer. Never let warmup fail launch.
    getOrCreateClientUid();
    try {
      await ensureSessionToken();
    } catch (error) {
      console.info("[api] VPS warmup/login failed (will retry on real call)", error);
    }
    return;
  }
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

/* -------------------------------------------------------------------------- */
/*  v0.42 — launch-time app gate (maintenance / forced upgrade)                 */
/* -------------------------------------------------------------------------- */

export type AppConfig = {
  maintenance: boolean;
  minClientVersion: string;
  message: string;
};

/**
 * Fetch the launch gate. Auth-free, works in both transports, and FAILS
 * OPEN (returns null on any error) so a transient blip never bricks launch.
 */
export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const cfg = await callContainer<Partial<AppConfig>>({ path: "/app-config", method: "GET" });
    return {
      maintenance: Boolean(cfg?.maintenance),
      minClientVersion: typeof cfg?.minClientVersion === "string" ? cfg.minClientVersion : "",
      message: typeof cfg?.message === "string" ? cfg.message : ""
    };
  } catch (error) {
    console.info("[api] app-config fetch failed (fail-open)", error);
    return null;
  }
}

/** True when `current` is a lower x.y.z version than `min`. Empty min ⇒ false. */
export function isClientVersionBelow(current: string, min: string): boolean {
  if (!min) return false;
  const toParts = (v: string) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const c = toParts(current);
  const m = toParts(min);
  for (let i = 0; i < Math.max(c.length, m.length); i += 1) {
    const cv = c[i] ?? 0;
    const mv = m[i] ?? 0;
    if (cv !== mv) return cv < mv;
  }
  return false;
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
    /** v0.37 — A3: optional free-text chapter/topic within the subject. */
    topic?: string | null;
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
    // v0.32.5 — the server sets this when the just-completed session
    // crossed an achievement threshold (server/src/app.ts). It drives
    // the unlock overlay on the complete page. Previously the complete
    // page read it via an unsafe `as` cast because the type omitted it;
    // declaring it here makes the contract explicit so the overlay
    // can't be silently broken by a future refactor of that cast.
    newlyUnlockedBadge?: Badge | null;
  }>({
    path: `/sessions/${sessionId}/complete`,
    method: "POST",
    data: payload
  });
}

/**
 * v0.34 — A1 补录: record a completed study session for a past (or
 * today) date with a user-supplied duration. Same response shape as
 * completeSession (incl. newlyUnlockedBadge) so the caller can reuse
 * the post-submit handling.
 */
export function manualSession(payload: {
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  subject: string | null;
  topic?: string | null;
  tags: string[];
  summary?: string;
}) {
  return callContainer<{
    session: { id: string; durationMinutes: number; status: string };
    dailyStats: { totalMinutes: number; heatLevel: number; streakDays: number };
    newlyUnlockedBadge?: Badge | null;
  }>({
    path: `/sessions/manual`,
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

export type CompletedSession = {
  id: string;
  subject: string | null;
  mode: "free" | "pomodoro";
  durationMinutes: number;
  pomodoroCycles: number;
  /** v0.36 — B3: state/activity tags (顺利/卡住/高效/复习/刷题/新课). */
  tags?: string[];
  startedAt: string;
  endedAt: string | null;
};

export function listMySessions() {
  return callContainer<{ items: CompletedSession[] }>({
    path: "/me/sessions"
  });
}

/* -------------------------------------------------------------------------- */
/*  v0.38 — B2/B4 周复盘 (weekly reflection)                                    */
/* -------------------------------------------------------------------------- */

export type WeeklyReview = {
  id: string;
  weekKey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export function saveWeeklyReview(payload: { weekKey: string; content: string }) {
  return callContainer<{ review: WeeklyReview }>({
    path: "/me/weekly-review",
    method: "POST",
    data: payload
  });
}

export function listWeeklyReviews() {
  return callContainer<{ items: WeeklyReview[] }>({
    path: "/me/weekly-reviews"
  });
}

/* -------------------------------------------------------------------------- */
/*  v0.20 — daily 20:30 reminder (WeChat 一次性订阅消息)                       */
/* -------------------------------------------------------------------------- */

export type ReminderStatus = {
  enabled: boolean;
  credits: number;
  lastSentAt: string | null;
  hasOpenid: boolean;
};

export function getReminderStatus() {
  return callContainer<ReminderStatus>({ path: "/me/reminder/status" });
}

export function reminderSubscribe(accepted: number = 1) {
  return callContainer<{ enabled: boolean; credits: number }>({
    path: "/me/reminder/subscribe",
    method: "POST",
    data: { accepted }
  });
}

export function reminderDisable() {
  return callContainer<{ enabled: boolean; credits: number }>({
    path: "/me/reminder/disable",
    method: "POST"
  });
}

// v0.26 — getNewsList / getNewsDetail removed alongside the v0.22
// 「动态」 tab deletion. Client had 0 importers since v0.22; server
// /api/news + /api/news/:id routes are also gone (this version).

/* -------------------------------------------------------------------------- */
/*  Photo / avatar upload — dual mode (云托管 cloud:// vs VPS COS direct)        */
/* -------------------------------------------------------------------------- */

const ALLOWED_UPLOAD_EXTS = ["jpg", "jpeg", "png", "webp", "heic"];

function safeUploadExt(localPath: string): string {
  const raw = (localPath.split(".").pop() || "").split("?")[0].toLowerCase();
  return ALLOWED_UPLOAD_EXTS.includes(raw) ? raw : "jpg";
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
}

function requestUploadCredentials(kind: "checkin" | "avatar", exts: string[]) {
  return callContainer<{
    credentials: Array<{
      objectKey: string;
      method: string;
      uploadUrl: string;
      publicUrl: string;
      expiresAt: string;
    }>;
  }>({
    path: "/storage/upload-credential",
    method: "POST",
    data: { kind, files: exts.map((ext) => ({ ext })) }
  });
}

function putToCos(uploadUrl: string, data: ArrayBuffer, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: uploadUrl,
      method: "PUT",
      header: { "Content-Type": contentType },
      data,
      success: (res) =>
        res.statusCode >= 200 && res.statusCode < 300
          ? resolve()
          : reject(new Error(`上传失败 HTTP ${res.statusCode}`)),
      fail: (error) => reject(new Error(extractErrMsg(error) || "上传失败"))
    });
  });
}

/**
 * VPS direct upload: ask the server for a presigned PUT (it picks the
 * objectKey), then PUT the file bytes straight to COS. Returns the
 * server-chosen objectKey to submit back via complete / profile.
 */
async function uploadToCos(kind: "checkin" | "avatar", localPath: string): Promise<string> {
  const ext = safeUploadExt(localPath);
  const { credentials } = await requestUploadCredentials(kind, [ext]);
  const cred = credentials?.[0];
  if (!cred) throw new Error("未获取到上传凭证");
  let buffer: ArrayBuffer;
  try {
    buffer = wx.getFileSystemManager().readFileSync(localPath) as ArrayBuffer;
  } catch (error) {
    console.warn("[api] read local file failed", error);
    throw new Error("读取本地图片失败");
  }
  await putToCos(cred.uploadUrl, buffer, contentTypeForExt(ext));
  return cred.objectKey;
}

export async function uploadCheckinPhoto(localPath: string) {
  if (isHttpMode()) {
    const objectKey = await uploadToCos("checkin", localPath);
    // COS photos have no cloud:// fileId; the server keys on objectKey.
    return { fileId: "", objectKey, localPath };
  }
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
  if (isHttpMode()) {
    const objectKey = await uploadToCos("avatar", localPath);
    // `avatarUrl` is what the caller stores; cos:// is signed on read.
    return { fileId: "", objectKey, avatarUrl: `cos://${objectKey}` };
  }
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
    objectKey: cloudPath,
    // In 云托管 mode the avatar is stored as its cloud:// fileId.
    avatarUrl: result.fileID
  };
}

/**
 * Admin dashboard — single-purpose, single-admin endpoints for the
 * project owner. Gated by a Bearer token whose value is read from
 * `process.env.ADMIN_TOKEN` at startup. If ADMIN_TOKEN is unset the
 * whole admin surface returns 503 so a forgotten deploy doesn't
 * accidentally expose user data.
 *
 * The wire format is JSON; the static SPA at /admin/ consumes it with
 * fetch + a token saved in localStorage. No cookies, no sessions.
 */
import { createHmac } from "node:crypto";

import type { Express, NextFunction, Request, Response } from "express";

import { AppError } from "../errors";
import { adminIndexHtml } from "./ui";
import type { DataStore } from "../store/types";
import { detectStorageMode, type StorageClient } from "../storage/default-storage";

const PHOTO_URL_TTL_SECONDS = 600; // 10 minutes

type Clock = { now(): Date };

export function registerAdminRoutes(
  app: Express,
  store: DataStore,
  storage: StorageClient,
  clock: Clock
) {
  const adminToken = (process.env.ADMIN_TOKEN ?? "").trim();

  // Static SPA shell — no auth on the HTML itself; the page is
  // useless without the token because every API call demands it.
  app.get(["/admin", "/admin/", "/admin/index.html"], (_request, response) => {
    response.type("html").send(adminIndexHtml);
  });

  // Photo proxy is auth'd via a per-URL HMAC signature instead of the
  // Bearer header, since <img src=...> tags can't carry custom headers.
  // Mounted BEFORE the bulk Bearer guard so it can run its own auth.
  app.get("/admin/api/photos/proxy", asyncHandler(async (request, response) => {
    if (!adminToken) {
      response.status(503).json({ error: { code: "ADMIN_DISABLED", message: "ADMIN_TOKEN env var is not set" } });
      return;
    }
    const fileId = String(request.query.fileId ?? "");
    const expRaw = Number(request.query.exp ?? 0);
    const sig = String(request.query.sig ?? "");
    if (!fileId || !Number.isFinite(expRaw) || expRaw <= 0 || !sig) {
      response.status(400).end();
      return;
    }
    if (Math.floor(Date.now() / 1000) > expRaw) {
      response.status(410).json({ error: { code: "EXPIRED", message: "Signed URL expired" } });
      return;
    }
    const expected = signPhotoSignature(adminToken, fileId, expRaw);
    if (!timingSafeEquals(sig, expected)) {
      response.status(403).end();
      return;
    }

    // Resolve the temporary URL via the existing storage client and
    // stream the file body back so the admin browser only ever talks
    // to our same-origin server. This sidesteps any CORS / referrer
    // restrictions on the upstream signed URL.
    let resolvedUrl = "";
    let resolutionError: string | null = null;
    try {
      const [item] = await storage.getTemporaryUrls([{ objectKey: fileId, fileId }]);
      resolvedUrl = item?.url ?? "";
    } catch (error) {
      resolutionError = error instanceof Error ? error.message : String(error);
      console.warn("[admin] photo getTemporaryUrls failed", error);
    }
    // The DefaultStorageClient hands back a placeholder URL when no
    // real backend is configured — useful for local dev, fatal for
    // production. Treat it as a resolution failure so the admin sees a
    // diagnostic placeholder instead of a broken image icon.
    const isPlaceholderUrl = resolvedUrl.startsWith("https://temp.example.com");
    if (!resolvedUrl || isPlaceholderUrl) {
      sendPhotoPlaceholder(
        response,
        "图片暂不可用",
        resolutionError ||
          (isPlaceholderUrl
            ? "未配置 WeChat OpenAPI（缺 WECHAT_OPENAPI_INTERNAL=1）"
            : "无法解析 fileId")
      );
      return;
    }

    let upstream: Response | unknown;
    try {
      upstream = await fetch(resolvedUrl);
    } catch (error) {
      console.warn("[admin] photo fetch failed", error);
      sendPhotoPlaceholder(response, "网络错误", error instanceof Error ? error.message : String(error));
      return;
    }
    const fetchRes = upstream as { ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> };
    if (!fetchRes.ok) {
      sendPhotoPlaceholder(response, "上游加载失败", `HTTP ${fetchRes.status}`);
      return;
    }
    const contentType = fetchRes.headers.get("content-type") || "image/jpeg";
    response.setHeader("content-type", contentType);
    // Photos are immutable per cloud:// fileId, so cache aggressively
    // within the signed URL's lifetime. The signature's `exp` already
    // bounds re-use.
    response.setHeader("cache-control", "private, max-age=300");
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    response.send(buffer);
  }));

  app.use("/admin/api", (request, response, next) => {
    if (!adminToken) {
      response.status(503).json({
        error: { code: "ADMIN_DISABLED", message: "ADMIN_TOKEN env var is not set" }
      });
      return;
    }
    const header = request.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!provided || !timingSafeEquals(provided, adminToken)) {
      response.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Invalid or missing admin token" }
      });
      return;
    }
    next();
  });

  app.get("/admin/api/whoami", (_request, response) => {
    response.json({ ok: true, serverTime: clock.now().toISOString() });
  });

  // Storage diagnostic. Reveals which mode the server is running in
  // (wechat-cloudrun / wechat-token / cos / default) and which env
  // vars are present. Only env names — never the values — are
  // returned, so this is safe to call even without the OpenAPI
  // permission set up.
  app.get("/admin/api/diag", asyncHandler(async (_request, response) => {
    const mode = detectStorageMode();
    const envFlags = {
      ADMIN_TOKEN: Boolean(process.env.ADMIN_TOKEN),
      WECHAT_OPENAPI_INTERNAL: process.env.WECHAT_OPENAPI_INTERNAL ?? null,
      WECHAT_CLOUD_ENV: Boolean(process.env.WECHAT_CLOUD_ENV),
      WECHAT_APP_ID: Boolean(process.env.WECHAT_APP_ID),
      WECHAT_APP_SECRET: Boolean(process.env.WECHAT_APP_SECRET),
      COS_SECRET_ID: Boolean(process.env.COS_SECRET_ID),
      COS_SECRET_KEY: Boolean(process.env.COS_SECRET_KEY),
      COS_BUCKET: process.env.COS_BUCKET ?? null,
      COS_REGION: process.env.COS_REGION ?? null
    };

    // Try a real round-trip with a synthetic fileId so we can report
    // whether OpenAPI is actually reachable. Errors are caught and
    // reported as text rather than thrown.
    let probe: { url: string | null; error: string | null } = { url: null, error: null };
    try {
      const [item] = await storage.getTemporaryUrls([
        { objectKey: "diag/probe.jpg", fileId: "cloud://diag/probe.jpg" }
      ]);
      probe = { url: item?.url ?? null, error: null };
    } catch (error) {
      probe = { url: null, error: error instanceof Error ? error.message : String(error) };
    }

    const hint =
      mode === "default"
        ? "Set WECHAT_OPENAPI_INTERNAL=1 and WECHAT_CLOUD_ENV in 云托管 → 服务设置 → 环境变量, then redeploy."
        : probe.error
          ? "Backend is configured but the call failed. Check that the cloud-run service has 微信 OpenAPI 调用权限 enabled."
          : null;

    response.json({
      storageMode: mode,
      envFlags,
      probe,
      hint
    });
  }));

  app.get("/admin/api/stats", asyncHandler(async (_request, response) => {
    const summaries = await store.listAllUsers();
    const totalUsers = summaries.length;
    const totalMinutes = summaries.reduce((acc, item) => acc + item.totalMinutes, 0);
    const totalSessions = summaries.reduce((acc, item) => acc + item.completedSessions, 0);
    const now = clock.now();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const activeWeekly = summaries.filter((item) => {
      const ts = item.user.lastLoginAt ? new Date(item.user.lastLoginAt).getTime() : 0;
      return Number.isFinite(ts) && ts >= sevenDaysAgo;
    }).length;
    const activeWithSessions = summaries.filter((item) => item.completedSessions > 0).length;
    response.json({
      generatedAt: now.toISOString(),
      totalUsers,
      activeWithSessions,
      activeWeekly,
      totalMinutes,
      totalSessions
    });
  }));

  app.get("/admin/api/users", asyncHandler(async (_request, response) => {
    const summaries = await store.listAllUsers();
    response.json({
      users: summaries.map((item) => ({
        id: item.user.id,
        nickname: item.user.nickname || "",
        avatarUrl: item.user.avatarUrl || "",
        openid: item.user.openid,
        clientUid: item.user.clientUid,
        createdAt: item.user.createdAt,
        lastLoginAt: item.user.lastLoginAt,
        profileCompleted: item.user.profileCompleted,
        totalMinutes: item.totalMinutes,
        completedSessions: item.completedSessions,
        currentStreakDays: item.currentStreakDays,
        longestStreakDays: item.longestStreakDays,
        lastSessionAt: item.lastSessionAt
      }))
    });
  }));

  app.get("/admin/api/recent-sessions", asyncHandler(async (request, response) => {
    const limitRaw = Number(request.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const items = await store.listRecentCompletedSessions(limit);
    response.json({
      items: items.map(({ session, user }) => ({
        sessionId: session.id,
        userId: user.id,
        nickname: user.nickname || "",
        avatarUrl: user.avatarUrl || "",
        identityKind: user.openid ? "wechat" : user.clientUid ? "anon" : "unknown",
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMinutes: session.durationMinutes,
        subject: session.subject,
        tags: session.tags,
        summary: session.summary
      }))
    });
  }));

  // CSV export: full users list. Streamable in spirit but we just join
  // in memory since the dataset is small.
  app.get("/admin/api/export/users.csv", asyncHandler(async (_request, response) => {
    const summaries = await store.listAllUsers();
    const header = [
      "user_id",
      "nickname",
      "openid",
      "client_uid",
      "created_at",
      "last_login_at",
      "total_minutes",
      "completed_sessions",
      "current_streak_days",
      "longest_streak_days",
      "last_session_at"
    ];
    const rows = summaries.map((item) => [
      item.user.id,
      item.user.nickname || "",
      item.user.openid || "",
      item.user.clientUid || "",
      item.user.createdAt,
      item.user.lastLoginAt,
      String(item.totalMinutes),
      String(item.completedSessions),
      String(item.currentStreakDays),
      String(item.longestStreakDays),
      item.lastSessionAt || ""
    ]);
    sendCsv(response, "users.csv", header, rows);
  }));

  // CSV export: one user's full session history.
  app.get("/admin/api/export/users/:userId/sessions.csv", asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const user = await store.getUserById(userId);
    if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
    const sessions = await store.listSessions(userId);
    const header = [
      "session_id",
      "status",
      "started_at",
      "ended_at",
      "duration_minutes",
      "subject",
      "tags",
      "summary"
    ];
    const rows = sessions.map((session) => [
      session.id,
      session.status,
      session.startedAt,
      session.endedAt || "",
      String(session.durationMinutes),
      session.subject || "",
      (session.tags || []).join("|"),
      session.summary || ""
    ]);
    sendCsv(response, `user-${userId.slice(0, 8)}-sessions.csv`, header, rows);
  }));

  app.get("/admin/api/users/:userId", asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const user = await store.getUserById(userId);
    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    const dailyStats = await store.getDailyStats(userId);
    const sessions = await store.listSessions(userId);
    const completed = sessions.filter((session) => session.status === "completed");
    const sessionIds = completed.map((session) => session.id);
    const photos = await store.getPhotosBySessionIds(sessionIds);
    // Generate same-origin signed URLs for each photo. The admin browser
    // hits /admin/api/photos/proxy?...sig=... which validates the HMAC,
    // resolves the cloud:// fileId via WeChat OpenAPI server-side, and
    // streams the bytes back. This avoids any CORS / referrer / domain
    // restrictions on the upstream Tencent COS signed URL.
    const photosBySession = new Map<string, Array<{
      objectKey: string;
      fileId: string;
      url: string;
    }>>();
    for (const photo of photos) {
      const list = photosBySession.get(photo.sessionId) ?? [];
      list.push({
        objectKey: photo.objectKey,
        fileId: photo.fileId,
        url: adminToken ? buildSignedPhotoUrl(adminToken, photo.fileId) : ""
      });
      photosBySession.set(photo.sessionId, list);
    }

    const totalMinutes = [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0);
    const longestStreakDays = [...dailyStats.values()].reduce(
      (max, stat) => Math.max(max, stat.streakDays),
      0
    );
    const latestStat = [...dailyStats.values()].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

    // Per-subject and per-tag aggregate breakdown across completed
    // sessions — gives the admin a quick "what is this user actually
    // studying" lens without scrolling the whole timeline.
    const subjectBreakdown = new Map<string, { totalMinutes: number; count: number }>();
    const tagBreakdown = new Map<string, number>();
    for (const session of completed) {
      if (session.subject) {
        const acc = subjectBreakdown.get(session.subject) ?? { totalMinutes: 0, count: 0 };
        acc.totalMinutes += session.durationMinutes;
        acc.count += 1;
        subjectBreakdown.set(session.subject, acc);
      }
      for (const tag of session.tags || []) {
        tagBreakdown.set(tag, (tagBreakdown.get(tag) ?? 0) + 1);
      }
    }
    const subjects = [...subjectBreakdown.entries()]
      .map(([subject, value]) => ({ subject, ...value }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
    const tags = [...tagBreakdown.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    response.json({
      user: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        openid: user.openid,
        clientUid: user.clientUid,
        profileCompleted: user.profileCompleted,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      },
      summary: {
        totalMinutes,
        completedSessions: completed.length,
        currentStreakDays: latestStat?.streakDays ?? 0,
        longestStreakDays
      },
      breakdown: { subjects, tags },
      dailyStats: [...dailyStats.values()].sort((a, b) => a.date.localeCompare(b.date)),
      sessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMinutes: session.durationMinutes,
        summary: session.summary,
        subject: session.subject,
        tags: session.tags,
        pauseSegments: session.pauseSegments,
        photos: photosBySession.get(session.id) ?? []
      }))
    });
  }));
}

function asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Constant-time string compare to avoid leaking the admin token via a
 * timing side-channel from naive `===`.
 */
function timingSafeEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * RFC 4180 CSV cell quoting: wrap in double-quotes whenever the value
 * contains a comma, double-quote, CR or LF; double up any embedded
 * double-quotes. Always emit a UTF-8 BOM so Excel opens Chinese text
 * correctly without the user having to import-with-encoding.
 */
function csvCell(value: string) {
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Builds a same-origin URL whose query carries a short-lived HMAC
 * signature derived from the admin token. The /admin/api/photos/proxy
 * endpoint verifies the signature, then streams the upstream WeChat
 * COS bytes back to the admin browser.
 *
 * This is a "capability URL" — possession of a valid (fileId, exp,
 * sig) triple is enough to fetch that one image, but it expires after
 * PHOTO_URL_TTL_SECONDS. Re-loading the user-detail page mints fresh
 * URLs.
 */
function buildSignedPhotoUrl(adminToken: string, fileId: string) {
  const exp = Math.floor(Date.now() / 1000) + PHOTO_URL_TTL_SECONDS;
  const sig = signPhotoSignature(adminToken, fileId, exp);
  return `/admin/api/photos/proxy?fileId=${encodeURIComponent(fileId)}&exp=${exp}&sig=${sig}`;
}

function signPhotoSignature(adminToken: string, fileId: string, exp: number) {
  return createHmac("sha256", adminToken).update(`${fileId}:${exp}`).digest("hex");
}

/**
 * Renders an inline SVG explaining why a photo couldn't load. Returned
 * with HTTP 200 so the browser still draws it inside the admin's
 * <img> tag — the user gets a tooltip + visible label instead of the
 * default "broken image" glyph, which would be impossible to debug.
 */
function sendPhotoPlaceholder(response: Response, title: string, detail: string) {
  const safeTitle = escapeXml(truncate(title, 28));
  const safeDetail = escapeXml(truncate(detail, 60));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
  <rect width="200" height="200" rx="14" fill="#f3efe6" />
  <g transform="translate(100,72)" fill="none" stroke="#c8b58a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <rect x="-26" y="-22" width="52" height="44" rx="6" />
    <circle cx="-12" cy="-6" r="4" />
    <path d="M-22 18 L-6 0 L8 12 L18 2 L26 22" />
    <line x1="-30" y1="-26" x2="30" y2="30" stroke="#b8423a" />
  </g>
  <text x="100" y="130" text-anchor="middle" font-family="-apple-system, PingFang SC, sans-serif" font-size="14" font-weight="600" fill="#7a5a2b">${safeTitle}</text>
  <text x="100" y="152" text-anchor="middle" font-family="-apple-system, PingFang SC, sans-serif" font-size="11" fill="#a08c66">${safeDetail}</text>
</svg>`;
  response.setHeader("content-type", "image/svg+xml; charset=utf-8");
  response.setHeader("cache-control", "private, max-age=30");
  response.status(200).send(svg);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number) {
  if (!value) return "";
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function sendCsv(response: Response, filename: string, header: string[], rows: string[][]) {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  response.setHeader("content-type", "text/csv; charset=utf-8");
  response.setHeader(
    "content-disposition",
    `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`
  );
  response.send(body);
}

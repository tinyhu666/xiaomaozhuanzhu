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
import type { Express, NextFunction, Request, Response } from "express";

import { AppError } from "../errors";
import { adminIndexHtml } from "./ui";
import type { DataStore } from "../store/types";
import type { StorageClient } from "../storage/default-storage";

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
    const photoUrls = await storage
      .getTemporaryUrls(photos.map((photo) => ({ objectKey: photo.objectKey, fileId: photo.fileId })))
      .catch(() => []);
    const urlByKey = new Map(photoUrls.map((item) => [item.objectKey, item.url]));

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
        url: urlByKey.get(photo.objectKey) ?? ""
      });
      photosBySession.set(photo.sessionId, list);
    }

    const totalMinutes = [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0);
    const longestStreakDays = [...dailyStats.values()].reduce(
      (max, stat) => Math.max(max, stat.streakDays),
      0
    );
    const latestStat = [...dailyStats.values()].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

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

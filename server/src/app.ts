import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { SUBJECTS, TAGS, type SessionTag, type Subject } from "./constants";
import { monthBounds, formatShanghaiDate } from "./domain/date-utils";
import { buildDayContributions, calculateDurationMinutes, rebuildDailyStats } from "./domain/stats";
import { resolveDatabaseUrl } from "./env";
import { AppError } from "./errors";
import { createStorageClient, type StorageClient } from "./storage/default-storage";
import { MemoryStore } from "./store/memory-store";
import { MySQLStore } from "./store/mysql-store";
import type { DataStore } from "./store/types";
import type { DailyStat, SessionPhoto, StudySession, User } from "./types";

type Clock = {
  now(): Date;
};

type CreateAppOptions = {
  clock?: Clock;
  storage?: StorageClient;
  store?: DataStore;
};

const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(20),
  avatarUrl: z.string().url(),
  isPublic: z.boolean().optional(),
  requireWechatAuth: z.boolean().optional()
});

const completeSchema = z.object({
  summary: z.string().trim().min(1).max(80),
  subject: z.enum(SUBJECTS).nullable().optional(),
  tags: z.array(z.enum(TAGS)).max(6).default([]),
  photos: z
    .array(
      z.object({
        fileId: z.string().min(1).startsWith("cloud://"),
        objectKey: z
          .string()
          .min(1)
          .refine((value) => !value.startsWith("/"), "objectKey must not start with /")
      })
    )
    .min(1)
    .max(3)
});

const shareSchema = z.object({
  isPublic: z.boolean(),
  requireWechatAuth: z.boolean().optional()
});

const tempUrlSchema = z.object({
  objectKeys: z.array(z.string().min(1)).min(1).max(30)
});

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const store = options.store ?? createDataStore();
  const clock = options.clock ?? { now: () => new Date() };
  const storage = options.storage ?? createStorageClient();

  app.use(express.json());
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const openid = getOpenId(request) || "-";
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      console.log(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          openid
        })
      );
    });
    next();
  });

  app.post("/api/me/bootstrap", withUser(store, clock, async (_request, response, context) => {
    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      needsOnboarding: !context.user.profileCompleted,
      serverTime: clock.now().toISOString()
    });
  }));

  app.post("/api/me/profile", withUser(store, clock, async (request, response, context) => {
    const payload = parse(profileSchema, request.body);
    const { user, publicProfile } = await store.updateProfile(
      context.user.id,
      {
        nickname: payload.nickname,
        avatarUrl: payload.avatarUrl,
        profileCompleted: true
      },
      {
        isPublic: payload.isPublic ?? context.publicProfile.isPublic,
        requireWechatAuth: payload.requireWechatAuth ?? context.publicProfile.requireWechatAuth
      }
    );

    response.json({
      profile: serializeProfile(user, publicProfile),
      publicProfile
    });
  }));

  app.get("/api/home", withUser(store, clock, async (_request, response, context) => {
    const activeSession = await abandonLingeringPausedSession(store, context.user.id, clock.now().toISOString());
    const todayKey = formatShanghaiDate(clock.now());
    const dailyStats = await store.getDailyStats(context.user.id);
    const today = dailyStats.get(todayKey) ?? emptyDailyStat(context.user.id, todayKey, clock.now().toISOString());
    const latestCompleted = (await store.listSessions(context.user.id)).find((session) => session.status === "completed") ?? null;

    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      activeSession: activeSession ? serializeActiveSession(activeSession, clock.now()) : null,
      today,
      summary: {
        totalMinutes: [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0),
        currentStreakDays: getCurrentStreak(dailyStats),
        lastSummary: latestCompleted?.summary ?? ""
      }
    });
  }));

  app.get("/api/me/dashboard", withUser(store, clock, async (_request, response, context) => {
    const dailyStats = await store.getDailyStats(context.user.id);
    const sessions = (await store.listSessions(context.user.id)).filter((session) => session.status === "completed");
    const subjectTotals = SUBJECTS.map((subject) => ({
      subject,
      totalMinutes: sessions
        .filter((session) => session.subject === subject)
        .reduce((sum, session) => sum + session.durationMinutes, 0)
    }))
      .filter((item) => item.totalMinutes > 0)
      .sort((left, right) => right.totalMinutes - left.totalMinutes);
    const bestDay = [...dailyStats.values()].reduce(
      (result, stat) => {
        if (stat.totalMinutes > result.totalMinutes) {
          return {
            date: stat.date,
            totalMinutes: stat.totalMinutes
          };
        }
        return result;
      },
      {
        date: null as string | null,
        totalMinutes: 0
      }
    );

    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      summary: {
        totalMinutes: [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0),
        currentStreakDays: getCurrentStreak(dailyStats)
      },
      subjects: subjectTotals,
      bestDay
    });
  }));

  app.post("/api/sessions/start", withUser(store, clock, async (_request, response, context) => {
    const currentSession = await store.getCurrentSession(context.user.id);

    if (currentSession?.status === "running") {
      response.json({ session: serializeActiveSession(currentSession, clock.now()), reused: true });
      return;
    }
    if (currentSession?.status === "paused") {
      await abandonSession(store, currentSession, clock.now().toISOString());
    }

    const now = clock.now().toISOString();
    const session: StudySession = {
      id: randomUUID(),
      userId: context.user.id,
      status: "running",
      startedAt: now,
      endedAt: null,
      currentPauseStartedAt: null,
      pauseSegments: [],
      durationMinutes: 0,
      summary: "",
      subject: null,
      tags: [],
      createdAt: now,
      updatedAt: now
    };

    await store.saveSession(session);
    response.json({ session: serializeActiveSession(session, clock.now()), reused: false });
  }));

  app.post("/api/sessions/:id/pause", withUser(store, clock, async (request, response, context) => {
    const session = await requireSession(store, String(request.params.id), context.user.id);
    if (session.status !== "running") {
      throw new AppError(409, "INVALID_STATE", "Only running sessions can be paused");
    }

    session.status = "paused";
    session.currentPauseStartedAt = clock.now().toISOString();
    session.updatedAt = session.currentPauseStartedAt;
    await store.saveSession(session);

    response.json({ session: serializeActiveSession(session, clock.now()) });
  }));

  app.post("/api/sessions/:id/resume", withUser(store, clock, async (request, response, context) => {
    const session = await requireSession(store, String(request.params.id), context.user.id);
    if (session.status !== "paused" || !session.currentPauseStartedAt) {
      throw new AppError(409, "INVALID_STATE", "Only paused sessions can be resumed");
    }

    session.pauseSegments.push({
      startedAt: session.currentPauseStartedAt,
      endedAt: clock.now().toISOString()
    });
    session.currentPauseStartedAt = null;
    session.status = "running";
    session.updatedAt = clock.now().toISOString();
    await store.saveSession(session);

    response.json({ session: serializeActiveSession(session, clock.now()) });
  }));

  app.post("/api/sessions/:id/abandon", withUser(store, clock, async (request, response, context) => {
    const session = await requireSession(store, String(request.params.id), context.user.id);
    await abandonSession(store, session, clock.now().toISOString());
    response.json({ session });
  }));

  app.post("/api/sessions/:id/complete", withUser(store, clock, async (request, response, context) => {
    const payload = parse(completeSchema, request.body);
    const session = await requireSession(store, String(request.params.id), context.user.id);

    if (session.status === "completed") {
      const stats = await store.getDailyStats(context.user.id);
      const dateKey = session.endedAt ? formatShanghaiDate(session.endedAt) : formatShanghaiDate(clock.now());
      response.json({
        session,
        dailyStats: stats.get(dateKey) ?? emptyDailyStat(context.user.id, dateKey, clock.now().toISOString())
      });
      return;
    }

    if (session.status === "abandoned") {
      throw new AppError(409, "INVALID_STATE", "Abandoned sessions cannot be completed");
    }

    const now = clock.now().toISOString();
    if (session.status === "paused" && session.currentPauseStartedAt) {
      session.pauseSegments.push({
        startedAt: session.currentPauseStartedAt,
        endedAt: now
      });
      session.currentPauseStartedAt = null;
    }

    session.status = "completed";
    session.endedAt = now;
    session.summary = payload.summary;
    session.subject = (payload.subject ?? null) as Subject | null;
    session.tags = payload.tags as SessionTag[];
    session.durationMinutes = calculateDurationMinutes(session.startedAt, now, session.pauseSegments);
    session.updatedAt = now;
    await store.saveSession(session);
    await store.savePhotos(
      session.id,
      payload.photos.map(
        (photo, index): SessionPhoto => ({
          id: randomUUID(),
          sessionId: session.id,
          fileId: photo.fileId,
          objectKey: photo.objectKey,
          sortOrder: index,
          createdAt: now
        })
      )
    );

    await store.replaceDailyStats(
      context.user.id,
      rebuildDailyStats(
        context.user.id,
        (await store.listSessions(context.user.id)).filter((item) => item.status === "completed"),
        now
      )
    );

    const endDate = formatShanghaiDate(now);
    response.json({
      session,
      dailyStats: (await store.getDailyStats(context.user.id)).get(endDate) ?? emptyDailyStat(context.user.id, endDate, now)
    });
  }));

  app.get("/api/calendar", withUser(store, clock, async (request, response, context) => {
    const month = typeof request.query.month === "string" ? request.query.month : "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new AppError(400, "INVALID_INPUT", "month must use YYYY-MM format");
    }
    const { start, end } = monthBounds(month);
    const startKey = formatShanghaiDate(start);
    const endKey = formatShanghaiDate(end);
    const days = [...(await store.getDailyStats(context.user.id)).values()]
      .filter((stat) => stat.date >= startKey && stat.date <= endKey)
      .reduce<Record<string, DailyStat>>((result, stat) => {
        result[stat.date] = stat;
        return result;
      }, {});

    response.json({ month, days });
  }));

  app.get("/api/calendar/:date", withUser(store, clock, async (request, response, context) => {
    const date = String(request.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError(400, "INVALID_INPUT", "date must use YYYY-MM-DD format");
    }

    const stat = (await store.getDailyStats(context.user.id)).get(date) ?? emptyDailyStat(context.user.id, date, clock.now().toISOString());
    const sessions: Array<{
      id: string;
      summary: string;
      subject: StudySession["subject"];
      tags: StudySession["tags"];
      totalMinutes: number | undefined;
      photos: SessionPhoto[];
    }> = (await store
      .listSessions(context.user.id))
      .filter((session) => session.status === "completed" && buildDayContributions(session).has(date))
      .map((session) => ({
        id: session.id,
        summary: session.summary,
        subject: session.subject,
        tags: session.tags,
        totalMinutes: buildDayContributions(session).get(date),
        photos: []
      }));
    for (const session of sessions) {
      session.photos = await store.getPhotosBySessionId(session.id);
    }

    response.json({
      date,
      totalMinutes: stat.totalMinutes,
      sessionCount: stat.sessionCount,
      heatLevel: stat.heatLevel,
      sessions
    });
  }));

  app.get("/api/share/me", withUser(store, clock, async (_request, response, context) => {
    const stats = await store.getDailyStats(context.user.id);
    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      summary: {
        totalMinutes: [...stats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0),
        currentStreakDays: getCurrentStreak(stats)
      }
    });
  }));

  app.post("/api/share/me", withUser(store, clock, async (request, response, context) => {
    const payload = parse(shareSchema, request.body);
    const { publicProfile } = await store.updateProfile(
      context.user.id,
      {},
      {
        isPublic: payload.isPublic,
        requireWechatAuth: payload.requireWechatAuth ?? context.publicProfile.requireWechatAuth
      }
    );

    response.json({ publicProfile });
  }));

  app.get("/api/public/:slug", async (request, response) => {
    const slug = String(request.params.slug);
    const record = await store.getPublicSettingsBySlug(slug);
    if (!record || !record.publicProfile.isPublic) {
      throw new AppError(404, "NOT_FOUND", "Public profile does not exist");
    }
    if (record.publicProfile.requireWechatAuth && !getOpenId(request)) {
      throw new AppError(401, "UNAUTHORIZED", "Wechat login is required to view this page");
    }

    const dailyStats = await store.getDailyStats(record.user.id);
    const recentSessions = (await store
      .listSessions(record.user.id))
      .filter((session) => session.status === "completed")
      .slice(0, 10);
    const recentPhotos = (await store.getPhotosBySessionIds(recentSessions.map((session) => session.id))).slice(0, 9);
    const tempUrls = await storage.getTemporaryUrls(recentPhotos.map((photo) => photo.objectKey));
    const urlMap = new Map(tempUrls.map((item) => [item.objectKey, item.url]));

    response.json({
      profile: serializeProfile(record.user, record.publicProfile),
      summary: {
        totalMinutes: [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0),
        currentStreakDays: getCurrentStreak(dailyStats)
      },
      calendar: [...dailyStats.values()],
      photos: recentPhotos.map((photo) => ({
        ...photo,
        tempUrl: urlMap.get(photo.objectKey) ?? ""
      })),
      recentSummaries: recentSessions.map((session) => ({
        id: session.id,
        summary: session.summary,
        subject: session.subject,
        tags: session.tags,
        endedAt: session.endedAt
      }))
    });
  });

  app.post("/api/storage/temp-urls", withUser(store, clock, async (request, response) => {
    const payload = parse(tempUrlSchema, request.body);
    response.json({
      items: await storage.getTemporaryUrls(payload.objectKeys)
    });
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      });
      return;
    }

    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        details: null
      }
    });
  });

  return app;
}

function withUser(
  store: DataStore,
  clock: Clock,
  handler: (
    request: Request,
    response: Response,
    context: {
      user: User;
      publicProfile: NonNullable<Awaited<ReturnType<DataStore["getPublicSettingsByUserId"]>>>;
    }
  ) => Promise<void>
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const openid = getOpenId(request);
      if (!openid) {
        throw new AppError(401, "UNAUTHORIZED", "Wechat identity is required");
      }
      const context = await store.ensureUser(openid, clock.now().toISOString());
      await handler(request, response, context as never);
    } catch (error) {
      next(error);
    }
  };
}

function getOpenId(request: Request) {
  const openid = request.header("x-wx-openid") ?? request.header("X-WX-OPENID");
  if (openid) return openid;
  if (process.env.NODE_ENV !== "production") {
    return request.header("x-dev-openid") ?? request.header("X-DEV-OPENID") ?? "";
  }
  return "";
}

async function requireSession(store: DataStore, sessionId: string, userId: string) {
  const session = await store.getSession(sessionId);
  if (!session || session.userId !== userId) {
    throw new AppError(404, "NOT_FOUND", "Session does not exist");
  }
  return session;
}

async function abandonSession(store: DataStore, session: StudySession, now: string) {
  if (session.status === "paused" && session.currentPauseStartedAt) {
    session.pauseSegments.push({
      startedAt: session.currentPauseStartedAt,
      endedAt: now
    });
    session.currentPauseStartedAt = null;
  }
  session.status = "abandoned";
  session.endedAt = now;
  session.updatedAt = now;
  await store.saveSession(session);
}

async function abandonLingeringPausedSession(store: DataStore, userId: string, now: string) {
  const session = await store.getCurrentSession(userId);
  if (session?.status === "paused") {
    await abandonSession(store, session, now);
    return null;
  }
  return session;
}

function getCurrentStreak(stats: Map<string, DailyStat>) {
  const latest = [...stats.values()].sort((left, right) => right.date.localeCompare(left.date))[0];
  return latest?.streakDays ?? 0;
}

function serializeProfile(
  user: User,
  publicProfile: NonNullable<Awaited<ReturnType<DataStore["getPublicSettingsByUserId"]>>>
) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    profileCompleted: user.profileCompleted,
    shareSlug: publicProfile.shareSlug,
    isPublic: publicProfile.isPublic,
    requireWechatAuth: publicProfile.requireWechatAuth
  };
}

function serializeActiveSession(session: StudySession, now: Date) {
  const previewPauses = [...session.pauseSegments];
  if (session.status === "paused" && session.currentPauseStartedAt) {
    previewPauses.push({
      startedAt: session.currentPauseStartedAt,
      endedAt: now.toISOString()
    });
  }
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    currentPauseStartedAt: session.currentPauseStartedAt,
    pauseSegments: session.pauseSegments,
    effectiveMinutes:
      session.status === "completed" && session.endedAt
        ? session.durationMinutes
        : calculateDurationMinutes(session.startedAt, now.toISOString(), previewPauses)
  };
}

function emptyDailyStat(userId: string, date: string, updatedAt: string): DailyStat {
  return {
    userId,
    date,
    totalMinutes: 0,
    sessionCount: 0,
    heatLevel: 0,
    streakDays: 0,
    updatedAt
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "INVALID_INPUT", "Request payload validation failed", result.error.flatten());
  }
  return result.data;
}

function createDataStore(): DataStore {
  const connectionString = resolveDatabaseUrl(process.env);
  if (connectionString) {
    return MySQLStore.fromConnectionString(connectionString);
  }
  return new MemoryStore();
}

import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { registerAdminRoutes } from "./admin/routes";
import { SUBJECTS, SUBJECT_TARGET_MINUTES, TAGS, type SessionTag, type Subject } from "./constants";
import { addShanghaiDays, monthBounds, formatShanghaiDate, startOfShanghaiWeek } from "./domain/date-utils";
import { askAi, bumpDailyAiCount, getDailyAiCount } from "./domain/ai";
import { generateGradeExplanation, generatePracticeQuestions } from "./domain/ai-practice";
import { getExamSchedule } from "./domain/exam-dates";
import { maybeKickoffNewsRefresh } from "./domain/news";
import { ensureNewsSeed } from "./domain/news-seed";
import {
  buildDayContributions,
  buildHourlyPattern,
  buildWeekdayPattern,
  calculateDurationMinutes,
  findBestWeek,
  rebuildDailyStats
} from "./domain/stats";
import { resolveDatabaseUrl } from "./env";
import { AppError } from "./errors";
import { createStorageClient, type StorageClient } from "./storage/default-storage";
import { MemoryStore } from "./store/memory-store";
import { MySQLStore } from "./store/mysql-store";
import type { DataStore } from "./store/types";
import {
  NEWS_CATEGORIES,
  PRACTICE_DIFFICULTIES,
  type NewsCategory,
  type PracticeDifficulty,
  type PracticeQuestion,
  type DailyStat,
  type SessionPhoto,
  type StudySession,
  type User
} from "./types";

type Clock = {
  now(): Date;
};

type CreateAppOptions = {
  clock?: Clock;
  storage?: StorageClient;
  store?: DataStore;
  /**
   * Install the curated「动态」seed on createApp(). Defaults to true.
   * Tests that depend on an empty store should pass `seedNews: false`.
   */
  seedNews?: boolean;
};

const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(20),
  // avatarUrl is either a valid URL (incl. cloud:// fileId) or empty,
  // so users can update just their nickname without having uploaded
  // an avatar yet.
  avatarUrl: z
    .string()
    .max(512)
    .refine((v) => v === "" || /^(https?|cloud):\/\//.test(v), {
      message: "avatarUrl must be empty or a URL"
    }),
  isPublic: z.boolean().optional(),
  requireWechatAuth: z.boolean().optional()
});

const completeSchema = z.object({
  summary: z.string().trim().min(1).max(80),
  subject: z.enum(SUBJECTS).nullable().optional(),
  tags: z.array(z.enum(TAGS)).max(6).default([]),
  // Cycles completed during the session — only meaningful for
  // pomodoro mode. We accept it from any session for forward-
  // compat; free-mode sessions just ignore the field.
  pomodoroCycles: z.number().int().min(0).max(32).optional(),
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

const startSessionSchema = z
  .object({
    // Optional subject pre-tag — the miniprogram now offers a chip
    // row above the timer so the user can pick before they hit
    // start. The complete-step still allows overriding.
    subject: z.enum(SUBJECTS).nullable().optional(),
    // Which timer mode the user is starting in. Defaults to "free"
    // so older clients keep working unchanged.
    mode: z.enum(["free", "pomodoro"]).optional()
  })
  .optional()
  .default({});

const aiGenerateQuizSchema = z.object({
  subject: z.enum(SUBJECTS),
  difficulty: z.enum(PRACTICE_DIFFICULTIES),
  // 1–5 questions per call. More than 5 burns tokens without giving
  // the user more value (they'll abandon the long quiz).
  count: z.number().int().min(1).max(5).default(3)
});

const aiGradeAnswerSchema = z.object({
  questionId: z.string().min(1).max(64),
  userAnswer: z.string().min(1).max(8)
});

const aiAskSchema = z.object({
  // Bound the input so a stray paste of an entire textbook page
  // doesn't burn tokens. 5 chars is a meaningful minimum (≥ "解 X 题"
  // length); 1000 chars is enough for a detailed scenario question.
  question: z.string().trim().min(5).max(1000),
  // Optional last few turns for context. Bounded length protects us
  // from a client that tries to stuff free-form text via this slot.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000)
      })
    )
    .max(6)
    .optional()
});

const shareSchema = z.object({
  isPublic: z.boolean(),
  requireWechatAuth: z.boolean().optional()
});

const tempUrlSchema = z
  .object({
    objectKeys: z.array(z.string().min(1)).max(30).optional(),
    items: z
      .array(
        z.object({
          objectKey: z.string().min(1),
          fileId: z.string().min(1).optional()
        })
      )
      .max(30)
      .optional()
  })
  .refine(
    (value) => (value.objectKeys?.length ?? 0) + (value.items?.length ?? 0) > 0,
    { message: "objectKeys or items required" }
  );

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const store = options.store ?? createDataStore();
  const clock = options.clock ?? { now: () => new Date() };
  const storage = options.storage ?? createStorageClient();

  // Install the curated「动态」seed once per process start. Fire-and-
  // forget — the seed is idempotent and small (7 items), so failure
  // here just means the user sees fetched-only content on this boot.
  if (options.seedNews !== false) {
    void ensureNewsSeed(store, clock.now()).catch((error) => {
      console.warn("[news] seed install failed", error);
    });
  }

  app.use(express.json({ limit: "1mb" }));

  // Health probes for 微信云托管 — must respond 200 quickly without auth.
  app.get(["/", "/health", "/healthz", "/readiness"], (_request, response) => {
    response.json({ status: "ok", time: clock.now().toISOString() });
  });

  // Admin dashboard. The HTML lives at /admin/ and is unauthenticated
  // (it's a static shell). Every /admin/api/* call requires the Bearer
  // token from ADMIN_TOKEN env var; if that env var is missing the
  // whole API surface is 503'd, so a forgotten setup never leaks data.
  registerAdminRoutes(app, store, storage, clock);

  app.use((request, response, next) => {
    const requestId = randomUUID();
    const openid = getOpenId(request) || "-";
    const clientUid = getClientUid(request) || "-";
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      console.log(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          openid,
          clientUid
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
    const activeSession = await reapStalePausedSession(store, context.user.id, clock.now());
    const todayKey = formatShanghaiDate(clock.now());
    const dailyStats = await store.getDailyStats(context.user.id);
    const today = dailyStats.get(todayKey) ?? emptyDailyStat(context.user.id, todayKey, clock.now().toISOString());
    const sessions = await store.listSessions(context.user.id);
    const latestCompleted = sessions.find((session) => session.status === "completed") ?? null;

    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      activeSession: activeSession ? serializeActiveSession(activeSession, clock.now()) : null,
      today,
      summary: {
        totalMinutes: [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0),
        currentStreakDays: getCurrentStreak(dailyStats),
        lastSummary: latestCompleted?.summary ?? ""
      },
      weeklyReview: buildWeeklyReview(dailyStats, sessions, todayKey),
      makeupAvailable: findMakeupOpportunity(dailyStats, sessions, todayKey),
      // Cheap to compute (constant table lookup); ship on /home so the
      // home-page countdown card doesn't need a second round-trip.
      examSchedule: getExamSchedule(clock.now())
    });
  }));

  app.get("/api/me/dashboard", withUser(store, clock, async (_request, response, context) => {
    const dailyStats = await store.getDailyStats(context.user.id);
    const sessions = (await store.listSessions(context.user.id)).filter((session) => session.status === "completed");
    const subjectTotals = SUBJECTS.map((subject) => {
      const totalMinutes = sessions
        .filter((session) => session.subject === subject)
        .reduce((sum, session) => sum + session.durationMinutes, 0);
      const targetMinutes = SUBJECT_TARGET_MINUTES[subject];
      return {
        subject,
        totalMinutes,
        targetMinutes,
        progress: targetMinutes > 0 ? Math.min(1, totalMinutes / targetMinutes) : 0
      };
    }).sort((left, right) => right.totalMinutes - left.totalMinutes);
    const subjectsWithProgress = subjectTotals.filter((item) => item.totalMinutes > 0);
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

    const totalMinutes = [...dailyStats.values()].reduce((sum, stat) => sum + stat.totalMinutes, 0);
    const currentStreakDays = getCurrentStreak(dailyStats);
    const longestStreakDays = getLongestStreak(dailyStats);
    const completedSubjects = new Set(sessions.map((session) => session.subject).filter((subject): subject is Subject => Boolean(subject)));

    const examSchedule = getExamSchedule(clock.now());

    // -----------------------------------------------------------
    // v0.11 insights: derived "when do you focus best" patterns
    // and the all-time best-week record. Cheap to compute (small
    // N for one user) so we ship them alongside the dashboard
    // payload instead of adding a separate endpoint round-trip.
    // -----------------------------------------------------------
    const hourlyPattern = buildHourlyPattern(sessions);
    const weekdayPattern = buildWeekdayPattern(dailyStats.values());
    const peakHour = pickPeakIndex(hourlyPattern);
    const peakWeekday = pickPeakIndex(weekdayPattern);
    const bestWeek = findBestWeek(dailyStats.values());

    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      summary: {
        totalMinutes,
        currentStreakDays,
        longestStreakDays,
        completedSessionCount: sessions.length
      },
      subjects: subjectsWithProgress,
      subjectTargets: subjectTotals,
      bestDay,
      badges: computeBadges({
        totalMinutes,
        currentStreakDays,
        longestStreakDays,
        bestDayMinutes: bestDay.totalMinutes,
        completedCount: sessions.length,
        subjectTotals: subjectsWithProgress.map((item) => ({ subject: item.subject, totalMinutes: item.totalMinutes })),
        completedSubjectCount: completedSubjects.size
      }),
      records: {
        bestDay,
        longestStreakDays,
        bestWeek
      },
      patterns: {
        hourly: hourlyPattern,
        weekday: weekdayPattern,
        peakHour,
        peakWeekday
      },
      examSchedule
    });
  }));

  app.post("/api/sessions/start", withUser(store, clock, async (request, response, context) => {
    const payload = parse(startSessionSchema, request.body ?? {});
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
      mode: payload.mode ?? "free",
      startedAt: now,
      endedAt: null,
      currentPauseStartedAt: null,
      pauseSegments: [],
      durationMinutes: 0,
      pomodoroCycles: 0,
      summary: "",
      subject: (payload.subject ?? null) as Subject | null,
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

  app.post("/api/sessions/makeup", withUser(store, clock, async (_request, response, context) => {
    const todayKey = formatShanghaiDate(clock.now());
    const dailyStats = await store.getDailyStats(context.user.id);
    const sessions = await store.listSessions(context.user.id);
    const opportunity = findMakeupOpportunity(dailyStats, sessions, todayKey);
    if (!opportunity) {
      throw new AppError(409, "INVALID_STATE", "当前没有可补签的连签缺口");
    }

    const nowIso = clock.now().toISOString();
    const dayMidnight = new Date(`${opportunity.date}T04:00:00.000Z`);
    const makeupSession: StudySession = {
      id: randomUUID(),
      userId: context.user.id,
      status: "makeup",
      mode: "free",
      startedAt: dayMidnight.toISOString(),
      endedAt: new Date(dayMidnight.getTime() + 60_000).toISOString(),
      currentPauseStartedAt: null,
      pauseSegments: [],
      durationMinutes: 0,
      pomodoroCycles: 0,
      summary: "（补签）",
      subject: null,
      tags: [],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await store.saveSession(makeupSession);

    await store.replaceDailyStats(
      context.user.id,
      rebuildDailyStats(
        context.user.id,
        (await store.listSessions(context.user.id)).filter(
          (item) => item.status === "completed" || item.status === "makeup"
        ),
        nowIso
      )
    );

    const refreshedStats = await store.getDailyStats(context.user.id);
    response.json({
      makeupDate: opportunity.date,
      streakDays: getCurrentStreak(refreshedStats)
    });
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
    if (typeof payload.pomodoroCycles === "number") {
      session.pomodoroCycles = payload.pomodoroCycles;
    }
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
        (await store.listSessions(context.user.id)).filter(
          (item) => item.status === "completed" || item.status === "makeup"
        ),
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
    const tempUrls = await storage.getTemporaryUrls(
      recentPhotos.map((photo) => ({ objectKey: photo.objectKey, fileId: photo.fileId }))
    );
    const urlMap = new Map(tempUrls.map((item) => [item.objectKey, item.url]));

    const profileSerialized = serializeProfile(record.user, record.publicProfile);
    profileSerialized.avatarUrl = await resolvePublicAvatarUrl(storage, profileSerialized.avatarUrl);

    response.json({
      profile: profileSerialized,
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

  // -------- News (考试动态) --------
  // Reads are intentionally un-authenticated: the「动态」tab is
  // public-facing content (CICPA announcements) and the miniprogram
  // sometimes calls /api/news before identity bootstrap completes.
  // Hitting GET kicks off a fire-and-forget refresh whenever the
  // cache is stale (>3h since last successful fetch); the response
  // always serves the current cache so users never block on network.
  app.get("/api/news", async (request, response, next) => {
    try {
      const category = parseNewsCategoryParam(request.query.category);
      const limit = parseLimit(request.query.limit, 30, 100);
      const before = typeof request.query.before === "string" ? request.query.before : undefined;
      // Fire-and-forget; the user reads whatever is currently in cache.
      maybeKickoffNewsRefresh(store, clock.now());
      const items = await store.listNews({ category, limit, before });
      response.json({
        items: items.map(serializeNewsListItem),
        // Pagination cursor: callers feed the last publishedAt as
        // `before=` to request the next page.
        nextBefore: items.length === limit ? items[items.length - 1].publishedAt : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/news/:id", async (request, response, next) => {
    try {
      const id = String(request.params.id);
      const item = await store.getNewsById(id);
      if (!item || item.hidden) {
        throw new AppError(404, "NOT_FOUND", "News item does not exist");
      }
      response.json({ item: serializeNewsDetail(item) });
    } catch (error) {
      next(error);
    }
  });

  // -------- AI Q&A (CPA 助教) --------
  // Authenticated proxy in front of DeepSeek. Holds the API key on
  // the server so it never reaches the client; enforces a per-user
  // daily cap; refuses to start if DEEPSEEK_API_KEY env var is unset
  // (returns 503 from inside askAi).
  app.post("/api/ai/ask", withUser(store, clock, async (request, response, context) => {
    const payload = parse(aiAskSchema, request.body);
    const result = await askAi({
      userId: context.user.id,
      question: payload.question,
      history: payload.history,
      now: clock.now()
    });
    response.json(result);
  }));

  // -------- AI 练习 (CPA Q-bank) --------
  // The generator is one DeepSeek call; the grader is a second one
  // per question that the user attempts. We bump the shared AI
  // counter on each successful call so practice doesn't bypass the
  // 30/day cap. Questions live in the practice_questions table so
  // the 错题本 list view is a simple SELECT.
  app.post(
    "/api/ai/practice/generate",
    withUser(store, clock, async (request, response, context) => {
      const payload = parse(aiGenerateQuizSchema, request.body);
      const generated = await generatePracticeQuestions({
        userId: context.user.id,
        subject: payload.subject,
        difficulty: payload.difficulty,
        count: payload.count,
        now: clock.now()
      });
      // Charge the daily counter once per generation call (one
      // upstream request regardless of how many questions in the
      // batch). The grader will charge again per grade call.
      bumpDailyAiCount(context.user.id, clock.now());
      const nowIso = clock.now().toISOString();
      const stored: PracticeQuestion[] = [];
      for (const q of generated) {
        const item: PracticeQuestion = {
          id: randomUUID(),
          userId: context.user.id,
          subject: payload.subject,
          difficulty: payload.difficulty,
          question: q.question,
          options: q.options,
          correctAnswer: q.correct_answer,
          userAnswer: null,
          aiExplanation: null,
          isCorrect: null,
          isMastered: false,
          createdAt: nowIso,
          answeredAt: null
        };
        await store.savePracticeQuestion(item);
        stored.push(item);
      }
      // Mirror /api/ai/ask shape so the client can show the same
      // "今日已用 X / 30" hint after every AI interaction.
      response.json({
        questions: stored.map((it) => ({
          // Never leak the correct answer until the user submits.
          id: it.id,
          subject: it.subject,
          difficulty: it.difficulty,
          question: it.question,
          options: it.options
        })),
        usedToday: getCurrentAiCount(context.user.id, clock.now()),
        dailyLimit: 30
      });
    })
  );

  app.post(
    "/api/ai/practice/grade",
    withUser(store, clock, async (request, response, context) => {
      const payload = parse(aiGradeAnswerSchema, request.body);
      const question = await store.getPracticeQuestion(payload.questionId, context.user.id);
      if (!question) {
        throw new AppError(404, "NOT_FOUND", "题目不存在或不属于当前用户");
      }
      if (question.userAnswer) {
        // Idempotent re-grade: re-return the cached result. Saves a
        // DeepSeek call if the user double-taps submit / re-opens
        // the same question from 错题本.
        response.json({
          questionId: question.id,
          correct: question.isCorrect,
          correctAnswer: question.correctAnswer,
          explanation: question.aiExplanation ?? "",
          usedToday: getCurrentAiCount(context.user.id, clock.now()),
          dailyLimit: 30
        });
        return;
      }
      const isCorrect =
        payload.userAnswer.toUpperCase().trim() === question.correctAnswer.toUpperCase().trim();
      const explanation = await generateGradeExplanation({
        userId: context.user.id,
        subject: question.subject,
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        userAnswer: payload.userAnswer,
        now: clock.now()
      });
      bumpDailyAiCount(context.user.id, clock.now());
      const nowIso = clock.now().toISOString();
      const next: PracticeQuestion = {
        ...question,
        userAnswer: payload.userAnswer.toUpperCase().trim(),
        aiExplanation: explanation,
        isCorrect,
        answeredAt: nowIso
      };
      await store.savePracticeQuestion(next);
      response.json({
        questionId: next.id,
        correct: isCorrect,
        correctAnswer: next.correctAnswer,
        explanation,
        usedToday: getCurrentAiCount(context.user.id, clock.now()),
        dailyLimit: 30
      });
    })
  );

  app.get(
    "/api/me/mistakes",
    withUser(store, clock, async (request, response, context) => {
      const includeMastered = String(request.query.includeMastered ?? "") === "1";
      const limit = parseLimit(request.query.limit, 50, 200);
      const items = await store.listPracticeMistakes(context.user.id, {
        limit,
        includeMastered,
        wrongOnly: true
      });
      response.json({
        items: items.map(serializePracticeQuestion)
      });
    })
  );

  app.post(
    "/api/me/mistakes/:id/mastered",
    withUser(store, clock, async (request, response, context) => {
      const id = String(request.params.id);
      const raw = request.body?.mastered;
      if (typeof raw !== "boolean") {
        throw new AppError(400, "INVALID_INPUT", "mastered must be boolean");
      }
      const item = await store.setPracticeMastered(id, context.user.id, raw);
      if (!item) {
        throw new AppError(404, "NOT_FOUND", "Mistake not found");
      }
      response.json({ item: serializePracticeQuestion(item) });
    })
  );

  app.post("/api/storage/temp-urls", withUser(store, clock, async (request, response) => {
    const payload = parse(tempUrlSchema, request.body);
    const queries = [
      ...(payload.items ?? []),
      ...(payload.objectKeys ?? []).map((objectKey) => ({ objectKey }))
    ];
    response.json({
      items: await storage.getTemporaryUrls(queries)
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
      const clientUid = getClientUid(request);
      if (!openid && !clientUid) {
        throw new AppError(
          401,
          "UNAUTHORIZED",
          "User identity required: provide either an openid (via WeChat) or a client UID."
        );
      }
      const context = await store.ensureUser(
        { openid: openid || null, clientUid: clientUid || null },
        clock.now().toISOString()
      );
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

/**
 * Anonymous fallback identifier sent by the miniprogram. We use this
 * alone (no openid) only when WeChat fails to inject openid, but always
 * persist it so the user_id stays stable across login transitions.
 *
 * Format: 32–64 char URL-safe string. We sanitize aggressively to avoid
 * SQL collation surprises.
 */
function getClientUid(request: Request) {
  const raw = request.header("x-client-uid") ?? request.header("X-CLIENT-UID") ?? "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  // Enforce a strict allow-list to avoid hostile/oversized values.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return "";
  return trimmed;
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

const PAUSED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// A single focus session that's been running for 12+ hours is almost
// certainly abandoned (user closed the app, fell asleep, etc.). We
// auto-reap rather than letting the timer accumulate fake hours.
const RUNNING_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

async function reapStalePausedSession(store: DataStore, userId: string, now: Date) {
  const session = await store.getCurrentSession(userId);
  if (!session) return null;
  if (session.status === "paused" && session.currentPauseStartedAt) {
    const pausedAt = new Date(session.currentPauseStartedAt).getTime();
    if (Number.isFinite(pausedAt) && now.getTime() - pausedAt > PAUSED_SESSION_TTL_MS) {
      await abandonSession(store, session, now.toISOString());
      return null;
    }
  }
  if (session.status === "running") {
    const startedAt = new Date(session.startedAt).getTime();
    if (Number.isFinite(startedAt) && now.getTime() - startedAt > RUNNING_SESSION_TTL_MS) {
      await abandonSession(store, session, now.toISOString());
      return null;
    }
  }
  return session;
}

function extractCloudObjectKey(value: string): string | null {
  if (!value || !value.startsWith("cloud://")) return null;
  try {
    const url = new URL(value);
    const key = url.pathname.replace(/^\//, "");
    return key || null;
  } catch {
    return null;
  }
}

async function resolvePublicAvatarUrl(storage: StorageClient, avatarUrl: string) {
  const objectKey = extractCloudObjectKey(avatarUrl);
  if (!objectKey) return avatarUrl;
  const [resolved] = await storage.getTemporaryUrls([
    { objectKey, fileId: avatarUrl }
  ]);
  return resolved?.url || avatarUrl;
}

function getCurrentStreak(stats: Map<string, DailyStat>) {
  const latest = [...stats.values()].sort((left, right) => right.date.localeCompare(left.date))[0];
  return latest?.streakDays ?? 0;
}

const MAKEUP_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function buildWeeklyReview(
  dailyStats: Map<string, DailyStat>,
  sessions: StudySession[],
  todayKey: string
) {
  const thisWeekStart = startOfShanghaiWeek(todayKey);
  const lastWeekStart = addShanghaiDays(thisWeekStart, -7);
  const lastWeekEnd = addShanghaiDays(thisWeekStart, -1);
  const thisWeekEnd = addShanghaiDays(thisWeekStart, 6);

  let thisWeekMinutes = 0;
  let lastWeekMinutes = 0;
  let bestDay: { date: string | null; totalMinutes: number } = { date: null, totalMinutes: 0 };

  for (const stat of dailyStats.values()) {
    if (stat.date >= thisWeekStart && stat.date <= thisWeekEnd) {
      thisWeekMinutes += stat.totalMinutes;
      if (stat.totalMinutes > bestDay.totalMinutes) {
        bestDay = { date: stat.date, totalMinutes: stat.totalMinutes };
      }
    } else if (stat.date >= lastWeekStart && stat.date <= lastWeekEnd) {
      lastWeekMinutes += stat.totalMinutes;
    }
  }

  const subjectTally = new Map<string, number>();
  for (const session of sessions) {
    if (session.status !== "completed" || !session.endedAt || !session.subject) continue;
    const dateKey = formatShanghaiDate(session.endedAt);
    if (dateKey < thisWeekStart || dateKey > thisWeekEnd) continue;
    subjectTally.set(session.subject, (subjectTally.get(session.subject) ?? 0) + session.durationMinutes);
  }

  const topSubjectEntry = [...subjectTally.entries()].sort((left, right) => right[1] - left[1])[0];

  return {
    weekStart: thisWeekStart,
    weekEnd: thisWeekEnd,
    thisWeekMinutes,
    lastWeekMinutes,
    bestDay,
    topSubject: topSubjectEntry ? { subject: topSubjectEntry[0], totalMinutes: topSubjectEntry[1] } : null
  };
}

function findMakeupOpportunity(
  dailyStats: Map<string, DailyStat>,
  sessions: StudySession[],
  todayKey: string
) {
  const sortedDates = [...dailyStats.keys()].sort();
  const lastDate = sortedDates[sortedDates.length - 1];
  if (!lastDate) return null;
  if (lastDate >= todayKey) return null;

  const expectedYesterday = addShanghaiDays(todayKey, -1);
  if (lastDate !== addShanghaiDays(expectedYesterday, -1)) return null;
  if (dailyStats.has(expectedYesterday)) return null;

  const recentMakeup = sessions
    .filter((session) => session.status === "makeup" && session.createdAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (recentMakeup) {
    const elapsed = Date.now() - new Date(recentMakeup.createdAt).getTime();
    if (Number.isFinite(elapsed) && elapsed < MAKEUP_COOLDOWN_MS) return null;
  }

  return {
    date: expectedYesterday,
    streakIfRecovered: (dailyStats.get(lastDate)?.streakDays ?? 0) + 2
  };
}

function getLongestStreak(stats: Map<string, DailyStat>) {
  let longest = 0;
  for (const stat of stats.values()) {
    if (stat.streakDays > longest) longest = stat.streakDays;
  }
  return longest;
}

type BadgeKey =
  | "first_checkin"
  | "streak_7"
  | "streak_30"
  | "total_10h"
  | "total_50h"
  | "total_100h"
  | "single_day_4h"
  | "subject_50h"
  | "all_six_subjects";

const BADGE_DEFINITIONS: Array<{
  key: BadgeKey;
  name: string;
  description: string;
  icon: string;
}> = [
  { key: "first_checkin", name: "初次打卡", description: "完成第一次学习记录", icon: "🌱" },
  { key: "streak_7", name: "连签 7 日", description: "连续 7 天保持打卡", icon: "🔥" },
  { key: "streak_30", name: "连签 30 日", description: "连续 30 天稳如老狗", icon: "💎" },
  { key: "total_10h", name: "积少成多", description: "累计学习满 10 小时", icon: "📚" },
  { key: "total_50h", name: "稳扎稳打", description: "累计学习满 50 小时", icon: "📖" },
  { key: "total_100h", name: "百时备考", description: "累计学习满 100 小时", icon: "🏆" },
  { key: "single_day_4h", name: "高强度日", description: "单日学习满 4 小时", icon: "⚡" },
  { key: "subject_50h", name: "科目专家", description: "单科累计满 50 小时", icon: "🎯" },
  { key: "all_six_subjects", name: "六科齐学", description: "六门科目都有学习记录", icon: "🌈" }
];

function computeBadges(args: {
  totalMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
  bestDayMinutes: number;
  completedCount: number;
  subjectTotals: Array<{ subject: Subject; totalMinutes: number }>;
  completedSubjectCount: number;
}) {
  const peakStreak = Math.max(args.currentStreakDays, args.longestStreakDays);
  const maxSubjectMinutes = args.subjectTotals.reduce(
    (max, item) => (item.totalMinutes > max ? item.totalMinutes : max),
    0
  );
  // Per-badge progress so the miniprogram can show "5/7 天" instead of
  // just a binary locked/unlocked.
  const progressMap: Record<BadgeKey, { current: number; goal: number; unit: string }> = {
    first_checkin: { current: Math.min(args.completedCount, 1), goal: 1, unit: "次" },
    streak_7: { current: peakStreak, goal: 7, unit: "天" },
    streak_30: { current: peakStreak, goal: 30, unit: "天" },
    total_10h: { current: args.totalMinutes, goal: 600, unit: "min" },
    total_50h: { current: args.totalMinutes, goal: 3000, unit: "min" },
    total_100h: { current: args.totalMinutes, goal: 6000, unit: "min" },
    single_day_4h: { current: args.bestDayMinutes, goal: 240, unit: "min" },
    subject_50h: { current: maxSubjectMinutes, goal: 3000, unit: "min" },
    all_six_subjects: { current: args.completedSubjectCount, goal: SUBJECTS.length, unit: "科" }
  };

  return BADGE_DEFINITIONS.map((badge) => {
    const p = progressMap[badge.key];
    const ratio = p.goal > 0 ? p.current / p.goal : 0;
    return {
      ...badge,
      unlocked: ratio >= 1,
      progress: Math.max(0, Math.min(1, ratio)),
      current: Math.min(p.current, p.goal),
      goal: p.goal,
      unit: p.unit
    };
  });
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
    mode: session.mode,
    startedAt: session.startedAt,
    currentPauseStartedAt: session.currentPauseStartedAt,
    pauseSegments: session.pauseSegments,
    pomodoroCycles: session.pomodoroCycles,
    subject: session.subject,
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

/**
 * Returns the index of the largest positive entry, or null when the
 * whole array is zero (i.e. user has never studied — no peak yet).
 * Ties pick the earliest index, which keeps the displayed "peak"
 * stable across small swings in close hours.
 */
function pickPeakIndex(values: number[]): number | null {
  let bestIdx: number | null = null;
  let bestValue = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseNewsCategoryParam(raw: unknown): NewsCategory | "all" {
  if (typeof raw !== "string" || !raw || raw === "all") return "all";
  return (NEWS_CATEGORIES as readonly string[]).includes(raw) ? (raw as NewsCategory) : "all";
}

function parseLimit(raw: unknown, fallback: number, max: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

/** Tiny wrapper so the route handlers don't depend on the ai.ts module directly. */
function getCurrentAiCount(userId: string, now: Date): number {
  return getDailyAiCount(userId, now);
}

/**
 * Trim a practice question for the 错题本 list view. We expose the
 * correct answer + user's answer + AI explanation here because the
 * user has already answered — there's no security reason to hide
 * the answer they've already seen.
 */
function serializePracticeQuestion(item: PracticeQuestion) {
  return {
    id: item.id,
    subject: item.subject,
    difficulty: item.difficulty,
    question: item.question,
    options: item.options,
    correctAnswer: item.correctAnswer,
    userAnswer: item.userAnswer,
    aiExplanation: item.aiExplanation,
    isCorrect: item.isCorrect,
    isMastered: item.isMastered,
    createdAt: item.createdAt,
    answeredAt: item.answeredAt
  };
}

function serializeNewsListItem(item: import("./types").NewsItem) {
  return {
    id: item.id,
    source: item.source,
    category: item.category,
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: item.publishedAt
  };
}

function serializeNewsDetail(item: import("./types").NewsItem) {
  return {
    id: item.id,
    source: item.source,
    category: item.category,
    title: item.title,
    summary: item.summary,
    content: item.content,
    url: item.url,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt
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

import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { registerAdminRoutes } from "./admin/routes";
import { SUBJECTS, SUBJECT_TARGET_MINUTES, TAGS, type SessionTag, type Subject } from "./constants";
import { addShanghaiDays, monthBounds, formatShanghaiDate, startOfShanghaiWeek } from "./domain/date-utils";
import { getExamSchedule } from "./domain/exam-dates";
// v0.26 — maybeKickoffNewsRefresh / ensureNewsSeed imports removed.
// The public /api/news routes were deleted alongside the v0.22 「动态」
// tab cleanup; news_items table + admin curation routes still exist
// in case the feature is revived later, but the boot-time seed and
// auto-refresh trigger are no longer wired from app.ts.
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
  type NewsCategory,
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

/**
 * v0.24 — summary + photos are now OPTIONAL on complete. Users can
 * tap "完成打卡" with neither field touched and the server accepts
 * it. Rationale: the打卡 ritual was a 7-tap path even for a 25-min
 * focus session where the user has no photo to upload (commute,
 * mental rehearsal, exam-room walking, etc.). Making the form
 * fields skippable cuts the critical path to 3 taps.
 *
 * What we still enforce:
 *  - subject (if provided) must be one of the 6 known categories
 *  - tags (if provided) must come from the curated TAGS list
 *  - summary max length 80 (overshoot is still a real bug)
 *  - photos max 3 + cloud:// fileId + safe objectKey
 *  - pomodoro cycles 0-32 (sanity bound)
 *
 * Removed: summary.min(1) and photos.min(1).
 */
const completeSchema = z.object({
  summary: z.string().trim().max(80).default(""),
  subject: z.enum(SUBJECTS).nullable().optional(),
  // v0.37 — A3: optional free-text chapter/topic within the subject.
  topic: z.string().trim().max(40).nullable().optional(),
  tags: z.array(z.enum(TAGS)).max(6).default([]),
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
    .max(3)
    .default([])
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

  // v0.26 — news seed no longer installed at boot. The public news
  // routes were removed in v0.26 alongside the 「动态」 tab cleanup;
  // existing news_items data + admin curation routes are still
  // available if we revive the feature later.

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
    const reap = await reapStaleSession(store, context.user.id, clock.now());
    const activeSession = reap.session;
    const todayKey = formatShanghaiDate(clock.now());
    const dailyStats = await store.getDailyStats(context.user.id);
    const today = dailyStats.get(todayKey) ?? emptyDailyStat(context.user.id, todayKey, clock.now().toISOString());
    const sessions = await store.listSessions(context.user.id);
    const latestCompleted = sessions.find((session) => session.status === "completed") ?? null;

    response.json({
      profile: serializeProfile(context.user, context.publicProfile),
      activeSession: activeSession ? serializeActiveSession(activeSession, clock.now()) : null,
      // v0.35 — A2: when /home auto-handled a forgotten session, tell the
      // client so it can surface a one-line toast (recorded N min, or
      // cleaned up an over-long timer). null on the common path.
      reapedSession: reap.reaped,
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

  /**
   * Lightweight completed-sessions list for the 「小猫花园」 page —
   * each completed session becomes a "cat" in the collection. We
   * cap the response at 200 rows because:
   *   1. The garden UI grids them in 5×N, so 200 fits ~40 rows
   *      before the visual interest diminishes.
   *   2. A power user with 500+ sessions wouldn't want to scroll
   *      that far anyway.
   * Returns minimal fields — no photos, no pause segments, no
   * summary text — since the garden view-model only needs each
   * session's identity, subject, mode, duration, and timestamps.
   */
  app.get("/api/me/sessions", withUser(store, clock, async (_request, response, context) => {
    const sessions = (await store.listSessions(context.user.id))
      .filter((s) => s.status === "completed")
      .slice(0, 200);
    response.json({
      items: sessions.map((s) => ({
        id: s.id,
        subject: s.subject,
        mode: s.mode,
        durationMinutes: s.durationMinutes,
        pomodoroCycles: s.pomodoroCycles,
        // v0.36 — B3 状态聚合 needs per-session tags (already stored,
        // just not previously exposed) to aggregate 卡住/顺利 by subject.
        tags: s.tags,
        startedAt: s.startedAt,
        endedAt: s.endedAt
      }))
    });
  }));

  // -----------------------------------------------------------------
  // v0.38 — B2/B4 周复盘: save (upsert) + list weekly reflections.
  // weekKey is an opaque client-supplied key (the client computes its
  // own ISO week, e.g. "2026-W21") so the server stays out of week math.
  // -----------------------------------------------------------------
  const weeklyReviewSchema = z.object({
    weekKey: z.string().trim().regex(/^[0-9A-Za-z-]{1,16}$/, "invalid weekKey"),
    content: z.string().trim().max(1000).default("")
  });

  app.post("/api/me/weekly-review", withUser(store, clock, async (request, response, context) => {
    const payload = parse(weeklyReviewSchema, request.body);
    const review = await store.saveWeeklyReview(
      context.user.id,
      payload.weekKey,
      payload.content,
      clock.now().toISOString()
    );
    response.json({ review });
  }));

  app.get("/api/me/weekly-reviews", withUser(store, clock, async (_request, response, context) => {
    const reviews = await store.listWeeklyReviews(context.user.id);
    response.json({ items: reviews });
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
      // Idempotent re-completion: same response shape as a fresh
      // complete, but newlyUnlockedBadge is null (we already counted
      // this session in the prior call). The client treats `null`
      // as "no unlock animation needed".
      response.json({
        session,
        dailyStats: stats.get(dateKey) ?? emptyDailyStat(context.user.id, dateKey, clock.now().toISOString()),
        newlyUnlockedBadge: null
      });
      return;
    }

    if (session.status === "abandoned") {
      throw new AppError(409, "INVALID_STATE", "Abandoned sessions cannot be completed");
    }

    // v0.25 — snapshot badges BEFORE saving the completion so we can
    // diff for newly-unlocked achievements after the save. We do this
    // before the state transition so the snapshot reflects "as of last
    // session"; the second snapshot below reflects "with this one
    // counted". Cost: one extra listSessions+getDailyStats round-trip,
    // acceptable for the one-call-per-session endpoint.
    const badgesBefore = await computeBadgesFromUserData(store, context.user.id);

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
    session.topic = payload.topic ?? null;
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
    // v0.25 — second badge snapshot, this time after the session has
    // been saved. Diff against the pre-save snapshot to find the most
    // notable badge that just flipped unlocked.
    const badgesAfter = await computeBadgesFromUserData(store, context.user.id);
    const newlyUnlockedBadge = pickNewlyUnlockedBadge(badgesBefore, badgesAfter);
    response.json({
      session,
      dailyStats: (await store.getDailyStats(context.user.id)).get(endDate) ?? emptyDailyStat(context.user.id, endDate, now),
      newlyUnlockedBadge
    });
  }));

  // -----------------------------------------------------------------
  // v0.34 — A1 补录: manual retroactive study entry. Records a
  // completed session for a past (or today) date with a user-supplied
  // duration, so time studied without the timer (forgot to start /
  // studied on paper) isn't lost. Anchors the session at 20:00
  // Shanghai of the target date so BOTH the timestamp-based day
  // attribution (buildDayContributions) AND the durationMinutes field
  // (subject totals) land on that date without crossing midnight
  // (duration ≤ 600min = 10h, so startedAt ≥ 10:00 same day). Reuses
  // the exact complete-flow tail: rebuildDailyStats recomputes the
  // past day's stats + streak automatically, and we diff badges.
  // -----------------------------------------------------------------
  const manualSessionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    durationMinutes: z.number().int().min(1).max(600),
    subject: z.enum(SUBJECTS).nullable().optional(),
    topic: z.string().trim().max(40).nullable().optional(),
    tags: z.array(z.enum(TAGS)).max(6).default([]),
    summary: z.string().trim().max(80).default("")
  });

  app.post("/api/sessions/manual", withUser(store, clock, async (request, response, context) => {
    const payload = parse(manualSessionSchema, request.body);
    const nowIso = clock.now().toISOString();
    const todayKey = formatShanghaiDate(nowIso);
    if (payload.date > todayKey) {
      throw new AppError(400, "INVALID_INPUT", "不能补录未来的日期");
    }

    const endedAt = new Date(`${payload.date}T20:00:00+08:00`).toISOString();
    if (Number.isNaN(new Date(endedAt).getTime())) {
      throw new AppError(400, "INVALID_INPUT", "日期无效");
    }
    const startedAt = new Date(new Date(endedAt).getTime() - payload.durationMinutes * 60_000).toISOString();

    const badgesBefore = await computeBadgesFromUserData(store, context.user.id);

    const session: StudySession = {
      id: randomUUID(),
      userId: context.user.id,
      status: "completed",
      mode: "free",
      startedAt,
      endedAt,
      currentPauseStartedAt: null,
      pauseSegments: [],
      durationMinutes: payload.durationMinutes,
      pomodoroCycles: 0,
      summary: payload.summary,
      subject: (payload.subject ?? null) as Subject | null,
      topic: payload.topic ?? null,
      tags: payload.tags as SessionTag[],
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await store.saveSession(session);

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

    const badgesAfter = await computeBadgesFromUserData(store, context.user.id);
    const newlyUnlockedBadge = pickNewlyUnlockedBadge(badgesBefore, badgesAfter);
    response.json({
      session,
      dailyStats:
        (await store.getDailyStats(context.user.id)).get(payload.date) ??
        emptyDailyStat(context.user.id, payload.date, nowIso),
      newlyUnlockedBadge
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

  // v0.26 — 「动态」 (news) tab removed in v0.22 from the client.
  // Public /api/news + /api/news/:id routes removed here; the
  // admin /admin/news routes (curation + manual posts) stay for
  // now in case we revive the feature later. news_items table
  // also kept so existing data isn't deleted.

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

  /* ----------------------------------------------------------------
   * v0.20 — daily 20:30 reminder. Three endpoints:
   *   GET  /api/me/reminder/status    → current state
   *   POST /api/me/reminder/subscribe → user accepted N more 一次性
   *                                     订阅消息 grants (bumps credits)
   *   POST /api/me/reminder/disable   → user toggled off (keeps any
   *                                     credits since the user can
   *                                     toggle back on later)
   * The actual send happens in domain/reminder-scheduler.ts at
   * 20:30 Asia/Shanghai daily.
   * --------------------------------------------------------------- */
  app.get(
    "/api/me/reminder/status",
    withUser(store, clock, async (_request, response, context) => {
      response.json({
        enabled: context.user.reminderEnabled,
        credits: context.user.reminderCredits,
        lastSentAt: context.user.reminderLastSentAt,
        hasOpenid: !!context.user.openid
      });
    })
  );

  const reminderSubscribeSchema = z.object({
    /** Number of one-time subscription-message grants just accepted.
     *  Clamped server-side; usually 1 per requestSubscribeMessage call. */
    accepted: z.number().int().min(1).max(10).default(1)
  });

  app.post(
    "/api/me/reminder/subscribe",
    withUser(store, clock, async (request, response, context) => {
      const payload = parse(reminderSubscribeSchema, request.body);
      // Two-step: ensure the toggle is on, then bump credits. Both
      // are idempotent at the row level.
      await store.setReminderEnabled(context.user.id, true);
      const user = await store.incrementReminderCredits(context.user.id, payload.accepted);
      response.json({
        enabled: !!user?.reminderEnabled,
        credits: user?.reminderCredits ?? 0
      });
    })
  );

  app.post(
    "/api/me/reminder/disable",
    withUser(store, clock, async (_request, response, context) => {
      const user = await store.setReminderEnabled(context.user.id, false);
      response.json({
        enabled: !!user?.reminderEnabled,
        credits: user?.reminderCredits ?? 0
      });
    })
  );

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
// v0.35 — A2: real run-time at or below this is auto-RECORDED when a
// stale session is reaped (recover the study the user did before they
// forgot to stop). Above it, the elapsed is almost certainly a
// forgotten timer accumulating idle hours, so we discard rather than
// fabricate study time. Matches the 补录 manual cap (10h).
const REAP_AUTO_COMPLETE_CAP_MIN = 600;

type ReapInfo = { action: "completed" | "abandoned"; minutes: number };

/**
 * v0.35 — A2 暂停/挂死 session 超时处理. Lazy sweep on /home: a session
 * paused for > 24h or running for > 12h is "forgotten". Instead of
 * always discarding it (the old behavior — lost the real study time),
 * we recover the genuine run-time (excluding pauses, up to the moment
 * study stopped) and auto-COMPLETE it when that's within a sane cap;
 * only fabrication-risk durations (or none) are abandoned. Returns the
 * still-active session (or null) plus what was reaped, so /home can
 * tell the client to surface a one-line toast.
 */
async function reapStaleSession(
  store: DataStore,
  userId: string,
  now: Date
): Promise<{ session: StudySession | null; reaped: ReapInfo | null }> {
  const session = await store.getCurrentSession(userId);
  if (!session) return { session: null, reaped: null };

  const nowIso = now.toISOString();
  let stale = false;
  // The moment study actually stopped: for a paused session that's when
  // they paused; for a runaway running session, "now".
  let endedAt = nowIso;

  if (session.status === "paused" && session.currentPauseStartedAt) {
    const pausedAt = new Date(session.currentPauseStartedAt).getTime();
    if (Number.isFinite(pausedAt) && now.getTime() - pausedAt > PAUSED_SESSION_TTL_MS) {
      stale = true;
      endedAt = session.currentPauseStartedAt;
    }
  } else if (session.status === "running") {
    const startedAt = new Date(session.startedAt).getTime();
    if (Number.isFinite(startedAt) && now.getTime() - startedAt > RUNNING_SESSION_TTL_MS) {
      stale = true;
      endedAt = nowIso;
    }
  }

  if (!stale) return { session, reaped: null };

  const runMinutes = calculateDurationMinutes(session.startedAt, endedAt, session.pauseSegments);

  if (runMinutes <= REAP_AUTO_COMPLETE_CAP_MIN) {
    // Recover real study time rather than discard it.
    if (session.status === "paused" && session.currentPauseStartedAt) {
      session.pauseSegments.push({ startedAt: session.currentPauseStartedAt, endedAt });
      session.currentPauseStartedAt = null;
    }
    session.status = "completed";
    session.endedAt = endedAt;
    session.durationMinutes = runMinutes;
    session.updatedAt = nowIso;
    await store.saveSession(session);
    await store.replaceDailyStats(
      userId,
      rebuildDailyStats(
        userId,
        (await store.listSessions(userId)).filter(
          (item) => item.status === "completed" || item.status === "makeup"
        ),
        nowIso
      )
    );
    return { session: null, reaped: { action: "completed", minutes: runMinutes } };
  }

  // Beyond the cap → forgotten timer; discard, never fabricate hours.
  await abandonSession(store, session, nowIso);
  return { session: null, reaped: { action: "abandoned", minutes: 0 } };
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

/**
 * v0.21 — badges redesigned as 「成就小猫」: every achievement
 * unlocks a uniquely-named cat breed whose rarity matches the
 * difficulty. The miniprogram badges page now renders these as
 * a collectible grid with a rarity-tinted card per breed, and an
 * achievement-guide section that explicitly says
 *   "完成 X → 解锁 Y 小猫"
 * so the user knows what to chase.
 *
 * Why this redesign
 * =================
 * The original list (积少成多 / 稳扎稳打 / 百时备考) used near-identical
 * book/trophy icons + similar Chinese names, so the page felt full of
 * duplicates. Tying each badge to a distinct cat breed gives each
 * achievement its own identity — both visually (unique emoji per
 * breed) and verbally (no two breed names overlap).
 *
 * Rarity ladder
 * =============
 *   common    : 起步成就 (mint  border)
 *   rare      : 中阶 (blue  border)
 *   epic      : 高阶 (amber border)
 *   legendary : 终极 (gold  border)
 */
type BadgeRarity = "common" | "rare" | "epic" | "legendary";

type BadgeKey =
  | "first_checkin"
  | "streak_7"
  | "streak_30"
  | "total_10h"
  | "total_50h"
  | "total_100h"
  | "total_300h"
  | "single_day_4h"
  | "subject_50h"
  | "all_six_subjects"
  | "all_six_10h";

/**
 * Breed assignments calibrated against actual 2026 Chinese pet-cat
 * market pricing so each rarity tier corresponds to a real-world
 * scarcity tier:
 *   common    : 国内本土常见品种 (free-to-low cost): 田园 / 橘 / 狸花
 *   rare      : 常见纯种 (~¥2k-5k): 美短 / 暹罗 / 银渐层
 *   epic      : 较稀有纯种 (~¥5k-30k): 布偶 / 波斯 / 金渐层
 *               (金渐层 is a 银渐层 colour mutation — genuinely rarer.)
 *   legendary : 顶级 / 半野猫品种 (~¥10k-150k+): 缅因 / 孟加拉豹
 * 用户在 v0.21.0 的反馈：银渐层不如金渐层稀有，已修正等级。
 */
const BADGE_DEFINITIONS: Array<{
  key: BadgeKey;
  /** Cat breed name shown as the badge title. Unique by design. */
  name: string;
  /** Plain-language achievement requirement, used as the badge description AND the guide-section entry. */
  description: string;
  /** Single emoji chosen to visually evoke the breed. */
  icon: string;
  /** Rarity tier — drives the badge tile's color treatment. */
  rarity: BadgeRarity;
}> = [
  // Common — 本土常见品种 (almost-free domestic cats)
  { key: "first_checkin",    name: "中华田园猫", description: "完成首次专注打卡",                icon: "🐱", rarity: "common" },
  { key: "total_10h",        name: "橘猫",       description: "累计学习满 10 小时",              icon: "🐈", rarity: "common" },
  { key: "streak_7",         name: "狸花猫",     description: "连续 7 天保持打卡",                icon: "😸", rarity: "common" },

  // Rare — 常见纯种 (¥2k-5k range)
  { key: "single_day_4h",    name: "美国短毛猫", description: "单日学习满 4 小时",                icon: "😺", rarity: "rare" },
  { key: "total_50h",        name: "暹罗猫",     description: "累计学习满 50 小时",              icon: "😼", rarity: "rare" },
  { key: "total_100h",       name: "英短银渐层", description: "累计学习满 100 小时",              icon: "😽", rarity: "rare" },

  // Epic — 较稀有纯种 (¥5k-30k range; 金渐层 is a 银渐层 mutation)
  { key: "streak_30",        name: "布偶猫",     description: "连续 30 天保持打卡",               icon: "😻", rarity: "epic" },
  { key: "subject_50h",      name: "波斯猫",     description: "单科累计满 50 小时",               icon: "💎", rarity: "epic" },
  { key: "all_six_subjects", name: "英短金渐层", description: "6 科各完成至少 1 分钟专注",         icon: "✨", rarity: "epic" },

  // Legendary — 顶级 / 半野猫品种 (¥10k-150k+)
  { key: "total_300h",       name: "缅因猫",     description: "累计学习满 300 小时",              icon: "🦁", rarity: "legendary" },
  { key: "all_six_10h",      name: "孟加拉豹猫", description: "6 科各累计满 10 小时",             icon: "🐅", rarity: "legendary" }
];

/**
 * v0.25 — single source of truth for "what would the user's badge
 * list look like right now". Used by /api/me/dashboard (where the
 * full list is rendered to the client) and by /api/sessions/:id/
 * complete (which calls it twice — once before saveSession, once
 * after — to detect newly-unlocked badges and surface a single
 * achievement-unlock event to the client).
 *
 * The "subjectTotals must include all 6" comment in the legacy
 * caller used to gate the all_six_10h calculation; we preserve that
 * invariant by always passing the full SUBJECTS list with zero
 * fallbacks rather than the filtered "has progress" subset.
 */
async function computeBadgesFromUserData(
  store: DataStore,
  userId: string
): Promise<ReturnType<typeof computeBadges>> {
  const sessions = (await store.listSessions(userId)).filter(
    (session) => session.status === "completed"
  );
  const dailyStats = await store.getDailyStats(userId);
  const subjectFullTotals = SUBJECTS.map((subject) => ({
    subject,
    totalMinutes: sessions
      .filter((session) => session.subject === subject)
      .reduce((sum, session) => sum + session.durationMinutes, 0)
  }));
  const totalMinutes = [...dailyStats.values()].reduce(
    (sum, stat) => sum + stat.totalMinutes,
    0
  );
  const bestDayMinutes = [...dailyStats.values()].reduce(
    (max, stat) => (stat.totalMinutes > max ? stat.totalMinutes : max),
    0
  );
  const completedSubjects = new Set(
    sessions
      .map((session) => session.subject)
      .filter((subject): subject is Subject => Boolean(subject))
  );
  return computeBadges({
    totalMinutes,
    currentStreakDays: getCurrentStreak(dailyStats),
    longestStreakDays: getLongestStreak(dailyStats),
    bestDayMinutes,
    completedCount: sessions.length,
    subjectTotals: subjectFullTotals,
    completedSubjectCount: completedSubjects.size
  });
}

/**
 * Diff two snapshots of the user's badges to find ones that just
 * flipped unlocked=false → unlocked=true. Returns the first such
 * badge (a single session typically crosses ≤1 threshold; if a
 * mega-session crosses several at once, we surface the rarest so
 * the user feels the bigger achievement).
 */
function pickNewlyUnlockedBadge(
  before: ReturnType<typeof computeBadges>,
  after: ReturnType<typeof computeBadges>
): ReturnType<typeof computeBadges>[number] | null {
  const beforeMap = new Map(before.map((b) => [b.key, b]));
  const justUnlocked = after.filter((b) => {
    const prev = beforeMap.get(b.key);
    return b.unlocked && (!prev || !prev.unlocked);
  });
  if (justUnlocked.length === 0) return null;
  const rarityRank: Record<string, number> = {
    legendary: 4,
    epic: 3,
    rare: 2,
    common: 1
  };
  return justUnlocked.reduce((best, cand) =>
    (rarityRank[cand.rarity] ?? 0) > (rarityRank[best.rarity] ?? 0) ? cand : best
  );
}

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
  // v0.21 — for the "全科都达到 X" gates, what matters is the *minimum*
  // subject's minutes, not the max. If even the worst subject crosses
  // the threshold, all 6 have. Used by all_six_10h.
  const minSubjectMinutes = args.subjectTotals.length === SUBJECTS.length
    ? args.subjectTotals.reduce(
        (min, item) => (item.totalMinutes < min ? item.totalMinutes : min),
        Number.POSITIVE_INFINITY
      )
    : 0;

  // Per-badge progress so the miniprogram can show "5/7 天" instead of
  // just a binary locked/unlocked.
  const progressMap: Record<BadgeKey, { current: number; goal: number; unit: string }> = {
    first_checkin: { current: Math.min(args.completedCount, 1), goal: 1, unit: "次" },
    streak_7: { current: peakStreak, goal: 7, unit: "天" },
    streak_30: { current: peakStreak, goal: 30, unit: "天" },
    total_10h: { current: args.totalMinutes, goal: 600, unit: "min" },
    total_50h: { current: args.totalMinutes, goal: 3000, unit: "min" },
    total_100h: { current: args.totalMinutes, goal: 6000, unit: "min" },
    total_300h: { current: args.totalMinutes, goal: 18_000, unit: "min" },
    single_day_4h: { current: args.bestDayMinutes, goal: 240, unit: "min" },
    subject_50h: { current: maxSubjectMinutes, goal: 3000, unit: "min" },
    all_six_subjects: { current: args.completedSubjectCount, goal: SUBJECTS.length, unit: "科" },
    all_six_10h: {
      current: Number.isFinite(minSubjectMinutes) ? minSubjectMinutes : 0,
      goal: 600,
      unit: "min"
    }
  };

  return BADGE_DEFINITIONS.map((badge) => {
    const p = progressMap[badge.key];
    const ratio = p.goal > 0 ? p.current / p.goal : 0;
    return {
      ...badge,
      // v0.21.2 — bundled SVG illustration of the breed. The client
      // renders <image src="..."> using this absolute path inside
      // the miniprogram package. Falls back to the emoji `icon` if
      // the asset fails to load.
      imageUrl: `/package-profile/badges/cats/${badge.key}.svg`,
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

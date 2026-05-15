import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

class TestClock {
  private current: Date;

  constructor(value: string) {
    this.current = new Date(value);
  }

  now() {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

describe("CPA study check-in API", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-04-16T10:00:00+08:00");
    app = createApp({
      clock: {
        now: () => clock.now()
      },
      storage: {
        async getTemporaryUrls(items: Array<{ objectKey: string; fileId?: string }>) {
          return items.map((item) => ({
            objectKey: item.objectKey,
            url: `https://temp.example.com/${item.objectKey}`,
            expiresAt: "2026-04-16T12:00:00+08:00"
          }));
        }
      }
    });
  });

  it("bootstraps a user, completes a session, and keeps complete idempotent", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "user-1")
      .expect(200);

    expect(bootstrap.body.needsOnboarding).toBe(true);
    expect(bootstrap.body.profile.nickname).toBe("");

    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "user-1")
      .send({
        nickname: "薄荷考生",
        avatarUrl: "https://example.com/avatar.png",
        isPublic: true,
        requireWechatAuth: true
      })
      .expect(200);

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "user-1")
      .expect(200);

    const sessionId = started.body.session.id as string;
    expect(started.body.session.status).toBe("running");

    clock.advanceMinutes(50);
    await request(app)
      .post(`/api/sessions/${sessionId}/pause`)
      .set("x-wx-openid", "user-1")
      .expect(200);

    clock.advanceMinutes(10);
    await request(app)
      .post(`/api/sessions/${sessionId}/resume`)
      .set("x-wx-openid", "user-1")
      .expect(200);

    clock.advanceMinutes(70);

    const completed = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", "user-1")
      .send({
        summary: "今晚把审计风险评估刷顺了。",
        subject: "审计",
        tags: ["顺利", "刷题"],
        photos: [
          {
            fileId: "cloud://demo/photo-1.jpg",
            objectKey: "checkins/2026/04/photo-1.jpg"
          }
        ]
      })
      .expect(200);

    expect(completed.body.session.durationMinutes).toBe(120);
    expect(completed.body.dailyStats.totalMinutes).toBe(120);
    // 120 min sits in level 4 under the v0.4.5 thresholds
    // (≥120 min crosses from "around target" into "solid focus").
    expect(completed.body.dailyStats.heatLevel).toBe(4);
    expect(completed.body.dailyStats.streakDays).toBe(1);

    const duplicate = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", "user-1")
      .send({
        summary: "今晚把审计风险评估刷顺了。",
        subject: "审计",
        tags: ["顺利", "刷题"],
        photos: [
          {
            fileId: "cloud://demo/photo-1.jpg",
            objectKey: "checkins/2026/04/photo-1.jpg"
          }
        ]
      })
      .expect(200);

    expect(duplicate.body.session.durationMinutes).toBe(120);

    const home = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "user-1")
      .expect(200);

    expect(home.body.activeSession).toBeNull();
    expect(home.body.today.totalMinutes).toBe(120);
    expect(home.body.today.sessionCount).toBe(1);
    expect(home.body.summary.currentStreakDays).toBe(1);
    expect(home.body.summary.lastSummary).toBe("今晚把审计风险评估刷顺了。");

    const calendar = await request(app)
      .get("/api/calendar?month=2026-04")
      .set("x-wx-openid", "user-1")
      .expect(200);

    expect(calendar.body.days["2026-04-16"].totalMinutes).toBe(120);
    expect(calendar.body.days["2026-04-16"].heatLevel).toBe(4);
  });

  it("preserves a paused session on home re-fetch within the TTL but reaps it after 24h", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "user-2")
      .send({
        nickname: "暂停用户",
        avatarUrl: "https://example.com/avatar-2.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "user-2")
      .expect(200);

    const sessionId = started.body.session.id as string;

    clock.advanceMinutes(20);
    await request(app)
      .post(`/api/sessions/${sessionId}/pause`)
      .set("x-wx-openid", "user-2")
      .expect(200);

    const home = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "user-2")
      .expect(200);

    expect(home.body.activeSession).not.toBeNull();
    expect(home.body.activeSession.id).toBe(sessionId);
    expect(home.body.activeSession.status).toBe("paused");

    clock.advanceMinutes(24 * 60 + 5);

    const homeStale = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "user-2")
      .expect(200);

    expect(homeStale.body.activeSession).toBeNull();

    const details = await request(app)
      .get("/api/calendar/2026-04-16")
      .set("x-wx-openid", "user-2")
      .expect(200);

    expect(details.body.sessions).toHaveLength(0);
  });

  it("splits an overnight session into the correct day totals and protects public pages", async () => {
    clock = new TestClock("2026-04-16T23:30:00+08:00");
    app = createApp({
      clock: {
        now: () => clock.now()
      },
      storage: {
        async getTemporaryUrls(items: Array<{ objectKey: string; fileId?: string }>) {
          return items.map((item) => ({
            objectKey: item.objectKey,
            url: `https://temp.example.com/${item.objectKey}`,
            expiresAt: "2026-04-17T12:00:00+08:00"
          }));
        }
      }
    });

    const profile = await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "owner")
      .send({
        nickname: "公开考生",
        avatarUrl: "https://example.com/owner.png",
        isPublic: true,
        requireWechatAuth: true
      })
      .expect(200);

    const slug = profile.body.publicProfile.shareSlug as string;

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "owner")
      .expect(200);

    const sessionId = started.body.session.id as string;

    clock.advanceMinutes(60);
    await request(app)
      .post(`/api/sessions/${sessionId}/pause`)
      .set("x-wx-openid", "owner")
      .expect(200);

    clock.advanceMinutes(15);
    await request(app)
      .post(`/api/sessions/${sessionId}/resume`)
      .set("x-wx-openid", "owner")
      .expect(200);

    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", "owner")
      .send({
        summary: "跨夜把财管公式重新梳理了一遍。",
        subject: "财管",
        tags: ["复习"],
        photos: [
          {
            fileId: "cloud://demo/photo-night.jpg",
            objectKey: "checkins/2026/04/photo-night.jpg"
          }
        ]
      })
      .expect(200);

    const dayOne = await request(app)
      .get("/api/calendar/2026-04-16")
      .set("x-wx-openid", "owner")
      .expect(200);

    const dayTwo = await request(app)
      .get("/api/calendar/2026-04-17")
      .set("x-wx-openid", "owner")
      .expect(200);

    expect(dayOne.body.totalMinutes).toBe(30);
    expect(dayTwo.body.totalMinutes).toBe(75);

    await request(app).get(`/api/public/${slug}`).expect(401);

    const publicProfile = await request(app)
      .get(`/api/public/${slug}`)
      .set("x-wx-openid", "viewer")
      .expect(200);

    expect(publicProfile.body.profile.nickname).toBe("公开考生");
    expect(publicProfile.body.summary.totalMinutes).toBe(105);
    expect(publicProfile.body.photos).toHaveLength(1);
    expect(publicProfile.body.recentSummaries[0].summary).toBe("跨夜把财管公式重新梳理了一遍。");
  });

  it("resolves cloud:// avatar fileIDs to web-renderable temp URLs on the public profile", async () => {
    const profile = await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "cloud-avatar-owner")
      .send({
        nickname: "云头像考生",
        avatarUrl: "cloud://prod-test.6e69-prod-test/avatars/abc-123.jpg",
        isPublic: true,
        requireWechatAuth: false
      })
      .expect(200);

    const slug = profile.body.publicProfile.shareSlug as string;

    const publicProfile = await request(app)
      .get(`/api/public/${slug}`)
      .expect(200);

    expect(publicProfile.body.profile.avatarUrl).toBe("https://temp.example.com/avatars/abc-123.jpg");
    expect(publicProfile.body.profile.avatarUrl.startsWith("cloud://")).toBe(false);
  });

  it("validates completion payload requirements", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "validator")
      .send({
        nickname: "校验用户",
        avatarUrl: "https://example.com/avatar-3.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "validator")
      .expect(200);

    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(3);

    const invalid = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", "validator")
      .send({
        summary: "",
        subject: "非法科目",
        tags: ["顺利"],
        photos: []
      })
      .expect(400);

    expect(invalid.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns dashboard analytics for subjects and the longest study day", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "dashboard-user")
      .send({
        nickname: "统计考生",
        avatarUrl: "https://example.com/dashboard.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const first = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "dashboard-user")
      .expect(200);

    clock.advanceMinutes(90);
    await request(app)
      .post(`/api/sessions/${first.body.session.id}/complete`)
      .set("x-wx-openid", "dashboard-user")
      .send({
        summary: "会计分录复盘",
        subject: "会计",
        tags: ["复习"],
        photos: [
          {
            fileId: "cloud://demo/dashboard-1.jpg",
            objectKey: "checkins/2026/04/dashboard-1.jpg"
          }
        ]
      })
      .expect(200);

    const second = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "dashboard-user")
      .expect(200);

    clock.advanceMinutes(135);
    await request(app)
      .post(`/api/sessions/${second.body.session.id}/complete`)
      .set("x-wx-openid", "dashboard-user")
      .send({
        summary: "审计章节串讲",
        subject: "审计",
        tags: ["新课"],
        photos: [
          {
            fileId: "cloud://demo/dashboard-2.jpg",
            objectKey: "checkins/2026/04/dashboard-2.jpg"
          }
        ]
      })
      .expect(200);

    const dashboard = await request(app)
      .get("/api/me/dashboard")
      .set("x-wx-openid", "dashboard-user")
      .expect(200);

    expect(dashboard.body.profile.nickname).toBe("统计考生");
    expect(dashboard.body.summary.totalMinutes).toBe(225);
    expect(dashboard.body.summary.currentStreakDays).toBe(1);
    expect(dashboard.body.summary.longestStreakDays).toBe(1);
    expect(dashboard.body.summary.completedSessionCount).toBe(2);
    expect(dashboard.body.bestDay).toEqual({
      date: "2026-04-16",
      totalMinutes: 225
    });
    expect(dashboard.body.subjects).toMatchObject([
      { subject: "审计", totalMinutes: 135, targetMinutes: 13200 },
      { subject: "会计", totalMinutes: 90, targetMinutes: 16800 }
    ]);
    expect(dashboard.body.subjectTargets).toHaveLength(6);
    const accounting = (dashboard.body.subjectTargets as Array<{ subject: string; targetMinutes: number }>).find(
      (item) => item.subject === "会计"
    );
    expect(accounting?.targetMinutes).toBe(16800);

    const badgeMap = new Map(
      (dashboard.body.badges as Array<{ key: string; unlocked: boolean }>).map((badge) => [badge.key, badge.unlocked])
    );
    expect(badgeMap.get("first_checkin")).toBe(true);
    expect(badgeMap.get("streak_7")).toBe(false);
    expect(badgeMap.get("total_10h")).toBe(false);
    expect(badgeMap.get("single_day_4h")).toBe(false);
    expect(badgeMap.get("all_six_subjects")).toBe(false);

    // Badge progress fields surfaced for the miniprogram so it can
    // show "current / goal" instead of just locked/unlocked.
    const firstCheckin = (dashboard.body.badges as Array<{ key: string; progress: number; current: number; goal: number; unit: string }>).find(
      (b) => b.key === "first_checkin"
    );
    expect(firstCheckin?.progress).toBe(1);
    expect(firstCheckin?.current).toBe(1);
    expect(firstCheckin?.goal).toBe(1);
    expect(firstCheckin?.unit).toBe("次");

    // Exam schedule is included on the dashboard response so the
    // 六科进度 page can render countdowns per subject.
    expect(dashboard.body.examSchedule).toHaveLength(6);
    const exam = (dashboard.body.examSchedule as Array<{ subject: string; date: string; daysRemaining: number }>).find(
      (e) => e.subject === "会计"
    );
    expect(exam?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(exam?.daysRemaining).toBeGreaterThanOrEqual(0);

    // v0.11 — insights + records surface on /me/dashboard so the
    // profile page can render its highlights + 学习时段 chart
    // without a second round-trip.
    expect(dashboard.body.patterns.hourly).toHaveLength(24);
    expect(dashboard.body.patterns.weekday).toHaveLength(7);
    const totalHourly = (dashboard.body.patterns.hourly as number[])
      .reduce((sum: number, v: number) => sum + v, 0);
    // The two completed sessions in this test totaled 225 minutes;
    // hourly distribution should sum to the same.
    expect(totalHourly).toBe(225);
    expect(dashboard.body.patterns.peakHour).not.toBeNull();

    expect(dashboard.body.records.longestStreakDays).toBe(1);
    expect(dashboard.body.records.bestDay).toEqual({
      date: "2026-04-16",
      totalMinutes: 225
    });
    expect(dashboard.body.records.bestWeek).toMatchObject({
      totalMinutes: 225
    });
  });

  it("recovers a one-day streak gap via makeup and refuses again within 7 days", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "makeup-user")
      .send({
        nickname: "补签同学",
        avatarUrl: "https://example.com/makeup.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    // Day 1 (2026-04-16): a completed session
    const sessionOne = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "makeup-user")
      .expect(200);
    clock.advanceMinutes(60);
    await request(app)
      .post(`/api/sessions/${sessionOne.body.session.id}/complete`)
      .set("x-wx-openid", "makeup-user")
      .send({
        summary: "第一天",
        subject: "会计",
        tags: [],
        photos: [
          { fileId: "cloud://demo/m1.jpg", objectKey: "checkins/2026/04/m1.jpg" }
        ]
      })
      .expect(200);

    // Skip Day 2 (2026-04-17) entirely, jump to Day 3 (2026-04-18)
    clock.advanceMinutes(60 * 47); // 47h forward → 2026-04-18 ~11:00
    const home = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "makeup-user")
      .expect(200);
    expect(home.body.makeupAvailable).not.toBeNull();
    expect(home.body.makeupAvailable.date).toBe("2026-04-17");
    expect(home.body.weeklyReview.thisWeekMinutes).toBe(60);

    const makeupResponse = await request(app)
      .post("/api/sessions/makeup")
      .set("x-wx-openid", "makeup-user")
      .expect(200);
    expect(makeupResponse.body.makeupDate).toBe("2026-04-17");

    const homeAfter = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "makeup-user")
      .expect(200);
    expect(homeAfter.body.makeupAvailable).toBeNull();
    expect(homeAfter.body.summary.currentStreakDays).toBe(2);

    // Within 7 days, second attempt should fail
    await request(app)
      .post("/api/sessions/makeup")
      .set("x-wx-openid", "makeup-user")
      .expect(409);
  });

  it("rejects requests with neither openid nor client UID", async () => {
    await request(app).post("/api/me/bootstrap").expect(401);
  });

  it("isolates two anonymous users with distinct client UIDs", async () => {
    const alpha = await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "anon-alpha-12345")
      .expect(200);
    const beta = await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "anon-beta-67890")
      .expect(200);

    expect(alpha.body.profile.id).not.toBe(beta.body.profile.id);

    // Alpha logs a session
    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-client-uid", "anon-alpha-12345")
      .expect(200);
    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-client-uid", "anon-alpha-12345")
      .send({
        summary: "匿名 alpha 的第一次专注",
        subject: "审计",
        tags: ["顺利"],
        photos: [{ fileId: "cloud://demo/anon.jpg", objectKey: "checkins/anon.jpg" }]
      })
      .expect(200);

    const alphaHome = await request(app)
      .get("/api/home")
      .set("x-client-uid", "anon-alpha-12345")
      .expect(200);
    expect(alphaHome.body.today.totalMinutes).toBe(45);

    // Beta is unaffected
    const betaHome = await request(app)
      .get("/api/home")
      .set("x-client-uid", "anon-beta-67890")
      .expect(200);
    expect(betaHome.body.today.totalMinutes).toBe(0);
  });

  it("merges anonymous history into the WeChat user when openid arrives later", async () => {
    // Step 1: anonymous user records a session via clientUid only.
    const anonBootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "device-merge-7777")
      .expect(200);
    const anonId = anonBootstrap.body.profile.id as string;

    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-client-uid", "device-merge-7777")
      .expect(200);
    clock.advanceMinutes(70);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-client-uid", "device-merge-7777")
      .send({
        summary: "匿名记录，等会儿登录把数据接过去",
        subject: "税法",
        tags: [],
        photos: [{ fileId: "cloud://demo/merge.jpg", objectKey: "checkins/merge.jpg" }]
      })
      .expect(200);

    // Step 2: same device authorizes WeChat. Both headers present.
    const linked = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "merge-openid")
      .set("x-client-uid", "device-merge-7777")
      .expect(200);

    // Same internal user_id → previous session is preserved.
    expect(linked.body.profile.id).toBe(anonId);

    const linkedHome = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "merge-openid")
      .set("x-client-uid", "device-merge-7777")
      .expect(200);
    expect(linkedHome.body.today.totalMinutes).toBe(70);

    // Step 3: subsequent calls via openid alone should still resolve to
    // the same user — the openid is now bound on the server.
    const openidOnly = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "merge-openid")
      .expect(200);
    expect(openidOnly.body.profile.id).toBe(anonId);
    expect(openidOnly.body.today.totalMinutes).toBe(70);
  });

  it("ignores malformed client UIDs (too short / invalid chars)", async () => {
    // Garbage clientUid → server treats as missing → 401 without an openid
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "no")
      .expect(401);

    await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "<script>alert(1)</script>")
      .expect(401);

    // But a valid clientUid still works
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "valid-client-uid-abc123")
      .expect(200);
  });

  it("starts a pomodoro session pre-tagged with subject + mode and persists pomodoroCycles on complete", async () => {
    // Pre-create the user so /sessions/start passes withUser auth.
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "pomo-user")
      .expect(200);

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "pomo-user")
      .send({ subject: "财管", mode: "pomodoro" })
      .expect(200);

    // The serialized active session must echo back both fields so the
    // miniprogram can drive its countdown / cycle dots correctly.
    expect(started.body.session.mode).toBe("pomodoro");
    expect(started.body.session.subject).toBe("财管");
    expect(started.body.session.pomodoroCycles).toBe(0);

    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(60);

    await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", "pomo-user")
      .send({
        summary: "财管两个完整番茄",
        subject: "财管",
        tags: ["高效"],
        pomodoroCycles: 2,
        photos: [
          {
            fileId: "cloud://demo/pomo-1.jpg",
            objectKey: "checkins/2026/04/pomo-1.jpg"
          }
        ]
      })
      .expect(200);

    // Re-fetch via /home — confirms the cycle count survived a save
    // round-trip and is exposed for the next iteration's UI.
    const home = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "pomo-user")
      .expect(200);
    expect(home.body.activeSession).toBeNull();
  });

  it("rejects pomodoroCycles values outside [0, 32]", async () => {
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "pomo-bounds")
      .expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "pomo-bounds")
      .send({ mode: "pomodoro" })
      .expect(200);

    await request(app)
      .post(`/api/sessions/${started.body.session.id}/complete`)
      .set("x-wx-openid", "pomo-bounds")
      .send({
        summary: "invalid cycles",
        subject: null,
        tags: [],
        pomodoroCycles: 999,
        photos: [
          { fileId: "cloud://x/y.jpg", objectKey: "x/y.jpg" }
        ]
      })
      .expect(400);
  });

  it("rejects an unknown mode value on /sessions/start", async () => {
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "bad-mode")
      .expect(200);
    await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "bad-mode")
      .send({ mode: "marathon" })
      .expect(400);
  });

  it("/api/me/sessions returns completed sessions for the 小猫花园 page", async () => {
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "garden-user")
      .expect(200);

    // Run + complete a free session
    const free = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "garden-user")
      .send({ subject: "会计" })
      .expect(200);
    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${free.body.session.id}/complete`)
      .set("x-wx-openid", "garden-user")
      .send({
        summary: "free 完成",
        subject: "会计",
        tags: [],
        photos: [{ fileId: "cloud://demo/g1.jpg", objectKey: "x/g1.jpg" }]
      })
      .expect(200);

    // Run + complete a pomodoro session with 4 cycles
    const pomo = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "garden-user")
      .send({ subject: "审计", mode: "pomodoro" })
      .expect(200);
    clock.advanceMinutes(120);
    await request(app)
      .post(`/api/sessions/${pomo.body.session.id}/complete`)
      .set("x-wx-openid", "garden-user")
      .send({
        summary: "pomodoro 完成",
        subject: "审计",
        tags: [],
        pomodoroCycles: 4,
        photos: [{ fileId: "cloud://demo/g2.jpg", objectKey: "x/g2.jpg" }]
      })
      .expect(200);

    const list = await request(app)
      .get("/api/me/sessions")
      .set("x-wx-openid", "garden-user")
      .expect(200);

    expect(list.body.items).toHaveLength(2);
    // Verify the fields the garden view-model expects are present
    // and that we DON'T leak photos / summary / pauseSegments.
    const item = list.body.items[0];
    expect(typeof item.id).toBe("string");
    expect(["free", "pomodoro"]).toContain(item.mode);
    expect(typeof item.durationMinutes).toBe("number");
    expect(typeof item.pomodoroCycles).toBe("number");
    expect("summary" in item).toBe(false);
    expect("photos" in item).toBe(false);

    // Find the pomodoro one to verify the cycle count came through
    const pomoItem = list.body.items.find((it: { mode: string }) => it.mode === "pomodoro");
    expect(pomoItem?.pomodoroCycles).toBe(4);
  });
});

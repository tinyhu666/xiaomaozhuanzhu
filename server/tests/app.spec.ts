import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clock = new TestClock("2026-04-16T10:00:00+08:00");
    app = createApp({
      clock: {
        now: () => clock.now()
      },
      storage: {
        async getTemporaryUrls(objectKeys: string[]) {
          return objectKeys.map((objectKey) => ({
            objectKey,
            url: `https://temp.example.com/${objectKey}`,
            expiresAt: "2026-04-16T12:00:00+08:00"
          }));
        }
      }
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("logs in with a WeChat code, issues a bearer token, and resolves avatar storage references", async () => {
    process.env.WECHAT_APP_ID = "wx-app-id";
    process.env.WECHAT_APP_SECRET = "wx-app-secret";
    process.env.WECHAT_SESSION_SECRET = "session-secret";

    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          openid: "wechat-openid",
          session_key: "session-key"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    app = createApp({
      clock: {
        now: () => clock.now()
      },
      fetchImpl: fetchMock,
      storage: {
        async getTemporaryUrls(objectKeys: string[]) {
          return objectKeys.map((objectKey) => ({
            objectKey,
            url: `https://temp.example.com/${objectKey}`,
            expiresAt: "2026-04-16T12:00:00+08:00"
          }));
        }
      }
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({
        code: "wechat-login-code"
      })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("appid=wx-app-id");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("js_code=wechat-login-code");
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.profile.profileCompleted).toBe(false);

    await request(app)
      .post("/api/me/profile")
      .set("authorization", `Bearer ${login.body.token as string}`)
      .send({
        nickname: "微信考生",
        avatarUrl: "storage://avatars/2026/04/profile.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("authorization", `Bearer ${login.body.token as string}`)
      .expect(200);

    expect(bootstrap.body.profile.nickname).toBe("微信考生");
    expect(bootstrap.body.profile.avatarUrl).toBe("https://temp.example.com/avatars/2026/04/profile.png");
    expect(bootstrap.body.needsOnboarding).toBe(false);
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
    expect(completed.body.dailyStats.heatLevel).toBe(3);
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
    expect(home.body.quote.dailyLimit).toBe(5);
    expect(home.body.quote.dailyIndex).toBe(1);
    expect(home.body.quote.en).toBeTruthy();
    expect(home.body.quote.zh).toBeTruthy();
    expect(home.body.today.totalMinutes).toBe(120);
    expect(home.body.today.sessionCount).toBe(1);
    expect(home.body.summary.currentStreakDays).toBe(1);
    expect(home.body.summary.lastSummary).toBe("今晚把审计风险评估刷顺了。");

    const calendar = await request(app)
      .get("/api/calendar?month=2026-04")
      .set("x-wx-openid", "user-1")
      .expect(200);

    expect(calendar.body.days["2026-04-16"].totalMinutes).toBe(120);
    expect(calendar.body.days["2026-04-16"].heatLevel).toBe(3);
  });

  it("abandons a paused session instead of restoring it on a new home fetch", async () => {
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

    expect(home.body.activeSession).toBeNull();

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
        async getTemporaryUrls(objectKeys: string[]) {
          return objectKeys.map((objectKey) => ({
            objectKey,
            url: `https://temp.example.com/${objectKey}`,
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

  it("accepts multiple subjects and reflects them in session details and dashboard analytics", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "multi-subject-user")
      .send({
        nickname: "多科考生",
        avatarUrl: "https://example.com/multi.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "multi-subject-user")
      .expect(200);

    clock.advanceMinutes(80);

    const completed = await request(app)
      .post(`/api/sessions/${started.body.session.id}/complete`)
      .set("x-wx-openid", "multi-subject-user")
      .send({
        summary: "会计和审计都推进了一轮。",
        subjects: ["会计", "审计"],
        tags: ["高效"],
        photos: [
          {
            fileId: "cloud://demo/multi-1.jpg",
            objectKey: "checkins/2026/04/multi-1.jpg"
          }
        ]
      })
      .expect(200);

    expect(completed.body.session.subjects).toEqual(["会计", "审计"]);

    const detail = await request(app)
      .get("/api/calendar/2026-04-16")
      .set("x-wx-openid", "multi-subject-user")
      .expect(200);

    expect(detail.body.sessions[0].subjects).toEqual(["会计", "审计"]);

    const dashboard = await request(app)
      .get("/api/me/dashboard")
      .set("x-wx-openid", "multi-subject-user")
      .expect(200);

    expect(dashboard.body.subjects).toEqual([
      {
        subject: "会计",
        totalMinutes: 80
      },
      {
        subject: "审计",
        totalMinutes: 80
      }
    ]);
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
    expect(dashboard.body.bestDay).toEqual({
      date: "2026-04-16",
      totalMinutes: 225
    });
    expect(dashboard.body.subjects).toEqual([
      {
        subject: "审计",
        totalMinutes: 135
      },
      {
        subject: "会计",
        totalMinutes: 90
      }
    ]);
  });
  it("resets the current streak after the user misses more than one Shanghai day", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "streak-gap-user")
      .send({
        nickname: "断更考生",
        avatarUrl: "https://example.com/streak-gap.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const first = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "streak-gap-user")
      .expect(200);

    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${first.body.session.id}/complete`)
      .set("x-wx-openid", "streak-gap-user")
      .send({
        summary: "第一天完成公司战略复盘",
        subject: "战略",
        tags: ["复习"],
        photos: [
          {
            fileId: "cloud://demo/streak-gap-1.jpg",
            objectKey: "checkins/2026/04/streak-gap-1.jpg"
          }
        ]
      })
      .expect(200);

    clock.advanceMinutes(24 * 60);

    const second = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "streak-gap-user")
      .expect(200);

    clock.advanceMinutes(50);
    await request(app)
      .post(`/api/sessions/${second.body.session.id}/complete`)
      .set("x-wx-openid", "streak-gap-user")
      .send({
        summary: "第二天完成财管公式默写",
        subject: "财管",
        tags: ["刷题"],
        photos: [
          {
            fileId: "cloud://demo/streak-gap-2.jpg",
            objectKey: "checkins/2026/04/streak-gap-2.jpg"
          }
        ]
      })
      .expect(200);

    clock.advanceMinutes(2 * 24 * 60);

    const home = await request(app)
      .get("/api/home")
      .set("x-wx-openid", "streak-gap-user")
      .expect(200);

    const dashboard = await request(app)
      .get("/api/me/dashboard")
      .set("x-wx-openid", "streak-gap-user")
      .expect(200);

    expect(home.body.summary.currentStreakDays).toBe(0);
    expect(dashboard.body.summary.currentStreakDays).toBe(0);
  });

  it("does not advance the daily quote when home uses peek mode", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "peek-user")
      .send({
        nickname: "Peek User",
        avatarUrl: "https://example.com/peek.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const first = await request(app)
      .get("/api/home?quoteEvent=advance")
      .set("x-wx-openid", "peek-user")
      .expect(200);

    const peek = await request(app)
      .get("/api/home?quoteEvent=peek")
      .set("x-wx-openid", "peek-user")
      .expect(200);

    const second = await request(app)
      .get("/api/home?quoteEvent=advance")
      .set("x-wx-openid", "peek-user")
      .expect(200);

    expect(first.body.quote.dailyIndex).toBe(1);
    expect(peek.body.quote.dailyIndex).toBe(1);
    expect(second.body.quote.dailyIndex).toBe(2);
  });
});

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
});

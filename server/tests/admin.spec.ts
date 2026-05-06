import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

class TestClock {
  private current: Date;
  constructor(value: string) { this.current = new Date(value); }
  now() { return new Date(this.current); }
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
  advanceDays(days: number) {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60_000);
  }
}

const ADMIN_TOKEN = "test-admin-token-9c1f";

describe("Admin dashboard", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    clock = new TestClock("2026-04-16T10:00:00+08:00");
    app = createApp({
      clock: { now: () => clock.now() },
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

  afterEach(() => {
    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });

  it("serves the admin SPA shell at /admin/ unauthenticated", async () => {
    const res = await request(app).get("/admin/").expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("管理后台");
    expect(res.text).toContain("ADMIN_TOKEN");
  });

  it("rejects /admin/api requests without a token", async () => {
    await request(app).get("/admin/api/users").expect(401);
    await request(app).get("/admin/api/stats").expect(401);
  });

  it("rejects /admin/api requests with the wrong token", async () => {
    await request(app)
      .get("/admin/api/users")
      .set("authorization", "Bearer wrong-token")
      .expect(401);
  });

  it("returns 503 when ADMIN_TOKEN env var is missing", async () => {
    delete process.env.ADMIN_TOKEN;
    const localApp = createApp({ clock: { now: () => clock.now() } });
    await request(localApp)
      .get("/admin/api/users")
      .set("authorization", "Bearer anything")
      .expect(503);
  });

  it("lists all users sorted by recent activity, with aggregates", async () => {
    // User A: created earlier, completed a 90-min session
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "alpha")
      .send({ nickname: "Alpha", avatarUrl: "https://example.com/a.png" })
      .expect(200);
    const sA = await request(app).post("/api/sessions/start").set("x-wx-openid", "alpha").expect(200);
    clock.advanceMinutes(90);
    await request(app)
      .post(`/api/sessions/${sA.body.session.id}/complete`)
      .set("x-wx-openid", "alpha")
      .send({
        summary: "alpha 的第一次专注",
        subject: "审计",
        tags: ["顺利"],
        photos: [{ fileId: "cloud://demo/a.jpg", objectKey: "checkins/a.jpg" }]
      })
      .expect(200);

    // User B: anonymous, no sessions
    clock.advanceMinutes(30);
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-client-uid", "beta-anon-12345")
      .expect(200);

    const list = await request(app)
      .get("/admin/api/users")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(list.body.users).toHaveLength(2);
    // Sorted by lastLoginAt desc, so beta (just bootstrapped) is first.
    const [first, second] = list.body.users;
    expect(first.clientUid).toBe("beta-anon-12345");
    expect(first.totalMinutes).toBe(0);
    expect(first.openid).toBeNull();
    expect(second.openid).toBe("alpha");
    expect(second.nickname).toBe("Alpha");
    expect(second.totalMinutes).toBe(90);
    expect(second.completedSessions).toBe(1);
    expect(second.currentStreakDays).toBe(1);
  });

  it("returns global stats with weekly active count", async () => {
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "stats-user")
      .expect(200);
    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "stats-user")
      .expect(200);
    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-wx-openid", "stats-user")
      .send({
        summary: "stats",
        subject: "会计",
        tags: [],
        photos: [{ fileId: "cloud://demo/s.jpg", objectKey: "checkins/s.jpg" }]
      })
      .expect(200);

    const stats = await request(app)
      .get("/admin/api/stats")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(stats.body).toMatchObject({
      totalUsers: 1,
      activeWithSessions: 1,
      activeWeekly: 1,
      totalMinutes: 45,
      totalSessions: 1
    });
  });

  it("returns full user detail with sessions, stats, and resolved photo URLs", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "detail-user")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "detail-user")
      .expect(200);
    clock.advanceMinutes(75);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-wx-openid", "detail-user")
      .send({
        summary: "复盘审计风险评估",
        subject: "审计",
        tags: ["复习", "顺利"],
        photos: [
          { fileId: "cloud://demo/d1.jpg", objectKey: "checkins/d1.jpg" },
          { fileId: "cloud://demo/d2.jpg", objectKey: "checkins/d2.jpg" }
        ]
      })
      .expect(200);

    const detail = await request(app)
      .get(`/admin/api/users/${userId}`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(detail.body.user.id).toBe(userId);
    expect(detail.body.user.openid).toBe("detail-user");
    expect(detail.body.summary.totalMinutes).toBe(75);
    expect(detail.body.summary.completedSessions).toBe(1);
    expect(detail.body.dailyStats).toHaveLength(1);

    const completedSessions = detail.body.sessions.filter((s: { status: string }) => s.status === "completed");
    expect(completedSessions).toHaveLength(1);
    expect(completedSessions[0].subject).toBe("审计");
    expect(completedSessions[0].tags).toEqual(["复习", "顺利"]);
    expect(completedSessions[0].photos).toHaveLength(2);
    expect(completedSessions[0].photos[0].url).toContain("https://temp.example.com/");
  });

  it("returns 404 for an unknown user id", async () => {
    await request(app)
      .get("/admin/api/users/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(404);
  });
});

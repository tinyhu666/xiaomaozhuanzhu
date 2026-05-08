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
    // Photos are now exposed as same-origin signed proxy URLs.
    expect(completedSessions[0].photos[0].url).toMatch(/^\/admin\/api\/photos\/proxy\?fileId=/);
  });

  it("returns 404 for an unknown user id", async () => {
    await request(app)
      .get("/admin/api/users/00000000-0000-0000-0000-000000000000")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(404);
  });

  it("supports setting and clearing an admin remark on a user", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "remark-target")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    // Initially no remark.
    const initial = await request(app)
      .get(`/admin/api/users/${userId}`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);
    expect(initial.body.user.adminRemark).toBe("");

    // Set a remark.
    const set = await request(app)
      .patch(`/admin/api/users/${userId}/remark`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ remark: "重要客户：李总" })
      .expect(200);
    expect(set.body.user.adminRemark).toBe("重要客户：李总");

    // Round-trip: detail endpoint reflects it.
    const after = await request(app)
      .get(`/admin/api/users/${userId}`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);
    expect(after.body.user.adminRemark).toBe("重要客户：李总");

    // Listing endpoint includes the remark too.
    const list = await request(app)
      .get("/admin/api/users")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);
    const target = list.body.users.find((row: { id: string }) => row.id === userId);
    expect(target.adminRemark).toBe("重要客户：李总");

    // Clearing: empty string is allowed and trimmed.
    const cleared = await request(app)
      .patch(`/admin/api/users/${userId}/remark`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ remark: "   " })
      .expect(200);
    expect(cleared.body.user.adminRemark).toBe("");
  });

  it("rejects bad remark payloads", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "remark-target-2")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    // > 60 chars
    await request(app)
      .patch(`/admin/api/users/${userId}/remark`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ remark: "a".repeat(61) })
      .expect(400);

    // not a string
    await request(app)
      .patch(`/admin/api/users/${userId}/remark`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ remark: 12345 })
      .expect(400);

    // unknown user
    await request(app)
      .patch("/admin/api/users/00000000-0000-0000-0000-000000000000/remark")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ remark: "x" })
      .expect(404);

    // unauthorized
    await request(app)
      .patch(`/admin/api/users/${userId}/remark`)
      .send({ remark: "x" })
      .expect(401);
  });

  it("returns recent completed sessions across users in reverse chronological order", async () => {
    // user-1 logs a session
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "rec-1")
      .send({ nickname: "Recent One", avatarUrl: "https://example.com/r1.png" })
      .expect(200);
    const s1 = await request(app).post("/api/sessions/start").set("x-wx-openid", "rec-1").expect(200);
    clock.advanceMinutes(40);
    await request(app)
      .post(`/api/sessions/${s1.body.session.id}/complete`)
      .set("x-wx-openid", "rec-1")
      .send({
        summary: "rec1",
        subject: "会计",
        tags: ["顺利"],
        photos: [{ fileId: "cloud://demo/r1.jpg", objectKey: "checkins/r1.jpg" }]
      })
      .expect(200);

    // user-2 logs a session a few minutes later
    clock.advanceMinutes(10);
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "rec-2")
      .send({ nickname: "Recent Two", avatarUrl: "https://example.com/r2.png" })
      .expect(200);
    const s2 = await request(app).post("/api/sessions/start").set("x-wx-openid", "rec-2").expect(200);
    clock.advanceMinutes(60);
    await request(app)
      .post(`/api/sessions/${s2.body.session.id}/complete`)
      .set("x-wx-openid", "rec-2")
      .send({
        summary: "rec2",
        subject: "审计",
        tags: ["复习"],
        photos: [{ fileId: "cloud://demo/r2.jpg", objectKey: "checkins/r2.jpg" }]
      })
      .expect(200);

    const recent = await request(app)
      .get("/admin/api/recent-sessions?limit=10")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(recent.body.items).toHaveLength(2);
    // Most recent first.
    expect(recent.body.items[0].nickname).toBe("Recent Two");
    expect(recent.body.items[0].subject).toBe("审计");
    expect(recent.body.items[0].identityKind).toBe("wechat");
    expect(recent.body.items[1].nickname).toBe("Recent One");
  });

  it("exports a CSV of all users with proper UTF-8 BOM and quoting", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "csv-1")
      .send({ nickname: '需要"引号"的人', avatarUrl: "https://example.com/c.png" })
      .expect(200);

    const res = await request(app)
      .get("/admin/api/export/users.csv")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    // BOM (3 bytes for UTF-8) at start so Excel detects encoding.
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    // Quoted nickname with escaped inner quotes.
    expect(res.text).toContain('"需要""引号""的人"');
    // Header row present.
    expect(res.text).toContain("user_id,nickname,openid,client_uid");
  });

  it("exports per-user session CSV", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "csv-sessions")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "csv-sessions")
      .expect(200);
    clock.advanceMinutes(50);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-wx-openid", "csv-sessions")
      .send({
        summary: "exported",
        subject: "税法",
        tags: ["顺利", "新课"],
        photos: [{ fileId: "cloud://demo/x.jpg", objectKey: "checkins/x.jpg" }]
      })
      .expect(200);

    const res = await request(app)
      .get(`/admin/api/export/users/${userId}/sessions.csv`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("session_id,status,started_at");
    expect(res.text).toContain("税法");
    // Pipe-joined tags survive the round-trip.
    expect(res.text).toContain("顺利|新课");
  });

  it("returns same-origin signed photo URLs in user detail", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "photo-user")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    const session = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "photo-user")
      .expect(200);
    clock.advanceMinutes(30);
    await request(app)
      .post(`/api/sessions/${session.body.session.id}/complete`)
      .set("x-wx-openid", "photo-user")
      .send({
        summary: "with photos",
        subject: "财管",
        tags: [],
        photos: [{ fileId: "cloud://demo/p1.jpg", objectKey: "checkins/p1.jpg" }]
      })
      .expect(200);

    const detail = await request(app)
      .get(`/admin/api/users/${userId}`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    const completed = detail.body.sessions.find((x: { status: string }) => x.status === "completed");
    expect(completed.photos).toHaveLength(1);
    const photoUrl: string = completed.photos[0].url;
    // Same-origin signed URL, not a raw upstream URL.
    expect(photoUrl).toMatch(/^\/admin\/api\/photos\/proxy\?fileId=/);
    expect(photoUrl).toContain("&exp=");
    expect(photoUrl).toContain("&sig=");
  });

  it("rejects photo proxy requests with missing or bad signatures", async () => {
    // No params at all
    await request(app).get("/admin/api/photos/proxy").expect(400);
    // Missing sig
    await request(app)
      .get("/admin/api/photos/proxy?fileId=cloud://demo/x.jpg&exp=99999999999")
      .expect(400);
    // Bad sig
    await request(app)
      .get("/admin/api/photos/proxy?fileId=cloud://demo/x.jpg&exp=99999999999&sig=deadbeef")
      .expect(403);
  });

  it("rejects expired photo proxy signatures", async () => {
    // Build an expired signature manually using the same algorithm
    const { createHmac } = await import("node:crypto");
    const fileId = "cloud://demo/old.jpg";
    const exp = Math.floor(Date.now() / 1000) - 60; // already past
    const sig = createHmac("sha256", ADMIN_TOKEN).update(`${fileId}:${exp}`).digest("hex");
    await request(app)
      .get(`/admin/api/photos/proxy?fileId=${encodeURIComponent(fileId)}&exp=${exp}&sig=${sig}`)
      .expect(410);
  });

  it("returns an inline SVG placeholder when the storage backend is the default fallback", async () => {
    // Build a valid signature against a fileId that the default storage
    // client will resolve to an unreachable temp.example.com URL.
    const { createHmac } = await import("node:crypto");
    const fileId = "cloud://demo/missing.jpg";
    const exp = Math.floor(Date.now() / 1000) + 600;
    const sig = createHmac("sha256", ADMIN_TOKEN).update(`${fileId}:${exp}`).digest("hex");

    // Re-create app without the test storage stub so it falls back to
    // the default placeholder client.
    delete process.env.WECHAT_OPENAPI_INTERNAL;
    delete process.env.WECHAT_CLOUD_ENV;
    const fallbackApp = createApp({ clock: { now: () => clock.now() } });

    const res = await request(fallbackApp)
      .get(`/admin/api/photos/proxy?fileId=${encodeURIComponent(fileId)}&exp=${exp}&sig=${sig}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks).toString("utf-8")));
      })
      .expect(200);

    expect(res.headers["content-type"]).toContain("image/svg+xml");
    const body = String(res.body);
    expect(body).toContain("<svg");
    expect(body).toContain("图片暂不可用");
    // Hint visible to user: missing OpenAPI env or unresolvable.
    expect(body).toMatch(/未配置 WeChat OpenAPI|无法解析 fileId/);
  });

  it("exposes a /diag endpoint reporting storage mode + env flags", async () => {
    const res = await request(app)
      .get("/admin/api/diag")
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body).toHaveProperty("storageMode");
    expect(res.body).toHaveProperty("envFlags");
    expect(res.body).toHaveProperty("probe");
    // envFlags should report booleans / null only, never raw values.
    expect(typeof res.body.envFlags.ADMIN_TOKEN).toBe("boolean");
    expect(res.body.envFlags.ADMIN_TOKEN).toBe(true);
    // No raw secret leakage.
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_TOKEN);
  });

  it("exposes subject + tag breakdown on the user detail endpoint", async () => {
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "breakdown")
      .expect(200);
    const userId = bootstrap.body.profile.id;

    // Two sessions, different subjects + overlapping tags
    const a = await request(app).post("/api/sessions/start").set("x-wx-openid", "breakdown").expect(200);
    clock.advanceMinutes(60);
    await request(app)
      .post(`/api/sessions/${a.body.session.id}/complete`)
      .set("x-wx-openid", "breakdown")
      .send({
        summary: "a",
        subject: "会计",
        tags: ["顺利"],
        photos: [{ fileId: "cloud://demo/a.jpg", objectKey: "checkins/a.jpg" }]
      })
      .expect(200);

    clock.advanceMinutes(30);
    const b = await request(app).post("/api/sessions/start").set("x-wx-openid", "breakdown").expect(200);
    clock.advanceMinutes(45);
    await request(app)
      .post(`/api/sessions/${b.body.session.id}/complete`)
      .set("x-wx-openid", "breakdown")
      .send({
        summary: "b",
        subject: "会计",
        tags: ["顺利", "复习"],
        photos: [{ fileId: "cloud://demo/b.jpg", objectKey: "checkins/b.jpg" }]
      })
      .expect(200);

    const res = await request(app)
      .get(`/admin/api/users/${userId}`)
      .set("authorization", `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.breakdown.subjects).toEqual([
      { subject: "会计", totalMinutes: 105, count: 2 }
    ]);
    expect(res.body.breakdown.tags).toEqual([
      { tag: "顺利", count: 2 },
      { tag: "复习", count: 1 }
    ]);
  });
});

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("admin console", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;
  let originalAdminPassword: string | undefined;
  let originalAdminSessionSecret: string | undefined;

  beforeEach(() => {
    originalAdminPassword = process.env.ADMIN_PASSWORD;
    originalAdminSessionSecret = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = "secret-admin";
    process.env.ADMIN_SESSION_SECRET = "secret-session";

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
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    }

    if (originalAdminSessionSecret === undefined) {
      delete process.env.ADMIN_SESSION_SECRET;
    } else {
      process.env.ADMIN_SESSION_SECRET = originalAdminSessionSecret;
    }
  });

  it("redirects unauthenticated dashboard requests to the admin login page", async () => {
    const response = await request(app).get("/admin").expect(302);

    expect(response.headers.location).toBe("/admin/login");
  });

  it("renders the admin login page and rejects an invalid password", async () => {
    const loginPage = await request(app).get("/admin/login").expect(200);
    expect(loginPage.text).toContain("管理员登录");

    const invalid = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ password: "wrong-password" })
      .expect(401);

    expect(invalid.text).toContain("密码错误");
  });

  it("renders the user-first dashboard with a selected user's recent uploads after login", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "admin-user-1")
      .send({
        nickname: "后台查看用户",
        avatarUrl: "https://example.com/admin-user-1.png",
        isPublic: true,
        requireWechatAuth: true
      })
      .expect(200);

    const sessionStarted = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "admin-user-1")
      .expect(200);

    clock.advanceMinutes(40);

    await request(app)
      .post(`/api/sessions/${sessionStarted.body.session.id}/complete`)
      .set("x-wx-openid", "admin-user-1")
      .send({
        summary: "管理后台测试打卡记录",
        subject: "会计",
        tags: ["复习"],
        photos: [
          {
            fileId: "cloud://demo/admin-photo-1.jpg",
            objectKey: "checkins/2026/04/admin-photo-1.jpg"
          }
        ]
      })
      .expect(200);

    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "admin-user-2")
      .send({
        nickname: "另一个用户",
        avatarUrl: "https://example.com/admin-user-2.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const login = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ password: "secret-admin" })
      .expect(302);

    const cookie = login.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const dashboard = await request(app)
      .get("/admin?user=admin-user-1")
      .set("Cookie", cookie)
      .expect(200);

    expect(dashboard.text).toContain("后台查看用户");
    expect(dashboard.text).toContain("近 7 天");
    expect(dashboard.text).toContain("管理后台测试打卡记录");
    expect(dashboard.text).toContain("checkins/2026/04/admin-photo-1.jpg");
    expect(dashboard.text).toContain("最近打卡日期");
  });

  it("renders the auxiliary date view for the selected Shanghai date", async () => {
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", "date-view-user")
      .send({
        nickname: "日期视图用户",
        avatarUrl: "https://example.com/date-view.png",
        isPublic: false,
        requireWechatAuth: true
      })
      .expect(200);

    const sessionStarted = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "date-view-user")
      .expect(200);

    clock.advanceMinutes(25);

    await request(app)
      .post(`/api/sessions/${sessionStarted.body.session.id}/complete`)
      .set("x-wx-openid", "date-view-user")
      .send({
        summary: "日期视图打卡",
        subject: "审计",
        tags: ["刷题"],
        photos: [
          {
            fileId: "cloud://demo/admin-photo-2.jpg",
            objectKey: "checkins/2026/04/admin-photo-2.jpg"
          }
        ]
      })
      .expect(200);

    const login = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ password: "secret-admin" })
      .expect(302);

    const dateView = await request(app)
      .get("/admin?view=date&date=2026-04-16")
      .set("Cookie", login.headers["set-cookie"])
      .expect(200);

    expect(dateView.text).toContain("按日期查看");
    expect(dateView.text).toContain("日期视图用户");
    expect(dateView.text).toContain("2026-04-16");
    expect(dateView.text).toContain("admin-photo-2.jpg");
  });
});

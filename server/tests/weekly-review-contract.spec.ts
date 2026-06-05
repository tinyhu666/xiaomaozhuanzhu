import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * v0.38 — B2/B4 周复盘 contract.
 *  - POST /api/me/weekly-review upserts one reflection per user+week.
 *  - GET /api/me/weekly-reviews lists them, newest week first.
 *  - invalid weekKey is rejected.
 */
class TestClock {
  private current: Date;
  constructor(value: string) {
    this.current = new Date(value);
  }
  now() {
    return new Date(this.current);
  }
  advanceMinutes(m: number) {
    this.current = new Date(this.current.getTime() + m * 60_000);
  }
}

describe("/api/me/weekly-review(s) — 周复盘 contract", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-05-20T10:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  async function bootstrap(openid: string) {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
  }

  it("saves and reads back a weekly reflection", async () => {
    await bootstrap("u-wr-1");
    const save = await request(app)
      .post("/api/me/weekly-review")
      .set("x-wx-openid", "u-wr-1")
      .send({ weekKey: "2026-W21", content: "这周会计进度不错，审计要补。" });
    expect(save.status).toBe(200);
    expect(save.body.review.weekKey).toBe("2026-W21");
    expect(save.body.review.content).toBe("这周会计进度不错，审计要补。");

    const list = await request(app).get("/api/me/weekly-reviews").set("x-wx-openid", "u-wr-1").expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].content).toBe("这周会计进度不错，审计要补。");
  });

  it("upserts (one row per week — second save overwrites)", async () => {
    await bootstrap("u-wr-2");
    await request(app).post("/api/me/weekly-review").set("x-wx-openid", "u-wr-2")
      .send({ weekKey: "2026-W21", content: "初稿" }).expect(200);
    await request(app).post("/api/me/weekly-review").set("x-wx-openid", "u-wr-2")
      .send({ weekKey: "2026-W21", content: "改过的复盘" }).expect(200);

    const list = await request(app).get("/api/me/weekly-reviews").set("x-wx-openid", "u-wr-2").expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].content).toBe("改过的复盘");
  });

  it("lists multiple weeks newest first", async () => {
    await bootstrap("u-wr-3");
    await request(app).post("/api/me/weekly-review").set("x-wx-openid", "u-wr-3")
      .send({ weekKey: "2026-W19", content: "w19" }).expect(200);
    await request(app).post("/api/me/weekly-review").set("x-wx-openid", "u-wr-3")
      .send({ weekKey: "2026-W21", content: "w21" }).expect(200);
    await request(app).post("/api/me/weekly-review").set("x-wx-openid", "u-wr-3")
      .send({ weekKey: "2026-W20", content: "w20" }).expect(200);

    const list = await request(app).get("/api/me/weekly-reviews").set("x-wx-openid", "u-wr-3").expect(200);
    expect(list.body.items.map((r: { weekKey: string }) => r.weekKey)).toEqual([
      "2026-W21",
      "2026-W20",
      "2026-W19"
    ]);
  });

  it("rejects an invalid weekKey", async () => {
    await bootstrap("u-wr-4");
    const res = await request(app)
      .post("/api/me/weekly-review")
      .set("x-wx-openid", "u-wr-4")
      .send({ weekKey: "not a key!!", content: "x" });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });

  it("returns an empty list when nothing saved", async () => {
    await bootstrap("u-wr-5");
    const list = await request(app).get("/api/me/weekly-reviews").set("x-wx-openid", "u-wr-5").expect(200);
    expect(list.body.items).toEqual([]);
  });
});

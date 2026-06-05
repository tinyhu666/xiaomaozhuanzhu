import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * v0.34 — A1 补录 (manual retroactive study entry) contract.
 *
 * POST /api/sessions/manual records a COMPLETED session for a past (or
 * today) date with a user-supplied duration, so study time done without
 * the timer isn't lost. These tests pin the contract:
 *  1. A valid manual entry returns 200 with a completed session whose
 *     durationMinutes + subject match the payload.
 *  2. The entry contributes to that date's daily stats and to the
 *     subject totals on the dashboard.
 *  3. Future dates, bad durations, and unknown subjects are rejected.
 *  4. A manual entry on a past day feeds the streak via rebuildDailyStats.
 */
class TestClock {
  private current: Date;
  constructor(value: string) {
    this.current = new Date(value);
  }
  now() {
    return new Date(this.current);
  }
}

describe("/api/sessions/manual — 补录 contract", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-05-20T10:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  async function bootstrap(openid: string) {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
  }

  it("records a completed manual session with the given duration + subject + date", async () => {
    await bootstrap("u-manual-1");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-1")
      .send({ date: "2026-05-18", durationMinutes: 90, subject: "会计", tags: ["复习"], summary: "补录会计" });

    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("completed");
    expect(res.body.session.durationMinutes).toBe(90);
    expect(res.body.session.subject).toBe("会计");
    // endedAt should fall on the requested Shanghai date
    expect(String(res.body.session.endedAt)).toContain("2026-05-18");
  });

  it("contributes to that date's daily stats and the subject totals", async () => {
    await bootstrap("u-manual-2");
    await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-2")
      .send({ date: "2026-05-18", durationMinutes: 120, subject: "审计", tags: [] })
      .expect(200);

    // The completed manual session should show up in dashboard subject totals.
    const dash = await request(app).get("/api/me/dashboard").set("x-wx-openid", "u-manual-2").expect(200);
    const audit = (dash.body.subjectTargets ?? dash.body.subjects ?? []).find(
      (s: { subject: string }) => s.subject === "审计"
    );
    expect(audit?.totalMinutes).toBe(120);
    expect(dash.body.summary.totalMinutes).toBe(120);
    expect(dash.body.summary.completedSessionCount).toBe(1);
  });

  it("reflects the manual entry on the calendar for that day", async () => {
    await bootstrap("u-manual-3");
    await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-3")
      .send({ date: "2026-05-18", durationMinutes: 60, subject: null, tags: [] })
      .expect(200);

    const day = await request(app).get("/api/calendar/2026-05-18").set("x-wx-openid", "u-manual-3").expect(200);
    const total = day.body.sessions.reduce((sum: number, s: { totalMinutes: number }) => sum + s.totalMinutes, 0);
    expect(total).toBe(60);
  });

  it("rejects a future date", async () => {
    await bootstrap("u-manual-4");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-4")
      .send({ date: "2026-05-25", durationMinutes: 30, tags: [] }); // clock is 2026-05-20
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });

  it("rejects out-of-range durations", async () => {
    await bootstrap("u-manual-5");
    const zero = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-5")
      .send({ date: "2026-05-18", durationMinutes: 0, tags: [] });
    expect(zero.status).toBe(400);

    const tooLong = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-5")
      .send({ date: "2026-05-18", durationMinutes: 601, tags: [] });
    expect(tooLong.status).toBe(400);
  });

  it("rejects an unknown subject", async () => {
    await bootstrap("u-manual-6");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-6")
      .send({ date: "2026-05-18", durationMinutes: 30, subject: "英语", tags: [] });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });

  it("accepts today's date", async () => {
    await bootstrap("u-manual-7");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-7")
      .send({ date: "2026-05-20", durationMinutes: 45, subject: "税法", tags: ["刷题"] });
    expect(res.status).toBe(200);
    expect(res.body.session.durationMinutes).toBe(45);
  });

  // v0.37 — A3 章节粒度
  it("round-trips an optional topic", async () => {
    await bootstrap("u-manual-8");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-8")
      .send({ date: "2026-05-18", durationMinutes: 50, subject: "会计", topic: "金融资产", tags: [] });
    expect(res.status).toBe(200);
    expect(res.body.session.topic).toBe("金融资产");
  });

  it("defaults topic to null when omitted", async () => {
    await bootstrap("u-manual-9");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-9")
      .send({ date: "2026-05-18", durationMinutes: 30, subject: "会计", tags: [] });
    expect(res.status).toBe(200);
    expect(res.body.session.topic ?? null).toBeNull();
  });

  it("rejects an over-long topic (> 40 chars)", async () => {
    await bootstrap("u-manual-10");
    const res = await request(app)
      .post("/api/sessions/manual")
      .set("x-wx-openid", "u-manual-10")
      .send({ date: "2026-05-18", durationMinutes: 30, topic: "草".repeat(41), tags: [] });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });
});

import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * Session lifecycle contract.
 *
 * v0.21.2 shipped with a P0 — submit failure due to URL-encoded
 * subject — that would have been caught by an end-to-end test of
 * the full home → complete path. The v0.21.3 spec
 * `complete-subject-contract.spec.ts` pins the subject leaf of the
 * payload. This file pins the *lifecycle* itself:
 *
 *   bootstrap → start → pause → resume → complete → listMySessions
 *
 * — so a future refactor that breaks any leg of the funnel fails
 * here BEFORE it ships. Each transition has its own minimum
 * assertions; the full happy path is also exercised.
 *
 * What we deliberately DON'T cover here:
 *   - photo upload (storage is mocked out at app-construction level)
 *   - WeChat OpenAPI calls (covered separately in reminder.spec.ts)
 *   - daily-stat aggregation arithmetic (covered in insights.spec.ts)
 */

class TestClock {
  private current: Date;
  constructor(value: string) {
    this.current = new Date(value);
  }
  now() {
    return new Date(this.current);
  }
  advanceMinutes(n: number) {
    this.current = new Date(this.current.getTime() + n * 60_000);
  }
}

describe("Session lifecycle (end-to-end happy path)", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;
  const openid = "lifecycle-user";

  beforeEach(() => {
    clock = new TestClock("2026-05-18T10:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  it("walks bootstrap → start → pause → resume → complete and the row settles correctly", async () => {
    // 1. Bootstrap — new user lands.
    const bootstrap = await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", openid)
      .expect(200);
    expect(bootstrap.body.needsOnboarding).toBe(true);

    // 2. Start — no subject (v0.21.3 behavior; user picks at complete).
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .send({ mode: "free" })
      .expect(200);
    expect(started.body.session.status).toBe("running");
    expect(started.body.session.subject).toBeNull();
    const sessionId = started.body.session.id as string;

    // 3. 30 min later → pause.
    clock.advanceMinutes(30);
    const paused = await request(app)
      .post(`/api/sessions/${sessionId}/pause`)
      .set("x-wx-openid", openid)
      .expect(200);
    expect(paused.body.session.status).toBe("paused");

    // 4. 5 min later → resume.
    clock.advanceMinutes(5);
    const resumed = await request(app)
      .post(`/api/sessions/${sessionId}/resume`)
      .set("x-wx-openid", openid)
      .expect(200);
    expect(resumed.body.session.status).toBe("running");

    // 5. Another 30 min → complete with a v0.21.3-style payload
    //    (subject picked at the end, not at start).
    clock.advanceMinutes(30);
    const completed = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({
        summary: "刚才两段共一小时，节奏很顺。",
        subject: "审计",
        tags: ["顺利"],
        photos: [
          {
            fileId: "cloud://demo/lifecycle.jpg",
            objectKey: "checkins/2026/05/lifecycle.jpg"
          }
        ]
      })
      .expect(200);
    expect(completed.body.session.status).toBe("completed");
    expect(completed.body.session.subject).toBe("审计");
    // 30 min focus + 5 min pause + 30 min focus → 60 min recorded.
    expect(completed.body.session.durationMinutes).toBe(60);
    expect(completed.body.dailyStats.totalMinutes).toBe(60);
    expect(completed.body.dailyStats.streakDays).toBe(1);

    // 6. listMySessions returns the completed row (used by garden + monthly recap).
    const listed = await request(app)
      .get("/api/me/sessions")
      .set("x-wx-openid", openid)
      .expect(200);
    expect(Array.isArray(listed.body.items)).toBe(true);
    expect(listed.body.items.length).toBe(1);
    const row = listed.body.items[0];
    expect(row.id).toBe(sessionId);
    expect(row.subject).toBe("审计");
    expect(row.durationMinutes).toBe(60);
    expect(row.mode).toBe("free");
  });

  it("rejects pause/resume on a session that doesn't belong to the caller", async () => {
    // Start a session as user A.
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", "userA").expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", "userA")
      .send({ mode: "free" })
      .expect(200);
    const sessionId = started.body.session.id as string;

    // Try to pause it as user B → 4xx.
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", "userB").expect(200);
    const wrongPause = await request(app)
      .post(`/api/sessions/${sessionId}/pause`)
      .set("x-wx-openid", "userB");
    expect(wrongPause.status).toBeGreaterThanOrEqual(400);
    expect(wrongPause.status).toBeLessThan(500);
  });

  it("rejects complete with empty summary or zero photos (the two main client-side guards)", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .send({ mode: "free" })
      .expect(200);
    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(30);

    // Missing photos
    const missingPhotos = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({
        summary: "valid summary text",
        subject: null,
        tags: [],
        photos: []
      });
    expect(missingPhotos.status).toBe(400);

    // Empty summary
    const emptySummary = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({
        summary: "",
        subject: null,
        tags: [],
        photos: [{ fileId: "cloud://x/y.jpg", objectKey: "k.jpg" }]
      });
    expect(emptySummary.status).toBe(400);
  });
});

import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * v0.35 — A2 暂停/挂死 session 超时处理 contract.
 *
 * /home lazily reaps forgotten sessions:
 *  - paused > 24h → recover the real pre-pause study time (auto-complete)
 *  - running > 12h with sane run-time → recover; beyond the 10h cap → abandon
 *  - a normal active/paused session within TTL is left untouched
 * Reaping reports back via the `reapedSession` field so the client can toast.
 */
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

describe("/api/home — stale-session reaping (A2)", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-05-20T08:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  async function startSession(openid: string) {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const started = await request(app).post("/api/sessions/start").set("x-wx-openid", openid).expect(200);
    return started.body.session.id as string;
  }

  it("recovers a paused-then-forgotten session at its pre-pause run-time", async () => {
    const id = await startSession("u-reap-1");
    clock.advanceMinutes(50); // studied 50 min
    await request(app).post(`/api/sessions/${id}/pause`).set("x-wx-openid", "u-reap-1").expect(200);
    clock.advanceMinutes(25 * 60); // paused 25h (> 24h TTL)

    const home = await request(app).get("/api/home").set("x-wx-openid", "u-reap-1").expect(200);
    expect(home.body.activeSession).toBeNull();
    expect(home.body.reapedSession?.action).toBe("completed");
    expect(home.body.reapedSession?.minutes).toBe(50);

    // The recovered time shows in the dashboard totals.
    const dash = await request(app).get("/api/me/dashboard").set("x-wx-openid", "u-reap-1").expect(200);
    expect(dash.body.summary.totalMinutes).toBe(50);
  });

  it("abandons a runaway running session (> 12h) without fabricating hours", async () => {
    await startSession("u-reap-2");
    clock.advanceMinutes(13 * 60); // running 13h, never paused

    const home = await request(app).get("/api/home").set("x-wx-openid", "u-reap-2").expect(200);
    expect(home.body.activeSession).toBeNull();
    expect(home.body.reapedSession?.action).toBe("abandoned");

    const dash = await request(app).get("/api/me/dashboard").set("x-wx-openid", "u-reap-2").expect(200);
    expect(dash.body.summary.totalMinutes).toBe(0);
  });

  it("leaves a normal paused session (within TTL) untouched", async () => {
    const id = await startSession("u-reap-3");
    clock.advanceMinutes(40);
    await request(app).post(`/api/sessions/${id}/pause`).set("x-wx-openid", "u-reap-3").expect(200);
    clock.advanceMinutes(60); // paused 1h, well under 24h

    const home = await request(app).get("/api/home").set("x-wx-openid", "u-reap-3").expect(200);
    expect(home.body.activeSession).not.toBeNull();
    expect(home.body.activeSession.status).toBe("paused");
    expect(home.body.reapedSession ?? null).toBeNull();
  });

  it("leaves a fresh running session untouched and reports no reap", async () => {
    await startSession("u-reap-4");
    clock.advanceMinutes(30);
    const home = await request(app).get("/api/home").set("x-wx-openid", "u-reap-4").expect(200);
    expect(home.body.activeSession?.status).toBe("running");
    expect(home.body.reapedSession ?? null).toBeNull();
  });
});

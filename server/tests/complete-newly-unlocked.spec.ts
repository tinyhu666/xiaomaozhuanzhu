import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * v0.25 contract: /api/sessions/:id/complete responds with
 * `newlyUnlockedBadge: Badge | null` for the v0.25 achievement
 * unlock overlay.
 *
 * Cases pinned here:
 *   1. First-ever completion → `first_checkin` badge unlocks.
 *   2. Subsequent quick completion that doesn't cross any new
 *      threshold → `newlyUnlockedBadge` is null.
 *   3. A re-completion (already-completed session) → null
 *      (idempotent path).
 *
 * Implicit: pickNewlyUnlockedBadge picks the rarest when multiple
 * cross at once. We don't construct that here because it requires a
 * very long-running test (300+ hours of focus simulated) — the unit
 * test in tests is enough; this file pins the wire contract.
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

describe("/api/sessions/:id/complete — newlyUnlockedBadge contract", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;
  const openid = "unlock-user";

  beforeEach(() => {
    clock = new TestClock("2026-05-19T10:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  async function startAndComplete(durationMin: number) {
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .send({ mode: "free" })
      .expect(200);
    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(durationMin);
    return request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({ summary: "", subject: null, tags: [], photos: [] });
  }

  it("first-ever completion unlocks first_checkin and returns the badge", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const res = await startAndComplete(15);
    expect(res.status).toBe(200);
    expect(res.body.newlyUnlockedBadge).not.toBeNull();
    expect(res.body.newlyUnlockedBadge.key).toBe("first_checkin");
    expect(res.body.newlyUnlockedBadge.unlocked).toBe(true);
    // The bundled SVG path should also surface so the client can
    // render the breed illustration in the unlock overlay.
    expect(res.body.newlyUnlockedBadge.imageUrl).toContain("first_checkin.svg");
  });

  it("a second short completion right after the first returns null", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    // First completion: triggers first_checkin.
    await startAndComplete(10);
    // Second completion: short, doesn't cross any further threshold
    // (no 7-day streak yet, no 10h cumulative, etc.) → null.
    const second = await startAndComplete(10);
    expect(second.status).toBe(200);
    expect(second.body.newlyUnlockedBadge).toBeNull();
  });

  it("idempotent re-complete on already-completed session returns null", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .send({ mode: "free" })
      .expect(200);
    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(20);
    await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({ summary: "", subject: null, tags: [], photos: [] })
      .expect(200);

    // Re-fire complete on the same session — server short-circuits
    // back to the existing completed row.
    const repeat = await request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({ summary: "", subject: null, tags: [], photos: [] })
      .expect(200);
    expect(repeat.body.newlyUnlockedBadge).toBeNull();
  });

  it("crossing the single_day_4h badge by a single big session returns it as newly unlocked", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    // First small completion to clear first_checkin out of the way.
    await startAndComplete(5);
    // Now run a 4-hour session — should unlock single_day_4h.
    // (Other accumulating badges like total_10h are also nearby; we
    // just check that *some* badge crossed and it's the rare/epic
    // pickNewlyUnlockedBadge prefers.)
    const res = await startAndComplete(240);
    expect(res.status).toBe(200);
    // The rarest of any badges crossed by this single 4h session
    // is single_day_4h (rare). Cumulative-time badges below 10h are
    // common. So pickNewlyUnlockedBadge should return single_day_4h.
    expect(res.body.newlyUnlockedBadge?.key).toBe("single_day_4h");
    expect(res.body.newlyUnlockedBadge?.rarity).toBe("rare");
  });
});

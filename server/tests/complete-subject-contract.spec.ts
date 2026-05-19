import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * Regression coverage for the v0.21.2 → v0.21.3 outage where the
 * miniprogram home page URL-encoded the Chinese subject name and
 * passed it through wx.navigateTo. The receiving page didn't decode,
 * so the eventual POST to /sessions/:id/complete carried a literal
 * "%E4%BC%9A%E8%AE%A1" instead of "会计", and the server's zod
 * `z.enum(SUBJECTS)` rejected the request with "Request payload
 * validation failed". Users saw a hard submit failure on every
 * subject they picked.
 *
 * The structural fix was to drop the home → complete subject hop
 * entirely (the subject is now picked on the complete page after
 * the session). These tests pin the server contract so any future
 * client tweak fails loudly here instead of silently in production:
 *
 *  1. Every one of the 6 canonical Chinese subjects must round-trip
 *     a complete payload as a 200.
 *  2. A URL-encoded subject must be REJECTED — this documents the
 *     constraint and ensures any reintroduction of the encoding hop
 *     fails the test suite before it fails real users.
 *  3. null subject is allowed (user can opt out of categorization).
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

const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"] as const;

describe("/api/sessions/:id/complete — subject payload contract", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-05-18T10:00:00+08:00");
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
  });

  /** Run the full bootstrap → start → complete flow with a given
   *  subject value, returning the supertest Response object. */
  async function bootstrapAndCompleteWithSubject(
    openid: string,
    subject: string | null
  ) {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .expect(200);
    const sessionId = started.body.session.id as string;
    clock.advanceMinutes(45);
    return request(app)
      .post(`/api/sessions/${sessionId}/complete`)
      .set("x-wx-openid", openid)
      .send({
        summary: "提交流回归测试。",
        subject,
        tags: ["复习"],
        photos: [
          {
            fileId: "cloud://demo/photo-x.jpg",
            objectKey: "checkins/2026/05/photo-x.jpg"
          }
        ]
      });
  }

  // --- 1) Every canonical subject must succeed -----------------------------
  // HTTP header values must be ASCII, so openids use breed-index slugs
  // rather than the subject names themselves.
  SUBJECTS.forEach((subject, idx) => {
    it(`accepts subject="${subject}" (raw Chinese)`, async () => {
      const res = await bootstrapAndCompleteWithSubject(`u-subj-${idx}`, subject);
      expect(res.status).toBe(200);
      expect(res.body.session.subject).toBe(subject);
    });
  });

  // --- 2) URL-encoded subject must FAIL (regression pin) -------------------
  it("rejects a URL-encoded subject like '%E4%BC%9A%E8%AE%A1' (the v0.21.2 bug)", async () => {
    const encoded = encodeURIComponent("会计"); // "%E4%BC%9A%E8%AE%A1"
    const res = await bootstrapAndCompleteWithSubject("u-encoded", encoded);
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });

  // --- 3) Null subject is allowed (user opted out) ------------------------
  it("accepts subject=null (uncategorized session)", async () => {
    const res = await bootstrapAndCompleteWithSubject("u-null", null);
    expect(res.status).toBe(200);
    expect(res.body.session.subject).toBeNull();
  });

  // --- 4) Unrecognized free-form strings are rejected ---------------------
  it("rejects unknown subjects (e.g. '英语', '高数')", async () => {
    const res = await bootstrapAndCompleteWithSubject("u-unknown", "英语");
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_INPUT");
  });
});

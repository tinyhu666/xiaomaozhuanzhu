import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { signSession, verifySession } from "../src/domain/session-token";

/**
 * v0.39 — VPS auth contract (云托管 → Lighthouse migration, M1).
 *
 * 云托管 injected a trusted `x-wx-openid`; a plain server must run the
 * wx.login → code2session round-trip itself and then trust a signed
 * Bearer token instead. These tests mock code2session (no live WeChat)
 * and assert the full identity story:
 *   - POST /api/auth/login exchanges a code for { token, openid }
 *   - the token authenticates subsequent requests via Authorization: Bearer
 *   - a verified Bearer wins over a (spoofable) x-wx-openid header
 *   - forged / tampered tokens do NOT authenticate
 *   - login merges anonymous (clientUid) history into the openid account
 */

const SECRET = "test-session-secret-please-rotate-32+chars";

/** A stub WeChat client: code → openid, with a `BAD` code that throws. */
function makeWeChat(map: Record<string, string> = {}) {
  const calls: string[] = [];
  return {
    calls,
    code2session: async (code: string) => {
      calls.push(code);
      if (code === "BAD") {
        throw new Error("wechat code2session error 40029: invalid code");
      }
      return { openid: map[code] ?? `openid-for-${code}`, sessionKey: "sk" };
    }
  };
}

describe("session-token (unit)", () => {
  it("round-trips an openid through sign → verify", () => {
    const token = signSession("openid-abc", SECRET);
    expect(verifySession(token, SECRET)).toEqual({ openid: "openid-abc" });
  });

  it("rejects an expired token but accepts it within maxAge", () => {
    const issuedAt = 1_700_000_000_000;
    const token = signSession("openid-abc", SECRET, issuedAt);
    // 91 days later → past the 90-day default window → rejected.
    const now = issuedAt + 91 * 24 * 60 * 60 * 1000;
    expect(verifySession(token, SECRET, { now })).toBeNull();
    // Same token, 1 day later → within window → accepted.
    expect(verifySession(token, SECRET, { now: issuedAt + 24 * 60 * 60 * 1000 })).toEqual({
      openid: "openid-abc"
    });
    // maxAgeMs: 0 disables the expiry check entirely.
    expect(verifySession(token, SECRET, { now, maxAgeMs: 0 })).toEqual({ openid: "openid-abc" });
  });

  it("rejects a token issued in the far future (clock-skew guard)", () => {
    const now = 1_700_000_000_000;
    const token = signSession("openid-abc", SECRET, now + 10 * 60_000); // +10 min
    expect(verifySession(token, SECRET, { now })).toBeNull();
  });

  it("rejects an openid with illegal shape (whitespace / too short)", () => {
    // Forged by someone WITH the secret, but the shape guard still rejects it.
    expect(verifySession(signSession(" ", SECRET), SECRET)).toBeNull();
    expect(verifySession(signSession("ab", SECRET), SECRET)).toBeNull();
  });

  it("never verifies when the secret is empty", () => {
    const token = signSession("openid-abc", "");
    expect(verifySession(token, "")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession("openid-abc", SECRET);
    expect(verifySession(token, "another-secret")).toBeNull();
  });

  it("rejects a tampered payload (HMAC mismatch)", () => {
    const token = signSession("openid-abc", SECRET);
    const [, sig] = token.split(".");
    // Swap in a forged payload but keep the old signature.
    const forgedPayload = Buffer.from(JSON.stringify({ o: "openid-evil", t: 1 })).toString("base64url");
    expect(verifySession(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it("returns null for garbage / malformed input", () => {
    expect(verifySession("", SECRET)).toBeNull();
    expect(verifySession("no-dot-here", SECRET)).toBeNull();
    expect(verifySession("a.", SECRET)).toBeNull();
    expect(verifySession(".b", SECRET)).toBeNull();
  });
});

describe("POST /api/auth/login — wx.login exchange", () => {
  it("503 when the server has no WeChat client configured", async () => {
    const app = createApp({ seedNews: false, sessionSecret: SECRET });
    const res = await request(app).post("/api/auth/login").send({ code: "abc" });
    expect(res.status).toBe(503);
    expect(res.body.error?.code ?? res.body.code).toBe("LOGIN_UNAVAILABLE");
  });

  it("503 when SESSION_SECRET is empty even if WeChat is configured", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat(), sessionSecret: "" });
    const res = await request(app).post("/api/auth/login").send({ code: "abc" });
    expect(res.status).toBe(503);
  });

  it("400 on missing / empty code", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat(), sessionSecret: SECRET });
    await request(app).post("/api/auth/login").send({}).expect(400);
    await request(app).post("/api/auth/login").send({ code: "" }).expect(400);
    await request(app).post("/api/auth/login").send({ code: "   " }).expect(400);
  });

  it("502 when code2session fails", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat(), sessionSecret: SECRET });
    const res = await request(app).post("/api/auth/login").send({ code: "BAD" });
    expect(res.status).toBe(502);
    expect(res.body.error?.code ?? res.body.code).toBe("WECHAT_LOGIN_FAILED");
  });

  it("happy path: returns a token that verifies to the resolved openid", async () => {
    const wechat = makeWeChat({ "code-1": "wx-openid-1" });
    const app = createApp({ seedNews: false, wechat, sessionSecret: SECRET });
    const res = await request(app).post("/api/auth/login").send({ code: "code-1" });
    expect(res.status).toBe(200);
    expect(res.body.openid).toBe("wx-openid-1");
    expect(typeof res.body.token).toBe("string");
    expect(verifySession(res.body.token, SECRET)).toEqual({ openid: "wx-openid-1" });
    expect(wechat.calls).toEqual(["code-1"]);
    // bootstrap-style payload for the client to render immediately
    expect(res.body).toHaveProperty("needsOnboarding");
    expect(res.body).toHaveProperty("serverTime");
  });
});

describe("Authorization: Bearer — token authenticates requests", () => {
  it("a logged-in token resolves identity on protected routes", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat({ c: "wx-bearer-1" }), sessionSecret: SECRET });
    const login = await request(app).post("/api/auth/login").send({ code: "c" }).expect(200);
    const token = login.body.token as string;

    // Set a nickname using ONLY the Bearer token (no x-wx-openid header).
    await request(app)
      .post("/api/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ nickname: "持证喵", avatarUrl: "" })
      .expect(200);

    // Read it back with the SAME Bearer token → present (the token is the
    // identity; in VPS mode the legacy header is no longer trusted).
    const boot = await request(app)
      .post("/api/me/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(boot.body.profile.nickname).toBe("持证喵");
  });

  it("a verified Bearer wins; a raw x-wx-openid header is NOT trusted (VPS mode)", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat({ c: "real-user" }), sessionSecret: SECRET });
    const login = await request(app).post("/api/auth/login").send({ code: "c" }).expect(200);
    const token = login.body.token as string;

    // Write under Bearer(real-user) while ALSO sending a different openid header.
    await request(app)
      .post("/api/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .set("x-wx-openid", "attacker-openid")
      .send({ nickname: "真身", avatarUrl: "" })
      .expect(200);

    // The write landed on real-user (Bearer), readable via the token.
    const real = await request(app)
      .post("/api/me/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(real.body.profile.nickname).toBe("真身");

    // A raw x-wx-openid header with NO Bearer is rejected outright in VPS
    // mode — it can't impersonate anyone (this is the H2 fix).
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "real-user")
      .send({})
      .expect(401);
  });

  it("a forged Bearer token does not authenticate (falls through to 401)", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat(), sessionSecret: SECRET });
    // Token signed with the WRONG secret; no other identity header / clientUid.
    const forged = signSession("openid-evil", "wrong-secret");
    const res = await request(app)
      .post("/api/me/bootstrap")
      .set("Authorization", `Bearer ${forged}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it("Bearer is ignored when the server runs without a sessionSecret (云托管 mode)", async () => {
    // No sessionSecret → getOpenId never trusts Bearer; legacy header still works.
    // Force "" so the test is deterministic regardless of a SESSION_SECRET env.
    const app = createApp({ seedNews: false, sessionSecret: "" });
    const token = signSession("openid-x", SECRET);
    // Bearer alone → no identity → 401.
    await request(app).post("/api/me/bootstrap").set("Authorization", `Bearer ${token}`).send({}).expect(401);
    // Legacy header still authenticates.
    await request(app).post("/api/me/bootstrap").set("x-dev-openid", "openid-x").send({}).expect(200);
  });
});

describe("login merges anonymous clientUid history into the openid account", () => {
  it("carries a profile set under clientUid into the openid identity", async () => {
    const app = createApp({ seedNews: false, wechat: makeWeChat({ c: "merge-openid" }), sessionSecret: SECRET });
    const clientUid = "anon-client-uid-123456";

    // Anonymous user (clientUid only) completes onboarding.
    await request(app)
      .post("/api/me/profile")
      .set("x-client-uid", clientUid)
      .send({ nickname: "匿名喵", avatarUrl: "" })
      .expect(200);

    // Now they log in WITH the same clientUid still attached.
    const login = await request(app)
      .post("/api/auth/login")
      .set("x-client-uid", clientUid)
      .send({ code: "c" })
      .expect(200);
    expect(login.body.openid).toBe("merge-openid");

    // The openid account inherits the anonymous profile (merge happened).
    const token = login.body.token as string;
    const boot = await request(app)
      .post("/api/me/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(boot.body.profile.nickname).toBe("匿名喵");
  });
});

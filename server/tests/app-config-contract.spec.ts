import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

/**
 * v0.42 — GET /api/app-config contract (云托管 → VPS migration safety).
 *
 * The launch-time gate the client honors to (a) show a「维护中」notice and
 * (b) nudge an upgrade. Must be auth-free (works pre-login / during a
 * maintenance window) and env-driven (a cutover is a flag flip + restart).
 */
describe("GET /api/app-config", () => {
  const ENV_KEYS = ["MAINTENANCE", "MIN_CLIENT_VERSION", "MAINTENANCE_MESSAGE"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults to no maintenance, empty min version, no auth required", async () => {
    const app = createApp({ seedNews: false });
    // No identity header at all — must still answer (pre-login / maintenance).
    const res = await request(app).get("/api/app-config").expect(200);
    expect(res.body.maintenance).toBe(false);
    expect(res.body.minClientVersion).toBe("");
    expect(res.body.message).toBe("");
    expect(typeof res.body.serverTime).toBe("string");
  });

  it("reports maintenance:true for MAINTENANCE=1 and =true", async () => {
    process.env.MAINTENANCE = "1";
    let res = await request(createApp({ seedNews: false })).get("/api/app-config").expect(200);
    expect(res.body.maintenance).toBe(true);

    process.env.MAINTENANCE = "true";
    res = await request(createApp({ seedNews: false })).get("/api/app-config").expect(200);
    expect(res.body.maintenance).toBe(true);
  });

  it("treats other MAINTENANCE values as off (no accidental brick)", async () => {
    process.env.MAINTENANCE = "0";
    const res = await request(createApp({ seedNews: false })).get("/api/app-config").expect(200);
    expect(res.body.maintenance).toBe(false);
  });

  it("echoes MIN_CLIENT_VERSION and MAINTENANCE_MESSAGE", async () => {
    process.env.MIN_CLIENT_VERSION = "0.42.0";
    process.env.MAINTENANCE_MESSAGE = "服务升级中，预计 10 分钟";
    const res = await request(createApp({ seedNews: false })).get("/api/app-config").expect(200);
    expect(res.body.minClientVersion).toBe("0.42.0");
    expect(res.body.message).toBe("服务升级中，预计 10 分钟");
  });

  describe("MAINTENANCE write-freeze (server-side, makes final sync consistent)", () => {
    it("503s mutating /api routes but keeps reads, app-config, and login up", async () => {
      process.env.MAINTENANCE = "1";
      // A business write → 503 MAINTENANCE (fires before auth, so no creds needed).
      const write = await request(createApp({ seedNews: false }))
        .post("/api/me/bootstrap")
        .set("x-wx-openid", "u-maint")
        .send({});
      expect(write.status).toBe(503);
      expect(write.body.error?.code ?? write.body.code).toBe("MAINTENANCE");

      // The gate itself stays readable.
      await request(createApp({ seedNews: false })).get("/api/app-config").expect(200);

      // GET reads are NOT frozen (reads don't break a dump's consistency).
      // /health is a GET → allowed.
      await request(createApp({ seedNews: false })).get("/health").expect(200);

      // Login stays up (exempt) so the client can still authenticate + render
      // the gate — proven by it NOT returning the MAINTENANCE 503.
      const wechat = { code2session: async () => ({ openid: "wx-maint" }) };
      const loginRes = await request(
        createApp({ seedNews: false, wechat, sessionSecret: "maint-secret-please-rotate-32chars+" })
      )
        .post("/api/auth/login")
        .send({ code: "c" });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.error?.code).not.toBe("MAINTENANCE");
    });

    it("admin routes (/admin) are not frozen by the /api maintenance guard", async () => {
      process.env.MAINTENANCE = "1";
      // No ADMIN_TOKEN configured → admin API returns 503 ADMIN-not-configured,
      // NOT the MAINTENANCE write-freeze (proving /admin bypasses the /api guard).
      const res = await request(createApp({ seedNews: false }))
        .post("/admin/api/anything")
        .send({});
      expect(res.body.error?.code).not.toBe("MAINTENANCE");
    });
  });
});

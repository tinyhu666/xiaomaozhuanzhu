import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
  buildReminderData,
  formatReminderDate,
  WeChatAPIClient
} from "../src/domain/wechat-openapi";
import {
  buildExamCountdownNote,
  ReminderScheduler
} from "../src/domain/reminder-scheduler";
import { MemoryStore } from "../src/store/memory-store";

class TestClock {
  private current: Date;
  constructor(value: string) {
    this.current = new Date(value);
  }
  now() {
    return new Date(this.current);
  }
  set(date: Date) {
    this.current = new Date(date);
  }
}

/* -------------------------------------------------------------------------- */
/*  Template payload helpers                                                   */
/* -------------------------------------------------------------------------- */

describe("formatReminderDate", () => {
  it("formats a UTC moment as Shanghai-local Chinese date", () => {
    // 2026-05-17 16:00 UTC = 00:00 May 18 Shanghai
    expect(formatReminderDate(new Date("2026-05-17T16:00:00.000Z"))).toBe(
      "2026 年 5 月 18 日"
    );
    // 2026-05-17 09:00 UTC = 17:00 May 17 Shanghai
    expect(formatReminderDate(new Date("2026-05-17T09:00:00.000Z"))).toBe(
      "2026 年 5 月 17 日"
    );
  });
});

describe("buildReminderData", () => {
  it("returns the 4-field WeChat-template DATA block with proper caps", () => {
    const data = buildReminderData({
      reminderDate: new Date("2026-05-17T09:00:00.000Z"),
      reminderTitle: "今晚 20:30 学习时间到",
      reminderTime: "20:30",
      reminderNote: "打开小程序开始今晚的专注"
    });
    expect(data.date2.value).toBe("2026 年 5 月 17 日");
    expect(data.thing3.value).toBe("今晚 20:30 学习时间到");
    expect(data.time15.value).toBe("20:30");
    expect(data.thing9.value).toBe("打开小程序开始今晚的专注");
  });

  it("caps thing fields at 20 characters (WeChat constraint)", () => {
    const longText = "这是一段超过二十个字符的非常非常长的提醒事项说明文字";
    const data = buildReminderData({
      reminderDate: new Date(),
      reminderTitle: longText,
      reminderTime: "20:30",
      reminderNote: longText
    });
    expect(data.thing3.value.length).toBeLessThanOrEqual(20);
    expect(data.thing9.value.length).toBeLessThanOrEqual(20);
  });
});

/* -------------------------------------------------------------------------- */
/*  WeChatAPIClient with mocked fetch                                          */
/* -------------------------------------------------------------------------- */

describe("WeChatAPIClient", () => {
  it("fetches an access token and caches until ~5 min before expiry", async () => {
    let tokenCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/cgi-bin/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({ access_token: `tok-${tokenCalls}`, expires_in: 7200 }),
          { status: 200 }
        );
      }
      throw new Error("unexpected url " + u);
    }) as unknown as typeof fetch;

    let now = 1_000_000_000_000;
    const client = new WeChatAPIClient({
      appId: "appid",
      appSecret: "secret",
      now: () => now,
      fetcher
    });

    const first = await client.getAccessToken();
    expect(first).toBe("tok-1");
    const cached = await client.getAccessToken();
    expect(cached).toBe("tok-1");
    expect(tokenCalls).toBe(1);

    // Advance past the (7200 - 300) * 1000 ms refresh threshold.
    now += (7200 - 300) * 1000 + 1000;
    const refreshed = await client.getAccessToken();
    expect(refreshed).toBe("tok-2");
    expect(tokenCalls).toBe(2);
  });

  it("returns ok=true for errcode 0 send response", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/cgi-bin/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }));
      }
      if (u.includes("/cgi-bin/message/subscribe/send")) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }));
      }
      throw new Error("unexpected url");
    }) as unknown as typeof fetch;
    const client = new WeChatAPIClient({ appId: "a", appSecret: "s", fetcher });
    const result = await client.sendSubscribeMessage({
      touser: "u",
      template_id: "t",
      data: { thing1: { value: "x" } }
    });
    expect(result).toEqual({ ok: true });
  });

  it("flags revoked=true on errcode 43101", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/cgi-bin/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 7200 }));
      }
      return new Response(JSON.stringify({ errcode: 43101, errmsg: "user refused" }));
    }) as unknown as typeof fetch;
    const client = new WeChatAPIClient({ appId: "a", appSecret: "s", fetcher });
    const result = await client.sendSubscribeMessage({
      touser: "u",
      template_id: "t",
      data: {}
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(43101);
      expect(result.revoked).toBe(true);
    }
  });

  it("auto-retries once on errcode 40001 (invalid credential)", async () => {
    let tokenCalls = 0;
    let sendCalls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/cgi-bin/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({ access_token: `tok-${tokenCalls}`, expires_in: 7200 })
        );
      }
      sendCalls += 1;
      // First send → 40001; second → 0
      const errcode = sendCalls === 1 ? 40001 : 0;
      return new Response(JSON.stringify({ errcode, errmsg: errcode ? "expired" : "ok" }));
    }) as unknown as typeof fetch;
    const client = new WeChatAPIClient({ appId: "a", appSecret: "s", fetcher });
    const result = await client.sendSubscribeMessage({
      touser: "u",
      template_id: "t",
      data: {}
    });
    expect(result).toEqual({ ok: true });
    expect(tokenCalls).toBe(2);
    expect(sendCalls).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/*  REST endpoints                                                             */
/* -------------------------------------------------------------------------- */

describe("Reminder API endpoints", () => {
  let clock: TestClock;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-05-17T10:00:00+08:00");
    app = createApp({
      clock: { now: () => clock.now() },
      seedNews: false
    });
  });

  it("GET /api/me/reminder/status returns the default state for a fresh user", async () => {
    const res = await request(app)
      .get("/api/me/reminder/status")
      .set("x-wx-openid", "user-r1")
      .expect(200);
    expect(res.body).toMatchObject({
      enabled: false,
      credits: 0,
      lastSentAt: null,
      hasOpenid: true
    });
  });

  it("POST /api/me/reminder/subscribe enables + bumps credits", async () => {
    const res = await request(app)
      .post("/api/me/reminder/subscribe")
      .set("x-wx-openid", "user-r2")
      .send({ accepted: 1 })
      .expect(200);
    expect(res.body).toEqual({ enabled: true, credits: 1 });

    // Second call adds another credit (user resubscribed for refill).
    const res2 = await request(app)
      .post("/api/me/reminder/subscribe")
      .set("x-wx-openid", "user-r2")
      .send({ accepted: 1 })
      .expect(200);
    expect(res2.body).toEqual({ enabled: true, credits: 2 });
  });

  it("POST /api/me/reminder/disable turns it off but preserves credits for later", async () => {
    await request(app)
      .post("/api/me/reminder/subscribe")
      .set("x-wx-openid", "user-r3")
      .send({ accepted: 3 })
      .expect(200);

    const disable = await request(app)
      .post("/api/me/reminder/disable")
      .set("x-wx-openid", "user-r3")
      .expect(200);
    expect(disable.body).toEqual({ enabled: false, credits: 3 });
  });

  it("subscribe rejects invalid accepted values", async () => {
    await request(app)
      .post("/api/me/reminder/subscribe")
      .set("x-wx-openid", "user-r4")
      .send({ accepted: 0 })
      .expect(400);
  });
});

/* -------------------------------------------------------------------------- */
/*  ReminderScheduler                                                          */
/* -------------------------------------------------------------------------- */

describe("buildExamCountdownNote", () => {
  it("returns days until the nearest CPA exam (closest of 6 subjects)", () => {
    // Far enough in advance that the closest exam date is decisively
    // in the future for all 6 subjects.
    const note = buildExamCountdownNote(new Date("2026-01-01T00:00:00.000Z"));
    expect(note).toMatch(/^距考试还有 \d+ 天，加油！$/);
  });

  it("note text length stays within WeChat 20-char thing limit", () => {
    const note = buildExamCountdownNote(new Date("2026-01-01T00:00:00.000Z"));
    expect(note.length).toBeLessThanOrEqual(20);
  });

  it("returns generic fallback when nothing is upcoming", () => {
    // Force a date past all exams in the table; the exam-dates helper
    // rolls dates forward by a year, so this path is hard to reach
    // — but the helper must not crash and must produce a string.
    const note = buildExamCountdownNote(new Date("2099-12-31T00:00:00.000Z"));
    expect(typeof note).toBe("string");
    expect(note.length).toBeGreaterThan(0);
  });
});

describe("ReminderScheduler", () => {
  it("only fires at 20:30 Shanghai time", async () => {
    const store = new MemoryStore();
    store.ensureUser({ openid: "openid-a" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 1);

    const sent: unknown[] = [];
    const apiClient = {
      sendSubscribeMessage: async (payload: unknown) => {
        sent.push(payload);
        return { ok: true as const };
      }
    };

    // 19:30 Shanghai = 11:30 UTC; should NOT fire.
    const s1 = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T11:30:00.000Z"),
      logger: () => {}
    });
    await s1.tick();
    expect(sent.length).toBe(0);

    // 20:30 Shanghai = 12:30 UTC; should fire once.
    const s2 = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await s2.tick();
    expect(sent.length).toBe(1);
  });

  it("does not re-fire to the same user within the same Shanghai-day", async () => {
    const store = new MemoryStore();
    store.ensureUser({ openid: "openid-b" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 5);

    let sendCalls = 0;
    const apiClient = {
      sendSubscribeMessage: async () => {
        sendCalls += 1;
        return { ok: true as const };
      }
    };

    // First fire at 20:30:00 Shanghai.
    const sch = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch.tick();
    expect(sendCalls).toBe(1);

    // Re-tick — fast-path bails on lastTickDay equality.
    await sch.tick();
    expect(sendCalls).toBe(1);

    // Even a fresh scheduler instance respects the per-user DB column.
    const sch2 = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch2.tick();
    expect(sendCalls).toBe(1);
  });

  it("consumes the credit on success (decrements counter)", async () => {
    const store = new MemoryStore();
    store.ensureUser({ openid: "openid-c" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 3);

    const apiClient = {
      sendSubscribeMessage: async () => ({ ok: true as const })
    };
    const sch = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch.tick();
    expect(user.reminderCredits).toBe(2);
    expect(user.reminderLastSentAt).toBeTruthy();
  });

  it("on revoked (43101) consumes credit but on other errors keeps credit and records error", async () => {
    const store = new MemoryStore();
    store.ensureUser({ openid: "openid-d" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 5);

    let scenario: "revoked" | "transient" = "revoked";
    const apiClient = {
      sendSubscribeMessage: async () =>
        scenario === "revoked"
          ? { ok: false as const, code: 43101, message: "refused", revoked: true }
          : { ok: false as const, code: 45009, message: "rate limited" }
    };

    const sch = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch.tick();
    // 43101 → credit consumed (treated as terminal for that subscription)
    expect(user.reminderCredits).toBe(4);

    // Roll clock to next day so the per-user gate clears.
    scenario = "transient";
    const sch2 = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-18T12:30:00.000Z"),
      logger: () => {}
    });
    await sch2.tick();
    // Non-revoked failure → credit retained, error recorded.
    expect(user.reminderCredits).toBe(4);
    expect(user.reminderLastError).toContain("45009");
  });

  it("dispatched payload carries countdown text in thing9 + 20:30 in time15", async () => {
    const store = new MemoryStore();
    store.ensureUser({ openid: "openid-payload" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 1);

    const sent: any[] = [];
    const apiClient = {
      sendSubscribeMessage: async (payload: any) => {
        sent.push(payload);
        return { ok: true as const };
      }
    };
    const sch = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch.tick();
    expect(sent.length).toBe(1);
    const payload = sent[0];
    expect(payload.data.time15.value).toBe("20:30");
    // thing9 contains either the countdown phrasing or the fallback;
    // either way it shouldn't exceed the WeChat 20-char limit.
    expect(payload.data.thing9.value.length).toBeLessThanOrEqual(20);
    expect(payload.data.thing9.value).toMatch(/(距考试还有|今晚|考试日)/);
  });

  it("does not dispatch when user has no openid (anonymous client_uid only)", async () => {
    const store = new MemoryStore();
    store.ensureUser({ clientUid: "anon-1" }, "2026-05-17T10:00:00.000Z");
    const user = [...(store as any).users.values()][0];
    store.setReminderEnabled(user.id, true);
    store.incrementReminderCredits(user.id, 1);

    let calls = 0;
    const apiClient = {
      sendSubscribeMessage: async () => {
        calls += 1;
        return { ok: true as const };
      }
    };
    const sch = new ReminderScheduler({
      store: store as never,
      apiClient: apiClient as never,
      now: () => new Date("2026-05-17T12:30:00.000Z"),
      logger: () => {}
    });
    await sch.tick();
    expect(calls).toBe(0);
  });
});

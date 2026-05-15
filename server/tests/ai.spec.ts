import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
  __resetAiCountersForTests,
  askAi,
  type DeepSeekFetcher
} from "../src/domain/ai";

const ORIGINAL_KEY = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  __resetAiCountersForTests();
  process.env.DEEPSEEK_API_KEY = "test-key";
});

afterEach(() => {
  __resetAiCountersForTests();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = ORIGINAL_KEY;
  }
});

describe("askAi (domain)", () => {
  it("returns the model's reply on a successful call", async () => {
    const fetcher: DeepSeekFetcher = vi.fn(async () => mockOk({
      choices: [{ message: { role: "assistant", content: "你好" } }]
    }));
    const result = await askAi(
      { userId: "u1", question: "什么是 CPA?", now: new Date("2026-05-12T08:00:00+08:00") },
      fetcher
    );
    expect(result.answer).toBe("你好");
    expect(result.usedToday).toBe(1);
    expect(result.dailyLimit).toBeGreaterThanOrEqual(1);
  });

  it("rate-limits a user after the daily cap", async () => {
    const fetcher: DeepSeekFetcher = async () => mockOk({
      choices: [{ message: { content: "answer" } }]
    });
    // Burn through the cap. Hard-coded to 30 in the module; we ask
    // 30 times and then expect the 31st to fail.
    for (let i = 0; i < 30; i += 1) {
      await askAi(
        { userId: "burner", question: "题目?", now: new Date("2026-05-12T08:00:00+08:00") },
        fetcher
      );
    }
    await expect(
      askAi(
        { userId: "burner", question: "再来一题", now: new Date("2026-05-12T08:00:00+08:00") },
        fetcher
      )
    ).rejects.toMatchObject({ statusCode: 429, code: "AI_RATE_LIMITED" });
  });

  it("rejects when DEEPSEEK_API_KEY is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(
      askAi(
        { userId: "u1", question: "Hello", now: new Date("2026-05-12T08:00:00+08:00") },
        async () => mockOk({ choices: [] })
      )
    ).rejects.toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
  });

  it("maps upstream 429 onto its own 429 with a friendly message", async () => {
    const fetcher: DeepSeekFetcher = async () => ({
      ok: false,
      status: 429,
      text: async () => "{\"error\":\"rate limited upstream\"}",
      json: async () => ({})
    });
    await expect(
      askAi(
        { userId: "u1", question: "题目?", now: new Date("2026-05-12T08:00:00+08:00") },
        fetcher
      )
    ).rejects.toMatchObject({ statusCode: 429, code: "AI_UPSTREAM_LIMIT" });
  });

  it("maps generic upstream non-2xx onto 502", async () => {
    const fetcher: DeepSeekFetcher = async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({})
    });
    await expect(
      askAi(
        { userId: "u1", question: "题目?", now: new Date("2026-05-12T08:00:00+08:00") },
        fetcher
      )
    ).rejects.toMatchObject({ statusCode: 502, code: "AI_UPSTREAM_ERROR" });
  });

  it("treats empty content as 502 so the client knows to retry", async () => {
    const fetcher: DeepSeekFetcher = async () => mockOk({
      choices: [{ message: { content: "" } }]
    });
    await expect(
      askAi(
        { userId: "u1", question: "题目?", now: new Date("2026-05-12T08:00:00+08:00") },
        fetcher
      )
    ).rejects.toMatchObject({ statusCode: 502, code: "AI_EMPTY" });
  });

  it("preserves the last 6 history turns and discards older ones", async () => {
    let capturedBody: any;
    const fetcher: DeepSeekFetcher = async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return mockOk({ choices: [{ message: { content: "ok" } }] });
    };
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn ${i}`
    }));
    await askAi(
      { userId: "u1", question: "新问题", history, now: new Date("2026-05-12T08:00:00+08:00") },
      fetcher
    );
    // System prompt + 6 history turns + 1 new user message = 8 messages.
    expect(capturedBody.messages.length).toBe(8);
    expect(capturedBody.messages[0].role).toBe("system");
    expect(capturedBody.messages[1].content).toBe("turn 4");
    expect(capturedBody.messages[7].content).toBe("新问题");
  });
});

describe("POST /api/ai/ask (HTTP)", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      clock: { now: () => new Date("2026-05-12T08:00:00+08:00") },
      seedNews: false
    });
  });

  it("requires identity headers", async () => {
    await request(app).post("/api/ai/ask").send({ question: "你好世界" }).expect(401);
  });

  it("validates question length", async () => {
    await request(app)
      .post("/api/ai/ask")
      .set("x-wx-openid", "u-test")
      .send({ question: "短" })
      .expect(400);
  });

  it("503s when API key is unset", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "u-test")
      .expect(200);
    await request(app)
      .post("/api/ai/ask")
      .set("x-wx-openid", "u-test")
      .send({ question: "什么是 CPA 综合阶段?" })
      .expect(503);
  });
});

function mockOk(body: object) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

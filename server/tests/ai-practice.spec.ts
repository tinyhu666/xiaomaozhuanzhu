import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { __resetAiCountersForTests } from "../src/domain/ai";
import {
  generateGradeExplanation,
  generatePracticeQuestions,
  type DeepSeekFetcher
} from "../src/domain/ai-practice";

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

/* ------------------------------------------------------------------ */
/*  Domain-level                                                       */
/* ------------------------------------------------------------------ */

describe("generatePracticeQuestions", () => {
  it("parses well-formed AI JSON output into questions", async () => {
    const fetcher: DeepSeekFetcher = async () =>
      mockOk({
        choices: [
          {
            message: {
              content: JSON.stringify({
                questions: [
                  {
                    question: "下列关于权益法的描述哪一项正确？",
                    options: ["A. xxx", "B. yyy", "C. zzz", "D. ccc"],
                    correct_answer: "B"
                  }
                ]
              })
            }
          }
        ]
      });
    const result = await generatePracticeQuestions({
      userId: "u1",
      subject: "会计",
      difficulty: "basic",
      count: 1,
      now: new Date("2026-05-12T08:00:00+08:00"),
      fetcher
    });
    expect(result.length).toBe(1);
    expect(result[0].correct_answer).toBe("B");
    expect(result[0].options.length).toBe(4);
  });

  it("rejects unknown subject before hitting AI", async () => {
    const fetcher = vi.fn();
    await expect(
      generatePracticeQuestions({
        userId: "u1",
        subject: "外语" as never,
        difficulty: "basic",
        count: 1,
        now: new Date("2026-05-12T08:00:00+08:00"),
        fetcher
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats schema-invalid AI output as a 502 (not a 200 with garbage)", async () => {
    const fetcher: DeepSeekFetcher = async () =>
      mockOk({
        choices: [
          { message: { content: JSON.stringify({ items: [{ no: "such field" }] }) } }
        ]
      });
    await expect(
      generatePracticeQuestions({
        userId: "u1",
        subject: "会计",
        difficulty: "basic",
        count: 1,
        now: new Date("2026-05-12T08:00:00+08:00"),
        fetcher
      })
    ).rejects.toMatchObject({ statusCode: 502, code: "AI_BAD_RESPONSE" });
  });
});

describe("generateGradeExplanation", () => {
  it("returns the explanation string verbatim", async () => {
    const fetcher: DeepSeekFetcher = async () =>
      mockOk({
        choices: [{ message: { content: "解析：本题考察长投权益法。\n答案 B 错在……" } }]
      });
    const text = await generateGradeExplanation({
      userId: "u1",
      subject: "会计",
      question: "...",
      options: ["A.", "B.", "C.", "D."],
      correctAnswer: "A",
      userAnswer: "B",
      now: new Date("2026-05-12T08:00:00+08:00"),
      fetcher
    });
    expect(text).toContain("本题考察");
  });

  it("returns 502 on empty AI response", async () => {
    const fetcher: DeepSeekFetcher = async () =>
      mockOk({ choices: [{ message: { content: "" } }] });
    await expect(
      generateGradeExplanation({
        userId: "u1",
        subject: "会计",
        question: "...",
        options: ["A.", "B."],
        correctAnswer: "A",
        userAnswer: "B",
        now: new Date("2026-05-12T08:00:00+08:00"),
        fetcher
      })
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});

/* ------------------------------------------------------------------ */
/*  HTTP integration — happy path through both endpoints              */
/* ------------------------------------------------------------------ */

describe("Practice endpoints (HTTP)", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      clock: { now: () => new Date("2026-05-12T08:00:00+08:00") },
      seedNews: false
    });
  });

  it("generates → grades → lists mistakes end-to-end", async () => {
    // We can't actually hit DeepSeek in tests, but the endpoints
    // use the real fetcher path. Re-wire the global fetch with a
    // vitest mock so the routes see synthetic data.
    const originalFetch = globalThis.fetch;
    let call = 0;
    (globalThis as any).fetch = vi.fn(async (_url: string, _init: any) => {
      call += 1;
      if (call === 1) {
        // generator call
        return mockOk({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      question: "本题考察长期股权投资由成本法转权益法的会计处理，下列哪个说法正确？",
                      options: ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
                      correct_answer: "C"
                    }
                  ]
                })
              }
            }
          ]
        });
      }
      // grader call
      return mockOk({
        choices: [{ message: { content: "解析: 正确答案是 C，因为……" } }]
      });
    });

    try {
      await request(app)
        .post("/api/me/bootstrap")
        .set("x-wx-openid", "u-practice")
        .expect(200);

      const gen = await request(app)
        .post("/api/ai/practice/generate")
        .set("x-wx-openid", "u-practice")
        .send({ subject: "会计", difficulty: "basic", count: 1 })
        .expect(200);
      expect(gen.body.questions.length).toBe(1);
      // The generated questions hide the correct answer until graded.
      expect(gen.body.questions[0].correctAnswer).toBeUndefined();
      const questionId = gen.body.questions[0].id;

      // Submit a wrong answer → server still knows the right one and
      // can grade us as wrong.
      const grade = await request(app)
        .post("/api/ai/practice/grade")
        .set("x-wx-openid", "u-practice")
        .send({ questionId, userAnswer: "A" })
        .expect(200);
      expect(grade.body.correct).toBe(false);
      expect(grade.body.correctAnswer).toBe("C");
      expect(grade.body.explanation).toContain("解析");

      // 错题本 should now contain this row.
      const mistakes = await request(app)
        .get("/api/me/mistakes")
        .set("x-wx-openid", "u-practice")
        .expect(200);
      expect(mistakes.body.items.length).toBe(1);
      expect(mistakes.body.items[0].userAnswer).toBe("A");
      expect(mistakes.body.items[0].correctAnswer).toBe("C");
      expect(mistakes.body.items[0].aiExplanation).toContain("解析");

      // Marking mastered should hide the row from default list.
      await request(app)
        .post(`/api/me/mistakes/${questionId}/mastered`)
        .set("x-wx-openid", "u-practice")
        .send({ mastered: true })
        .expect(200);
      const afterMark = await request(app)
        .get("/api/me/mistakes")
        .set("x-wx-openid", "u-practice")
        .expect(200);
      expect(afterMark.body.items.length).toBe(0);
      // …unless we ask for mastered ones explicitly.
      const includeMastered = await request(app)
        .get("/api/me/mistakes?includeMastered=1")
        .set("x-wx-openid", "u-practice")
        .expect(200);
      expect(includeMastered.body.items.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("re-grading the same question is idempotent (no extra DeepSeek call)", async () => {
    const originalFetch = globalThis.fetch;
    let genCalls = 0;
    let gradeCalls = 0;
    (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      const isGenerator =
        body.response_format && body.response_format.type === "json_object";
      if (isGenerator) {
        genCalls += 1;
        return mockOk({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      question: "这是一道用于幂等性测试的会计题题干，长度足够通过校验。",
                      options: ["A. x", "B. y", "C. z", "D. w"],
                      correct_answer: "A"
                    }
                  ]
                })
              }
            }
          ]
        });
      }
      gradeCalls += 1;
      return mockOk({ choices: [{ message: { content: "解析" } }] });
    });

    try {
      await request(app)
        .post("/api/me/bootstrap")
        .set("x-wx-openid", "u-idem")
        .expect(200);
      const gen = await request(app)
        .post("/api/ai/practice/generate")
        .set("x-wx-openid", "u-idem")
        .send({ subject: "会计", difficulty: "basic", count: 1 })
        .expect(200);
      const id = gen.body.questions[0].id;
      await request(app)
        .post("/api/ai/practice/grade")
        .set("x-wx-openid", "u-idem")
        .send({ questionId: id, userAnswer: "B" })
        .expect(200);
      const repeatedCalls = gradeCalls;
      // Second submit should NOT trigger a new DeepSeek call.
      await request(app)
        .post("/api/ai/practice/grade")
        .set("x-wx-openid", "u-idem")
        .send({ questionId: id, userAnswer: "C" })
        .expect(200);
      expect(gradeCalls).toBe(repeatedCalls);
      expect(genCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("400s on an unknown difficulty", async () => {
    await request(app)
      .post("/api/me/bootstrap")
      .set("x-wx-openid", "u-badreq")
      .expect(200);
    await request(app)
      .post("/api/ai/practice/generate")
      .set("x-wx-openid", "u-badreq")
      .send({ subject: "会计", difficulty: "godlike", count: 1 })
      .expect(400);
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

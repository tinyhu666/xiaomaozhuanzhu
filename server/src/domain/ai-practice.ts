/**
 * AI 练习 — generate CPA practice questions and grade attempts via
 * the same DeepSeek backend that powers /api/ai/ask.
 *
 * Design choices
 * ==============
 *  - Questions are generated with `response_format: { type: "json_object" }`
 *    so we get clean structured output instead of regex-parsing
 *    free-form text.
 *  - Grading is a SEPARATE call. We do NOT trust the client to send
 *    "the correct answer" — that lets a hostile client mark anything
 *    as right. Instead the server keeps the correct_answer + uses
 *    the AI to author the explanation given the user's actual choice.
 *  - The same rate-limit counter as /api/ai/ask is used (via the
 *    ai.ts module) — practice calls are AI calls and count toward
 *    the same per-day cap.
 *  - All questions are multiple-choice with 2–6 options. Free-form
 *    answer grading is too unreliable for an automated loop at v1.
 */

import { z } from "zod";

import { AppError } from "../errors";
import { SUBJECTS, type Subject } from "../constants";
import type { PracticeDifficulty } from "../types";
import { defaultDeepSeekFetcher, getDailyAiCount, type DeepSeekFetcher } from "./ai";
import { formatShanghaiDate } from "./date-utils";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL_ID = "deepseek-v4-flash";
const AI_DAILY_LIMIT = 30;

/* -------------------------------------------------------------------------- */
/*  Prompts                                                                    */
/* -------------------------------------------------------------------------- */

const DIFFICULTY_GUIDANCE: Record<PracticeDifficulty, string> = {
  basic: "考察基础概念、定义、原则的直接辨析，难度低，适合初学。",
  intermediate: "考察典型业务场景的应用，包含一次计算或一次判断，难度中等。",
  exam: "对标 CPA 历年真题难度，含多个干扰项 + 多步推理 / 计算 / 法规细节。"
};

function buildGeneratorPrompt(subject: Subject, difficulty: PracticeDifficulty, count: number) {
  return `你是 CPA 备考练习题出题官。请为「${subject}」科目生成 ${count} 道${difficulty} 难度的多项选择题。

难度说明：${DIFFICULTY_GUIDANCE[difficulty]}

严格按 JSON Schema 输出（不要任何额外文字）：
{
  "questions": [
    {
      "question": "题干文字…",
      "options": ["A. 第一个选项", "B. 第二个选项", "C. 第三个选项", "D. 第四个选项"],
      "correct_answer": "A"
    }
  ]
}

要求：
1. 每题必须有 4 个选项（A/B/C/D），correct_answer 必须是 "A"/"B"/"C"/"D" 之一。
2. 选项要真实可信，不能有"以上都对/都错"这类水题。
3. 题干表述清晰，不超过 200 字。
4. 不要在选项里写解析；解析由后续步骤生成。
5. 题目内容必须与「${subject}」科目相关，覆盖 CPA 考纲范围内的考点。
6. 严禁生成与 CPA 备考无关的内容。`;
}

function buildGraderPrompt(args: {
  subject: Subject;
  question: string;
  options: string[];
  correctAnswer: string;
  userAnswer: string;
}) {
  const wrong = args.userAnswer !== args.correctAnswer;
  return `你是 CPA 备考解析助教。下面是一道题，请生成解析。

科目：${args.subject}
题干：${args.question}
选项：
${args.options.join("\n")}
正确答案：${args.correctAnswer}
${args.userAnswer ? `考生选择：${args.userAnswer}（${wrong ? "错误" : "正确"}）` : "考生未作答"}

请生成 150–300 字的中文解析，结构如下：
1. 一句话点明本题考点（如"考点：长期股权投资权益法转换"）。
2. ${wrong ? "解释为什么考生选的 " + args.userAnswer + " 错。" : "肯定答案的正确思路。"}
3. 给出正确答案的逻辑或公式。
4. 必要时引用准则编号 / 法条 / 公式（如《企业会计准则第 22 号》、增值税税率 13%）。

直接输出解析正文，不要重复题干或选项。`;
}

/* -------------------------------------------------------------------------- */
/*  Generator                                                                  */
/* -------------------------------------------------------------------------- */

const generatedQuestionSchema = z.object({
  question: z.string().min(5).max(2000),
  options: z.array(z.string().min(1).max(500)).min(2).max(6),
  correct_answer: z.string().min(1).max(8)
});
const generatorResponseSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(1).max(10)
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

export async function generatePracticeQuestions(args: {
  userId: string;
  subject: Subject;
  difficulty: PracticeDifficulty;
  count: number;
  now: Date;
  fetcher?: DeepSeekFetcher;
}): Promise<GeneratedQuestion[]> {
  if (!SUBJECTS.includes(args.subject)) {
    throw new AppError(400, "INVALID_INPUT", "subject must be one of " + SUBJECTS.join("/"));
  }
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(503, "AI_UNAVAILABLE", "AI 暂时无法使用（管理员未配置 DEEPSEEK_API_KEY）");
  }
  // Reuses /api/ai/ask's counter — keeps the per-day cap aggregate
  // across "ask" and "practice" so a user can't bypass it by mixing.
  if (getDailyAiCount(args.userId, args.now) >= AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      "AI_RATE_LIMITED",
      `今日 AI 调用已达上限（${AI_DAILY_LIMIT} 次，含问答 + 练习），明天再来吧。`
    );
  }
  const prompt = buildGeneratorPrompt(args.subject, args.difficulty, args.count);
  const response = await callDeepSeek(prompt, apiKey, args.fetcher);
  const parsed = generatorResponseSchema.safeParse(response);
  if (!parsed.success) {
    console.warn("[ai-practice] generator schema mismatch", parsed.error.flatten());
    throw new AppError(502, "AI_BAD_RESPONSE", "AI 出题格式异常，请重试");
  }
  return parsed.data.questions;
}

/* -------------------------------------------------------------------------- */
/*  Grader                                                                     */
/* -------------------------------------------------------------------------- */

export async function generateGradeExplanation(args: {
  userId: string;
  subject: Subject;
  question: string;
  options: string[];
  correctAnswer: string;
  userAnswer: string;
  now: Date;
  fetcher?: DeepSeekFetcher;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(503, "AI_UNAVAILABLE", "AI 暂时无法使用（管理员未配置 DEEPSEEK_API_KEY）");
  }
  if (getDailyAiCount(args.userId, args.now) >= AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      "AI_RATE_LIMITED",
      `今日 AI 调用已达上限（${AI_DAILY_LIMIT} 次），明天再来吧。`
    );
  }
  const prompt = buildGraderPrompt({
    subject: args.subject,
    question: args.question,
    options: args.options,
    correctAnswer: args.correctAnswer,
    userAnswer: args.userAnswer
  });
  const response = await callDeepSeek(prompt, apiKey, args.fetcher, /* expectJson */ false);
  if (typeof response !== "string" || !response.trim()) {
    throw new AppError(502, "AI_EMPTY", "AI 未返回解析，请稍后重试");
  }
  return response.trim();
}

/* -------------------------------------------------------------------------- */
/*  Low-level DeepSeek call                                                    */
/* -------------------------------------------------------------------------- */

async function callDeepSeek(
  userPrompt: string,
  apiKey: string,
  fetcher: DeepSeekFetcher = defaultDeepSeekFetcher,
  expectJson = true
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: expectJson ? 1500 : 800,
    temperature: 0.4,
    stream: false
  };
  if (expectJson) {
    body.response_format = { type: "json_object" };
  }
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[ai-practice] network error", message);
    throw new AppError(502, "AI_NETWORK", "AI 服务暂时无法连通，请稍后再试");
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (_) {
      /* ignore */
    }
    console.warn("[ai-practice] upstream non-2xx", response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new AppError(429, "AI_UPSTREAM_LIMIT", "AI 服务暂时繁忙，请稍后再试");
    }
    throw new AppError(502, "AI_UPSTREAM_ERROR", "AI 暂时无法响应，请稍后再试");
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (_) {
    throw new AppError(502, "AI_BAD_RESPONSE", "AI 返回了无法解析的内容");
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AppError(502, "AI_EMPTY", "AI 未返回内容，请重试");
  }

  if (!expectJson) return content;

  // Parse JSON output. DeepSeek with response_format=json_object
  // returns a JSON string in the content field.
  try {
    return JSON.parse(content);
  } catch (error) {
    console.warn("[ai-practice] non-json content", content.slice(0, 200));
    throw new AppError(502, "AI_BAD_RESPONSE", "AI 输出格式异常，请重试");
  }
}

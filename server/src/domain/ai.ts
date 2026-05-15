/**
 * CPA-focused AI Q&A backed by DeepSeek's chat-completions API.
 *
 * Architecture
 * ============
 *   Miniprogram ──HTTP──▶ /api/ai/ask ──HTTPS──▶ api.deepseek.com
 *
 * The API key NEVER leaves the server. We hold it in DEEPSEEK_API_KEY
 * env var (set in 微信云托管 → 服务设置 → 环境变量). If the env var
 * is missing the endpoint returns 503 so a forgotten deploy doesn't
 * silently quote-fail.
 *
 * Cost / abuse protection
 * =======================
 *   1. Per-user soft rate limit: AI_DAILY_LIMIT questions per
 *      calendar day, tracked in-memory keyed on (userId, YYYY-MM-DD).
 *      Survives cloud-run instance lifetime only — a restart resets
 *      the counter. That's acceptable: DeepSeek-v4-flash is cheap
 *      and the cap exists primarily to deter loops / fuzzing.
 *   2. Question length cap (validated upstream by zod): 1000 chars.
 *   3. max_tokens on the DeepSeek call: 800 (≈ a generous answer
 *      without runaway essays).
 *   4. Temperature 0.3 — focused, less hallucination on准则编号.
 *
 * System prompt
 * =============
 * Tightly scoped to CPA-related Q&A. Refuses off-topic asks and
 * directs the user back to the exam context. Prompts the model to
 * cite specific 准则号 / 法条 when relevant, and to say "不确定" when
 * it is — better than confidently wrong on tax cutoffs etc.
 */

import { AppError } from "../errors";
import { formatShanghaiDate } from "./date-utils";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL_ID = "deepseek-v4-flash";
const AI_DAILY_LIMIT = 30;

/** System prompt — kept in one place so we can iterate on tone safely. */
export const AI_SYSTEM_PROMPT = `你是「小猫专注」小程序内置的 CPA 备考助教，专注解答中国注册会计师全国统一考试相关问题。

服务范围：
- 注册阶段六科：会计 / 审计 / 财务成本管理 / 公司战略与风险管理 / 经济法 / 税法
- 综合阶段两卷的题型与备考思路
- 报名、缴费、准考证、成绩查询等考试流程问题
- 备考方法、时间规划、错题复习、心态调整

回答风格要求：
1. 全程使用简体中文。
2. 答案要简洁、有结构，适合手机屏幕阅读：可用 1) 2) 3) 或短段落，避免长篇大段。
3. 涉及准则、税法条文、合同法条款时，准确引用具体编号或名称，如"《企业会计准则第 22 号——金融工具确认和计量》"。
4. 涉及具体数字（税率、阈值、天数）时，明确所述年份。如不能确定最新调整，必须主动说明"以当年财政部 / 国家税务总局发布为准"。
5. 不要编造案例或数据。不确定时直接说"不确定"或"建议查阅原文"。
6. 拒绝与 CPA 无关的请求（聊天、写代码、写文章等），礼貌引导回考试主题。
7. 不替考生做选择类决策（如"我应该报哪两科"），可以列利弊，让考生自己判断。

回答末尾如果用到了具体法条/准则，附一句"参考资料：xxx"。`;

/** In-memory daily call counter, keyed on `${userId}|${YYYY-MM-DD}`. */
const dailyCounts = new Map<string, number>();

function counterKey(userId: string, now: Date): string {
  return `${userId}|${formatShanghaiDate(now)}`;
}

/** Test-only: clear the counter between cases. */
export function __resetAiCountersForTests() {
  dailyCounts.clear();
}

/** Read-only count getter — used by both the gate and the response payload. */
export function getDailyAiCount(userId: string, now: Date): number {
  return dailyCounts.get(counterKey(userId, now)) ?? 0;
}

/**
 * Increment after a successful call. Exported so /api/ai/practice/*
 * endpoints can share the same daily counter — a user shouldn't be
 * able to bypass the cap by alternating between "ask" and "practice".
 */
export function bumpDailyAiCount(userId: string, now: Date) {
  const key = counterKey(userId, now);
  dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
}

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiAskInput = {
  userId: string;
  question: string;
  /** Recent conversation turns the client wants the model to consider. */
  history?: AiMessage[];
  now: Date;
};

export type AiAskResult = {
  answer: string;
  /** Tokens consumed by this call, surfaced for client-side display. */
  usedToday: number;
  dailyLimit: number;
};

export type DeepSeekFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/**
 * Default fetcher wraps global fetch with a 25-second abort so a
 * stuck DeepSeek call can't lock our worker.
 */
export const defaultDeepSeekFetcher: DeepSeekFetcher = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Main entry point — validates rate limit, calls DeepSeek, increments
 * the per-day counter on success. Returns either the answer or a
 * thrown AppError that the route handler maps to an HTTP status.
 */
export async function askAi(
  input: AiAskInput,
  fetcher: DeepSeekFetcher = defaultDeepSeekFetcher
): Promise<AiAskResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      503,
      "AI_UNAVAILABLE",
      "AI 暂时无法使用（管理员未配置 DEEPSEEK_API_KEY）"
    );
  }

  const used = getDailyAiCount(input.userId, input.now);
  if (used >= AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      "AI_RATE_LIMITED",
      `今日 AI 提问已达上限（${AI_DAILY_LIMIT} 次），明天再来吧。`
    );
  }

  const history = (input.history ?? []).slice(-6); // cap for cost + relevance
  const messages = [
    { role: "system", content: AI_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: input.question }
  ];

  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages,
        max_tokens: 800,
        temperature: 0.3,
        stream: false
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[ai] network error", message);
    throw new AppError(502, "AI_NETWORK", "AI 服务暂时无法连通，请稍后再试");
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (_) {
      /* ignore */
    }
    console.warn("[ai] upstream non-2xx", response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new AppError(429, "AI_UPSTREAM_LIMIT", "AI 服务暂时繁忙，请稍后再试");
    }
    throw new AppError(502, "AI_UPSTREAM_ERROR", "AI 暂时无法回答，请稍后再试");
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch (_) {
    throw new AppError(502, "AI_BAD_RESPONSE", "AI 返回了无法解析的内容");
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AppError(502, "AI_EMPTY", "AI 未返回内容，请换个问法试试");
  }

  bumpDailyAiCount(input.userId, input.now);
  return {
    answer: content.trim(),
    usedToday: getDailyAiCount(input.userId, input.now),
    dailyLimit: AI_DAILY_LIMIT
  };
}

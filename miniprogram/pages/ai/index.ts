// @ts-nocheck
import {
  askAi,
  generatePracticeQuiz,
  gradePracticeAnswer,
  type GeneratedQuestion,
  type PracticeDifficulty
} from "../../utils/api";

/**
 * AI 助教 — two modes in one tab:
 *  - 问答 (askMode): free-form CPA Q&A backed by /api/ai/ask
 *  - 练习 (practiceMode): pick subject + difficulty, AI generates a
 *    batch of MCQs; user answers each; mistakes auto-flow into 错题本
 *
 * The page is purely client-side state. Switching modes preserves
 * the conversation history (in case the user wants to come back),
 * but clears the in-flight practice batch (a half-answered batch
 * across tab switches felt confusing in design review).
 */

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

/** Per-question view-model inside a practice batch. */
type PracticeRow = {
  id: string;
  question: string;
  options: string[];
  /** Letter the user picked, e.g. "A". Null until submitted. */
  userAnswer: string | null;
  /** Server's correct-answer letter — only set after grading. */
  correctAnswer: string | null;
  /** AI explanation text — only set after grading. */
  explanation: string;
  /** Whether this question is done (graded). */
  graded: boolean;
  /** Index in the batch (1-based) for display. */
  index: number;
};

type AiPageData = {
  mode: "ask" | "practice";
  // -- ask mode --
  messages: ChatMessage[];
  inputValue: string;
  sending: boolean;
  scrollIntoView: string;
  // -- practice mode --
  practiceSubject: string;
  practiceDifficulty: PracticeDifficulty;
  practiceSubjects: Array<{ label: string; active: boolean }>;
  practiceDifficulties: Array<{ key: PracticeDifficulty; label: string; desc: string; active: boolean }>;
  practiceRows: PracticeRow[];
  /** Index of the row currently being answered (or graded). */
  practiceCursor: number;
  practiceGenerating: boolean;
  practiceGrading: boolean;
  practiceError: string;
  // -- shared --
  usageLabel: string;
  samples: string[];
};

const SAMPLE_QUESTIONS = [
  "长期股权投资由成本法转权益法时怎么追溯调整？",
  "增值税进项税额转出的常见情形有哪些？",
  "CPA 综合阶段的英语题分值多少，要不要做？",
  "审计风险评估的关键流程是什么？"
];

const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"] as const;
const DIFFICULTIES: Array<{ key: PracticeDifficulty; label: string; desc: string }> = [
  { key: "basic", label: "基础", desc: "概念辨析，初学友好" },
  { key: "intermediate", label: "进阶", desc: "典型应用 + 一次计算" },
  { key: "exam", label: "真题级", desc: "对标历年真题难度" }
];

const PRACTICE_LAST_SUBJECT_KEY = "cpa.practice.lastSubject";
const PRACTICE_LAST_DIFFICULTY_KEY = "cpa.practice.lastDifficulty";

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
}

Page<{}, AiPageData>({
  data: {
    mode: "ask",
    messages: [],
    inputValue: "",
    sending: false,
    scrollIntoView: "",
    practiceSubject: "",
    practiceDifficulty: "basic",
    practiceSubjects: SUBJECTS.map((s) => ({ label: s, active: false })),
    practiceDifficulties: DIFFICULTIES.map((d) => ({ ...d, active: d.key === "basic" })),
    practiceRows: [],
    practiceCursor: 0,
    practiceGenerating: false,
    practiceGrading: false,
    practiceError: "",
    usageLabel: "",
    samples: SAMPLE_QUESTIONS
  },

  onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // 4 tabs: 首页 / 日历 / AI / 我的 → AI is index 2
    tabBar?.setData?.({ selected: 2 });
    // Restore the user's last practice picker on first show. We do
    // NOT restore the chat history — fresh tab visits feel cleaner.
    if (this.data.practiceSubject) return;
    try {
      const savedSubject = wx.getStorageSync(PRACTICE_LAST_SUBJECT_KEY);
      const savedDifficulty = wx.getStorageSync(PRACTICE_LAST_DIFFICULTY_KEY);
      const subject = SUBJECTS.includes(savedSubject) ? savedSubject : "";
      const difficulty: PracticeDifficulty =
        DIFFICULTIES.some((d) => d.key === savedDifficulty) ? savedDifficulty : "basic";
      this.setData({
        practiceSubject: subject,
        practiceDifficulty: difficulty,
        practiceSubjects: SUBJECTS.map((s) => ({ label: s, active: s === subject })),
        practiceDifficulties: DIFFICULTIES.map((d) => ({ ...d, active: d.key === difficulty }))
      });
    } catch (_) {
      /* storage rejection is silent — defaults take over */
    }
  },

  /* ============ Mode toggle ============ */

  onTapMode(event: WechatMiniprogram.BaseEvent) {
    const next = event.currentTarget.dataset.mode as "ask" | "practice";
    if (!next || next === this.data.mode) return;
    this.setData({ mode: next });
  },

  /* ============ ASK MODE ============ */

  onInput(event: WechatMiniprogram.Input) {
    this.setData({ inputValue: event.detail.value });
  },

  onTapSample(event: WechatMiniprogram.BaseEvent) {
    const question = String(event.currentTarget.dataset.q ?? "").trim();
    if (!question || this.data.sending) return;
    this.sendAsk(question);
  },

  onConfirm() {
    const text = this.data.inputValue.trim();
    if (!text || this.data.sending) return;
    this.sendAsk(text);
  },

  onSendTap() {
    this.onConfirm();
  },

  async sendAsk(text: string) {
    if (text.length < 5) {
      wx.showToast({ title: "问题太短，再说详细一点", icon: "none" });
      return;
    }
    if (text.length > 1000) {
      wx.showToast({ title: "问题超长（1000 字以内）", icon: "none" });
      return;
    }
    const userMsg: ChatMessage = { id: nextId("u"), role: "user", content: text };
    const pendingMsg: ChatMessage = { id: nextId("a"), role: "assistant", content: "", pending: true };
    this.setData({
      messages: [...this.data.messages, userMsg, pendingMsg],
      inputValue: "",
      sending: true,
      scrollIntoView: pendingMsg.id
    });

    try {
      const history = this.data.messages
        .filter((m) => !m.pending && m.content)
        .slice(-4)
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await askAi({ question: text, history });
      this.replacePending(pendingMsg.id, result.answer);
      this.setData({ usageLabel: `今日已用 ${result.usedToday} / ${result.dailyLimit}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "出错了，请稍后再试";
      this.replacePending(pendingMsg.id, `⚠️ ${message}`);
    } finally {
      this.setData({ sending: false });
    }
  },

  replacePending(id: string, content: string) {
    const messages = this.data.messages.map((m) =>
      m.id === id ? { ...m, content, pending: false } : m
    );
    this.setData({ messages, scrollIntoView: id });
  },

  onLongPressAnswer(event: WechatMiniprogram.BaseEvent) {
    const content = String(event.currentTarget.dataset.content ?? "");
    if (!content) return;
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
      fail: () => { /* silent */ }
    });
  },

  onResetTap() {
    if (!this.data.messages.length) return;
    wx.showModal({
      title: "清空对话",
      content: "清空当前问答历史，开启新的提问。已用的提问次数不会重置。",
      confirmText: "清空",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ messages: [], scrollIntoView: "" });
      }
    });
  },

  /* ============ PRACTICE MODE ============ */

  onTapPracticeSubject(event: WechatMiniprogram.BaseEvent) {
    if (this.data.practiceGenerating || this.data.practiceRows.length) return;
    const label = String(event.currentTarget.dataset.label ?? "");
    const next = this.data.practiceSubject === label ? "" : label;
    this.setData({
      practiceSubject: next,
      practiceSubjects: SUBJECTS.map((s) => ({ label: s, active: s === next }))
    });
    try {
      if (next) wx.setStorageSync(PRACTICE_LAST_SUBJECT_KEY, next);
    } catch (_) { /* ignore */ }
  },

  onTapPracticeDifficulty(event: WechatMiniprogram.BaseEvent) {
    if (this.data.practiceGenerating || this.data.practiceRows.length) return;
    const key = event.currentTarget.dataset.key as PracticeDifficulty;
    if (!key || key === this.data.practiceDifficulty) return;
    this.setData({
      practiceDifficulty: key,
      practiceDifficulties: DIFFICULTIES.map((d) => ({ ...d, active: d.key === key }))
    });
    try {
      wx.setStorageSync(PRACTICE_LAST_DIFFICULTY_KEY, key);
    } catch (_) { /* ignore */ }
  },

  async onTapGenerate() {
    if (!this.data.practiceSubject) {
      wx.showToast({ title: "先选一个科目", icon: "none" });
      return;
    }
    if (this.data.practiceGenerating) return;
    this.setData({ practiceGenerating: true, practiceError: "" });
    try {
      const result = await generatePracticeQuiz({
        subject: this.data.practiceSubject,
        difficulty: this.data.practiceDifficulty,
        count: 3
      });
      const rows: PracticeRow[] = result.questions.map((q, i) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        userAnswer: null,
        correctAnswer: null,
        explanation: "",
        graded: false,
        index: i + 1
      }));
      this.setData({
        practiceRows: rows,
        practiceCursor: 0,
        usageLabel: `今日已用 ${result.usedToday} / ${result.dailyLimit}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "出题失败，请稍后再试";
      this.setData({ practiceError: message });
    } finally {
      this.setData({ practiceGenerating: false });
    }
  },

  onTapOption(event: WechatMiniprogram.BaseEvent) {
    const letter = String(event.currentTarget.dataset.letter ?? "");
    const rowId = String(event.currentTarget.dataset.id ?? "");
    if (!letter || !rowId) return;
    const rows = this.data.practiceRows.map((r) =>
      r.id === rowId && !r.graded ? { ...r, userAnswer: letter } : r
    );
    this.setData({ practiceRows: rows });
  },

  async onTapSubmitRow(event: WechatMiniprogram.BaseEvent) {
    const rowId = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.practiceRows.find((r) => r.id === rowId);
    if (!row || row.graded) return;
    if (!row.userAnswer) {
      wx.showToast({ title: "请先选一个选项", icon: "none" });
      return;
    }
    if (this.data.practiceGrading) return;
    this.setData({ practiceGrading: true });
    try {
      const result = await gradePracticeAnswer({
        questionId: row.id,
        userAnswer: row.userAnswer
      });
      const rows = this.data.practiceRows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              graded: true,
              correctAnswer: result.correctAnswer,
              explanation: result.explanation
            }
          : r
      );
      this.setData({
        practiceRows: rows,
        usageLabel: `今日已用 ${result.usedToday} / ${result.dailyLimit}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "判分失败，请稍后再试";
      wx.showToast({ title: message, icon: "none", duration: 2500 });
    } finally {
      this.setData({ practiceGrading: false });
    }
  },

  onTapResetPractice() {
    if (!this.data.practiceRows.length) return;
    this.setData({ practiceRows: [], practiceCursor: 0, practiceError: "" });
  },

  onTapOpenMistakes() {
    wx.navigateTo({ url: "/package-profile/mistakes/index" });
  }
});

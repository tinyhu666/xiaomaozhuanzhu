// @ts-nocheck
import { askAi } from "../../utils/api";

/**
 * AI 助教 — chat-style CPA Q&A backed by /api/ai/ask (DeepSeek
 * proxy). The page is purely client-side state; no server-side
 * conversation persistence. On unload the history clears, which is
 * deliberate — a new tab visit feels fresh and avoids any worry
 * about old context biasing answers.
 *
 * UX choices
 * ----------
 *  - Empty state shows 4 example questions the user can tap to send
 *    instantly. Lowers the bar for first-time use.
 *  - Each turn is rendered as a chat bubble: right-aligned mint
 *    bubbles for the user, left-aligned white cards for AI.
 *  - While waiting on a response, a typing indicator (three dots)
 *    occupies the AI side so the user has a clear "I sent it" signal.
 *  - Sending uses the keyboard's send button (`bindconfirm`) AND a
 *    visible 发送 button so power users have both paths.
 *  - We send the last 4 turns as history so the model can do simple
 *    follow-up Q without burning all tokens on context.
 *  - Long-press on any AI bubble copies the text to clipboard.
 */

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** When true, this bubble renders the typing indicator instead of text. */
  pending?: boolean;
};

type AiPageData = {
  messages: ChatMessage[];
  inputValue: string;
  sending: boolean;
  /** Where to scroll the chat view — used by scroll-into-view. */
  scrollIntoView: string;
  /** Daily usage display: "已用 3 / 30". */
  usageLabel: string;
  /** "Click a sample to start" prompts shown only when chat is empty. */
  samples: string[];
};

const SAMPLE_QUESTIONS = [
  "长期股权投资由成本法转权益法时怎么追溯调整？",
  "增值税进项税额转出的常见情形有哪些？",
  "CPA 综合阶段的英语题分值多少，要不要做？",
  "审计风险评估的关键流程是什么？"
];

let messageSeq = 0;
function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
}

Page<{}, AiPageData>({
  data: {
    messages: [],
    inputValue: "",
    sending: false,
    scrollIntoView: "",
    usageLabel: "",
    samples: SAMPLE_QUESTIONS
  },

  onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // 4 tabs: 首页 / 日历 / AI / 我的 → AI is index 2
    tabBar?.setData?.({ selected: 2 });
  },

  onInput(event: WechatMiniprogram.Input) {
    this.setData({ inputValue: event.detail.value });
  },

  onTapSample(event: WechatMiniprogram.BaseEvent) {
    const question = String(event.currentTarget.dataset.q ?? "").trim();
    if (!question || this.data.sending) return;
    this.send(question);
  },

  onConfirm() {
    const text = this.data.inputValue.trim();
    if (!text || this.data.sending) return;
    this.send(text);
  },

  onSendTap() {
    this.onConfirm();
  },

  /**
   * Send `text` through /api/ai/ask. Optimistically pushes the user
   * bubble + a pending AI bubble, then patches the AI bubble with
   * the real answer or an error message. Keeps the user from
   * spamming with `sending` lock.
   */
  async send(text: string) {
    if (!text || this.data.sending) return;

    // Validate length client-side so users get instant feedback
    // instead of waiting for a 400 round-trip.
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
    const nextMessages = [...this.data.messages, userMsg, pendingMsg];
    this.setData({
      messages: nextMessages,
      inputValue: "",
      sending: true,
      scrollIntoView: pendingMsg.id
    });

    try {
      // Send the last 4 conversational turns (user + assistant) as
      // context. We strip the pending bubble (it has no content yet)
      // and anything older than the cap.
      const history = this.data.messages
        .filter((m) => !m.pending && m.content)
        .slice(-4)
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await askAi({ question: text, history });
      this.replacePending(pendingMsg.id, result.answer);
      this.setData({
        usageLabel: `今日已用 ${result.usedToday} / ${result.dailyLimit}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "出错了，请稍后再试";
      this.replacePending(pendingMsg.id, `⚠️ ${message}`);
    } finally {
      this.setData({ sending: false });
    }
  },

  /** Find a pending placeholder by id and swap in the real content. */
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
      fail: () => { /* clipboard rejection is silent — toast would be redundant */ }
    });
  },

  onResetTap() {
    if (!this.data.messages.length) return;
    wx.showModal({
      title: "清空对话",
      content: "清空当前对话历史，开启新的提问。已用的提问次数不会重置。",
      confirmText: "清空",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ messages: [], scrollIntoView: "" });
      }
    });
  }
});

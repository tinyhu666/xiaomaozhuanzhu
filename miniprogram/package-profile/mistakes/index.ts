// @ts-nocheck
import { listMistakes, setMistakeMastered, type Mistake } from "../../utils/api";

/**
 * 错题本 — list every mistake the user made in the AI practice mode,
 * with the AI's explanation inline. Tapping "已掌握" moves the row
 * out of the default list (it's filtered server-side via the
 * `includeMastered` query param). The list is read-only otherwise;
 * we don't currently allow re-attempting from here because the AI
 * grader's call cost (one DeepSeek round-trip per submit) makes
 * unlimited re-tries expensive — surface that in a later iteration
 * once we add caching.
 */

type MistakeVM = Mistake & {
  difficultyLabel: string;
  dateText: string;
};

type MistakesPageData = {
  items: MistakeVM[];
  loading: boolean;
  errorMessage: string;
  showMastered: boolean;
  emptyMessage: string;
};

const DIFFICULTY_LABEL: Record<string, string> = {
  basic: "基础",
  intermediate: "进阶",
  exam: "真题级"
};

function formatDateText(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch {
    return "";
  }
}

function decorate(item: Mistake): MistakeVM {
  return {
    ...item,
    difficultyLabel: DIFFICULTY_LABEL[item.difficulty] ?? item.difficulty,
    dateText: formatDateText(item.answeredAt ?? item.createdAt)
  };
}

Page<{}, MistakesPageData>({
  data: {
    items: [],
    loading: true,
    errorMessage: "",
    showMastered: false,
    emptyMessage: "还没有错题。去 AI 练习几道题试试。"
  },

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    try {
      await this.refresh();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async refresh() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await listMistakes({
        limit: 100,
        includeMastered: this.data.showMastered
      });
      this.setData({
        items: (result.items ?? []).map(decorate),
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "加载失败"
      });
    }
  },

  onToggleShowMastered() {
    this.setData({ showMastered: !this.data.showMastered }, () => {
      this.refresh();
    });
  },

  /**
   * Flip a single row's "mastered" flag. When the toggle hides
   * mastered rows (the default), marking-as-mastered makes the row
   * disappear from the list — we patch local state immediately for
   * snappy feedback, then trust the server response.
   */
  async onTapMastered(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.items.find((it) => it.id === id);
    if (!row) return;
    const nextValue = !row.isMastered;
    // Optimistic update — drop the row from the list immediately if
    // we're in default (hide-mastered) mode.
    const optimistic = this.data.items
      .map((it) => (it.id === id ? { ...it, isMastered: nextValue } : it))
      .filter((it) => (this.data.showMastered ? true : !it.isMastered));
    this.setData({ items: optimistic });
    try {
      await setMistakeMastered(id, nextValue);
      wx.showToast({ title: nextValue ? "已标记掌握" : "已移回错题", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "操作失败",
        icon: "none"
      });
      // Roll back by re-fetching.
      await this.refresh();
    }
  }
});

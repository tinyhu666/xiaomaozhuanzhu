// @ts-nocheck
import type { NewsCategory, NewsListItem } from "../../types/models";
import { getNewsList } from "../../utils/api";

/**
 * 动态 — CPA exam announcements + 备考 reference. The list pulls from
 * the server's news_items table; on the server side a lazy refresh
 * tops up CICPA content every 2h (see server/src/domain/news.ts).
 *
 * UX notes
 * --------
 *   - Category chips at the top let the user filter to 公告 / 大纲 /
 *     动态. Picking one resets the list and re-fetches.
 *   - Tab-switch race protection: each request captures the active
 *     category at request-time and discards stale responses if the
 *     user switched tabs mid-flight.
 *   - Keyset pagination via the `before` cursor (publishedAt). Hits
 *     the bottom of the list → loads the next page automatically.
 *   - Empty + error states are first-class: when the request fails
 *     we show the actual error so the user knows it's not just empty.
 */

type NewsTab = "all" | NewsCategory;

type NewsRowVM = NewsListItem & {
  dateText: string;
  categoryLabel: string;
};

type NewsPageData = {
  activeCategory: NewsTab;
  tabs: Array<{ key: NewsTab; label: string }>;
  items: NewsRowVM[];
  nextBefore: string | null;
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
};

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  announce: "公告",
  outline: "大纲",
  news: "备考"
};

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    // Convert to Shanghai wall-clock (UTC+8).
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function decorate(item: NewsListItem): NewsRowVM {
  return {
    ...item,
    dateText: formatDate(item.publishedAt),
    categoryLabel: CATEGORY_LABEL[item.category as NewsCategory] ?? ""
  };
}

Page<{}, NewsPageData>({
  data: {
    activeCategory: "all",
    tabs: [
      { key: "all", label: "全部" },
      { key: "announce", label: "公告" },
      { key: "outline", label: "大纲" },
      { key: "news", label: "备考" }
    ],
    items: [],
    nextBefore: null,
    loading: false,
    loadingMore: false,
    errorMessage: ""
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // 4 tabs: 首页 / 日历 / 动态 / 我的 → news is index 2
    tabBar?.setData?.({ selected: 2 });
    if (this.data.items.length === 0) {
      await this.loadFirstPage();
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadFirstPage();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadFirstPage() {
    // Capture the active tab at request-time so a category switch
    // mid-request can't overwrite the newer load with the stale one.
    const requestedTab = this.data.activeCategory;
    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await getNewsList({
        category: requestedTab,
        limit: 30
      });
      if (requestedTab !== this.data.activeCategory) return;
      this.setData({
        items: (result.items ?? []).map(decorate),
        nextBefore: result.nextBefore ?? null,
        loading: false
      });
    } catch (error) {
      if (requestedTab !== this.data.activeCategory) return;
      console.error("[news] load failed", error);
      this.setData({
        loading: false,
        items: [],
        errorMessage: error instanceof Error ? error.message : "加载失败，请下拉刷新"
      });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || !this.data.nextBefore) return;
    const requestedTab = this.data.activeCategory;
    const cursor = this.data.nextBefore;
    this.setData({ loadingMore: true });
    try {
      const result = await getNewsList({
        category: requestedTab,
        limit: 30,
        before: cursor
      });
      if (requestedTab !== this.data.activeCategory) return;
      const merged = [...this.data.items, ...(result.items ?? []).map(decorate)];
      this.setData({
        items: merged,
        nextBefore: result.nextBefore ?? null,
        loadingMore: false
      });
    } catch (error) {
      if (requestedTab !== this.data.activeCategory) return;
      console.warn("[news] load more failed", error);
      this.setData({ loadingMore: false });
    }
  },

  async onSwitchTab(event: WechatMiniprogram.BaseEvent) {
    const next = event.currentTarget.dataset.key as NewsTab;
    if (!next || next === this.data.activeCategory) return;
    this.setData({
      activeCategory: next,
      items: [],
      nextBefore: null,
      errorMessage: ""
    });
    await this.loadFirstPage();
  },

  onTapItem(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!id) return;
    wx.navigateTo({
      url: `/package-news/detail/index?id=${encodeURIComponent(id)}`
    });
  },

  onReachBottom() {
    this.loadMore();
  }
});

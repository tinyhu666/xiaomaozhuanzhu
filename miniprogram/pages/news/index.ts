// @ts-nocheck
import type { NewsCategory, NewsListItem } from "../../types/models";
import { getNewsList } from "../../utils/api";

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
  emptyHint: string;
};

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  announce: "公告",
  outline: "大纲",
  news: "动态"
};

function formatDate(iso: string): string {
  // The API returns ISO strings. Display as YYYY.MM.DD in Shanghai TZ.
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
      { key: "news", label: "动态" }
    ],
    items: [],
    nextBefore: null,
    loading: false,
    loadingMore: false,
    errorMessage: "",
    emptyHint: "暂无内容，下拉刷新试试"
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
    // Capture the tab at request-time. If the user switches categories
    // before the response lands, we discard the stale result to avoid
    // racing the newer in-flight load.
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
        errorMessage: error instanceof Error ? error.message : "加载失败"
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
      // Discard if user switched tabs mid-request, otherwise we'd
      // append items from category A onto category B's list.
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
      nextBefore: null
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

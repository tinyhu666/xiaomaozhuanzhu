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
    this.setData({ loading: true, errorMessage: "" });
    try {
      const result = await getNewsList({
        category: this.data.activeCategory,
        limit: 30
      });
      this.setData({
        items: (result.items ?? []).map(decorate),
        nextBefore: result.nextBefore ?? null,
        loading: false
      });
    } catch (error) {
      console.error("[news] load failed", error);
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "加载失败"
      });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || !this.data.nextBefore) return;
    this.setData({ loadingMore: true });
    try {
      const result = await getNewsList({
        category: this.data.activeCategory,
        limit: 30,
        before: this.data.nextBefore
      });
      const merged = [...this.data.items, ...(result.items ?? []).map(decorate)];
      this.setData({
        items: merged,
        nextBefore: result.nextBefore ?? null,
        loadingMore: false
      });
    } catch (error) {
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

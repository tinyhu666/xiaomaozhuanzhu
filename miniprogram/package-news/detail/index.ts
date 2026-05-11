// @ts-nocheck
import type { NewsDetail } from "../../types/models";
import { getNewsDetail } from "../../utils/api";

type NewsDetailPageData = {
  item: NewsDetail | null;
  dateText: string;
  categoryLabel: string;
  loading: boolean;
  errorMessage: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  announce: "公告",
  outline: "大纲",
  news: "动态"
};

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch {
    return iso.slice(0, 10);
  }
}

Page<{}, NewsDetailPageData>({
  data: {
    item: null,
    dateText: "",
    categoryLabel: "",
    loading: true,
    errorMessage: ""
  },

  async onLoad(query: Record<string, string>) {
    const id = query?.id;
    if (!id) {
      this.setData({ loading: false, errorMessage: "缺少新闻 ID" });
      return;
    }
    try {
      const result = await getNewsDetail(id);
      const item = result.item;
      this.setData({
        item,
        dateText: formatDate(item.publishedAt),
        categoryLabel: CATEGORY_LABEL[item.category] ?? "",
        loading: false
      });
      // Update the navigation bar title to match the article so the
      // user has a stable label for screenshot / share.
      if (item.title) {
        wx.setNavigationBarTitle({ title: item.title.slice(0, 16) });
      }
    } catch (error) {
      console.error("[news-detail] load failed", error);
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "加载失败"
      });
    }
  },

  onOpenSource() {
    const url = this.data.item?.url;
    if (!url) return;
    // External web pages can't open inside the miniprogram without a
    // business-domain whitelist. Copy the URL to clipboard so the user
    // can open it in a browser. We keep this gracefully degraded —
    // never throw on copy failure.
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: "链接已复制", icon: "success" });
      },
      fail: () => {
        wx.showModal({
          title: "原文链接",
          content: url,
          showCancel: false
        });
      }
    });
  }
});

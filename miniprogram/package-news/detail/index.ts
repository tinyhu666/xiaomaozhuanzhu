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
  news: "备考"
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
      this.setData({ loading: false, errorMessage: "找不到内容 ID" });
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
      // Use a short navigation-bar title so the user keeps context
      // about which article they're on, but doesn't see 80 chars
      // clipped mid-word.
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

  onCopyLink() {
    const url = this.data.item?.url;
    if (!url) return;
    // External web pages can't open inside the miniprogram without a
    // business-domain whitelist, so we copy the URL to clipboard and
    // toast. Falls back to a modal showing the link if clipboard is
    // unavailable (e.g. permission denied).
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: "链接已复制，可粘贴到浏览器", icon: "none", duration: 1800 });
      },
      fail: () => {
        wx.showModal({
          title: "原文链接",
          content: url,
          showCancel: false,
          confirmText: "我知道了"
        });
      }
    });
  }
});

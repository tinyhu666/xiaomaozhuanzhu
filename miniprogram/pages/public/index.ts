// @ts-nocheck
import type { PublicProfileResponse } from "../../types/models";
import { getPublicProfile } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type PublicPageData = {
  state: "loading" | "ready" | "error";
  errorMessage: string;
  data: PublicProfileResponse | null;
  totalText: string;
  recentSummaries: Array<{
    id: string;
    subject: string | null;
    summary: string;
    endedAt: string | null;
    endedAtLabel: string;
  }>;
};

Page<{}, PublicPageData>({
  data: {
    state: "loading",
    errorMessage: "",
    data: null,
    totalText: "0m",
    recentSummaries: []
  },

  async onLoad(query) {
    const slug = String(query.slug || "").trim();
    if (!slug) {
      this.setData({ state: "error", errorMessage: "缺少分享标识" });
      return;
    }
    await this.load(slug);
  },

  async load(slug: string) {
    try {
      const data = await getPublicProfile(slug);
      const recent = (data.recentSummaries || []).map((item) => ({
        id: item.id,
        subject: item.subject,
        summary: item.summary,
        endedAt: item.endedAt,
        endedAtLabel: item.endedAt ? formatEndedDate(item.endedAt) : ""
      }));
      this.setData({
        state: "ready",
        data,
        totalText: formatDuration(data.summary?.totalMinutes || 0),
        recentSummaries: recent
      });
    } catch (error) {
      console.error("[public] load failed", error);
      this.setData({
        state: "error",
        errorMessage: error instanceof Error ? error.message : "加载失败"
      });
    }
  },

  /**
   * Visitors can re-share the page they're viewing. We pass through
   * the same slug so the chain stays consistent.
   */
  onShareAppMessage() {
    const slug = this.data.data?.profile?.shareSlug ?? "";
    return {
      title: `${this.data.data?.profile?.nickname || "TA"} 在小猫专注的学习页`,
      path: `/pages/public/index?slug=${slug}`,
      imageUrl: ""
    };
  }
});

function formatEndedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Shanghai timezone display
  const shifted = new Date(d.getTime() + 8 * 60 * 60_000);
  const m = String(shifted.getUTCMonth() + 1);
  const day = String(shifted.getUTCDate());
  return `${m}.${day}`;
}

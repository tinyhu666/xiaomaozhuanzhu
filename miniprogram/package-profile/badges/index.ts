// @ts-nocheck
import type { Badge, ProfileDashboardResponse } from "../../types/models";
import { getProfileDashboard } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type BadgeView = Badge & {
  progressPct: number;
  progressText: string;
};

type BadgesPageData = {
  badges: BadgeView[];
  unlockedCount: number;
  totalCount: number;
};

Page<{}, BadgesPageData>({
  data: {
    badges: [],
    unlockedCount: 0,
    totalCount: 0
  },

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  async refresh() {
    wx.showNavigationBarLoading();
    try {
      const dashboard = (await getProfileDashboard()) as ProfileDashboardResponse;
      const raw = (dashboard.badges || []) as Badge[];
      const badges: BadgeView[] = raw.map((b) => ({
        ...b,
        progressPct: Math.round((b.progress || 0) * 100),
        progressText: formatBadgeProgress(b)
      }));
      this.setData({
        badges,
        totalCount: badges.length,
        unlockedCount: badges.filter((b) => b.unlocked).length
      });
    } catch (error) {
      console.error("[badges] dashboard failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  }
});

function formatBadgeProgress(b: Badge): string {
  if (b.unlocked) return "已解锁";
  if (b.unit === "min") {
    return `${formatDuration(b.current)} / ${formatDuration(b.goal)}`;
  }
  return `${b.current} / ${b.goal} ${b.unit}`;
}

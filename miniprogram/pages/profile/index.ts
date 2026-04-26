// @ts-nocheck
import type { Badge, ProfileDashboardResponse } from "../../types/models";
import { getProfileDashboard } from "../../utils/api";
import { buildSubjectSummary, formatDuration } from "../../utils/view-models";

type SubjectSummaryRow = ReturnType<typeof buildSubjectSummary>[number] & {
  barStyle: string;
};

type ProfilePageData = {
  profile: ProfileDashboardResponse["profile"] | null;
  totalMinutesText: string;
  streakText: string;
  longestStreakText: string;
  completedCountText: string;
  bestDayDateText: string;
  bestDayDurationText: string;
  subjectRows: SubjectSummaryRow[];
  badges: Badge[];
  unlockedBadgeCount: number;
};

Page<{}, ProfilePageData>({
  data: {
    profile: null,
    totalMinutesText: "0m",
    streakText: "0天",
    longestStreakText: "0天",
    completedCountText: "0次",
    bestDayDateText: "暂无",
    bestDayDurationText: "还没有学习记录",
    subjectRows: [],
    badges: [],
    unlockedBadgeCount: 0
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 2 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    await this.loadProfile();
  },

  async loadProfile() {
    try {
      const dashboard = await getProfileDashboard();
      const subjectRows = buildSubjectSummary(dashboard.subjects);
      const maxMinutes = subjectRows[0]?.totalMinutes ?? 0;
      const badges = dashboard.badges ?? [];
      const unlockedBadgeCount = badges.filter((badge) => badge.unlocked).length;

      this.setData({
        profile: dashboard.profile,
        totalMinutesText: formatDuration(dashboard.summary.totalMinutes),
        streakText: `${dashboard.summary.currentStreakDays}天`,
        longestStreakText: `${dashboard.summary.longestStreakDays ?? dashboard.summary.currentStreakDays}天`,
        completedCountText: `${dashboard.summary.completedSessionCount ?? 0}次`,
        bestDayDateText: dashboard.bestDay.date ? dashboard.bestDay.date.replace(/-/g, ".") : "暂无",
        bestDayDurationText: dashboard.bestDay.totalMinutes > 0 ? formatDuration(dashboard.bestDay.totalMinutes) : "还没有学习记录",
        subjectRows: subjectRows.map((item) => ({
          ...item,
          barStyle: `width: ${maxMinutes ? Math.max((item.totalMinutes / maxMinutes) * 100, 18) : 0}%`
        })),
        badges,
        unlockedBadgeCount
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载我的页面失败",
        icon: "none"
      });
    }
  },

  syncWechatProfile() {
    wx.navigateTo({
      url: "/package-profile/onboarding/index?mode=edit"
    });
  }
});

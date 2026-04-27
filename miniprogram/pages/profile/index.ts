// @ts-nocheck
import type { Badge, ProfileDashboardResponse } from "../../types/models";
import { getProfileDashboard } from "../../utils/api";
import { buildSubjectProgress, formatDuration } from "../../utils/view-models";

type SubjectProgressRow = ReturnType<typeof buildSubjectProgress>[number] & {
  barStyle: string;
  ratioText: string;
};

type ProfilePageData = {
  profile: ProfileDashboardResponse["profile"] | null;
  totalMinutesText: string;
  streakText: string;
  longestStreakText: string;
  completedCountText: string;
  bestDayDateText: string;
  bestDayDurationText: string;
  subjectRows: SubjectProgressRow[];
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
      const sourceSubjects = dashboard.subjectTargets ?? dashboard.subjects;
      const subjectRows = buildSubjectProgress(sourceSubjects).map((item) => ({
        ...item,
        barStyle: `width: ${Math.max(item.progressPercent, item.totalMinutes > 0 ? 6 : 0)}%`,
        ratioText: item.targetText ? `${item.durationText} / ${item.targetText}` : item.durationText
      }));
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
        subjectRows,
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

// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { Badge, ExamDateInfo, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, saveProfile, uploadAvatar } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type ProfilePageData = {
  profile: { nickname: string; avatarUrl: string };
  totalText: string;
  completedCount: number;
  currentStreak: number;
  longestStreak: number;
  badgeProgressLabel: string;
  subjectsHint: string;
  shareHint: string;
  appVersion: string;
  nextExam: null | {
    subject: string;
    dateLabel: string;
    daysRemaining: number;
    fallback: boolean;
    sourceYear: number;
  };
};

Page<{}, ProfilePageData>({
  data: {
    profile: { nickname: "", avatarUrl: "" },
    totalText: "0m",
    completedCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    badgeProgressLabel: "—",
    subjectsHint: "—",
    shareHint: "未开启",
    appVersion: runtimeConfig.appVersion,
    nextExam: null
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 3 });
    await getApp<IAppOption>().ensureProfile().catch((error) => {
      console.error("[profile] ensureProfile failed", error);
    });
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
      const summary = dashboard.summary || ({} as ProfileDashboardResponse["summary"]);
      const unlocked = (dashboard.badges || []).filter((b: Badge) => b.unlocked).length;
      const totalBadges = (dashboard.badges || []).length;
      const subjectsStarted = (dashboard.subjects || []).length;
      const subjectsCompleted = (dashboard.subjects || []).filter(
        (s: SubjectProgress) => (s.targetMinutes ?? 0) > 0 && s.totalMinutes >= (s.targetMinutes ?? 0)
      ).length;
      this.setData({
        profile: {
          nickname: dashboard.profile?.nickname || "",
          avatarUrl: dashboard.profile?.avatarUrl || ""
        },
        totalText: formatDuration(summary.totalMinutes || 0),
        completedCount: summary.completedSessionCount || 0,
        currentStreak: summary.currentStreakDays || 0,
        longestStreak: summary.longestStreakDays || 0,
        badgeProgressLabel: totalBadges ? `已解锁 ${unlocked} / ${totalBadges}` : "—",
        subjectsHint: subjectsStarted ? `${subjectsCompleted} / 6 已达目标` : "尚未开始任何科目",
        shareHint: dashboard.profile?.isPublic ? "已开启" : "未开启",
        nextExam: this.pickNextExam(dashboard.examSchedule)
      });
    } catch (error) {
      console.error("[profile] dashboard failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  /**
   * Pick the subject whose exam is closest in the future. If multiple
   * subjects share the same date (most CPA weekends do), prefer 会计
   * which is the heaviest subject and the natural "anchor".
   */
  pickNextExam(schedule?: ExamDateInfo[]) {
    if (!schedule || !schedule.length) return null;
    const future = schedule.filter((e) => e.daysRemaining >= 0);
    if (!future.length) return null;
    future.sort((a, b) => a.daysRemaining - b.daysRemaining);
    const minDays = future[0].daysRemaining;
    const sameDay = future.filter((e) => e.daysRemaining === minDays);
    const preferred = sameDay.find((e) => e.subject === "会计") ?? sameDay[0];
    return {
      subject: preferred.subject,
      dateLabel: preferred.date.replace(/-/g, ".").slice(2), // 25.08.23
      daysRemaining: preferred.daysRemaining,
      fallback: preferred.fallback,
      sourceYear: preferred.sourceYear
    };
  },

  async onChooseAvatar(event: WechatMiniprogram.CustomEvent) {
    const localUrl = event.detail?.avatarUrl as string | undefined;
    if (!localUrl) return;
    wx.showLoading({ title: "上传中…", mask: true });
    try {
      const uploaded = await uploadAvatar(localUrl);
      await saveProfile({
        nickname: this.data.profile.nickname || "CPA考生",
        avatarUrl: uploaded.fileId
      });
      this.setData({
        profile: { ...this.data.profile, avatarUrl: localUrl }
      });
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "头像更新失败",
        icon: "none"
      });
    } finally {
      wx.hideLoading();
    }
  },

  async onNicknameBlur(event: WechatMiniprogram.CustomEvent) {
    const value = ((event.detail?.value as string | undefined) ?? "").trim();
    if (!value || value === this.data.profile.nickname) return;
    try {
      await saveProfile({
        nickname: value,
        avatarUrl: this.data.profile.avatarUrl || ""
      });
      this.setData({ profile: { ...this.data.profile, nickname: value } });
      wx.showToast({ title: "昵称已保存", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "昵称保存失败",
        icon: "none"
      });
    }
  },

  openBadges() {
    wx.navigateTo({ url: "/package-profile/badges/index" });
  },

  openSubjects() {
    wx.navigateTo({ url: "/package-profile/subjects/index" });
  },

  openShare() {
    wx.navigateTo({ url: "/package-profile/share/index" });
  }
});

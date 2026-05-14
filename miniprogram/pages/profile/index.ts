// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { Badge, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, saveProfile, uploadAvatar } from "../../utils/api";
import { formatDuration, getDailyQuote } from "../../utils/view-models";

type ProfilePageData = {
  profile: { nickname: string; avatarUrl: string; profileCompleted: boolean };
  nicknameFocus: boolean;
  totalText: string;
  completedCount: number;
  currentStreak: number;
  longestStreak: number;
  badgeProgressLabel: string;
  subjectsHint: string;
  shareHint: string;
  appVersion: string;
  quoteEn: string;
  quoteZh: string;
  quoteDateLabel: string;
};

Page<{}, ProfilePageData>({
  data: {
    profile: { nickname: "", avatarUrl: "", profileCompleted: false },
    nicknameFocus: false,
    totalText: "0m",
    completedCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    badgeProgressLabel: "—",
    subjectsHint: "—",
    shareHint: "未开启",
    appVersion: runtimeConfig.appVersion,
    quoteEn: "One page at a time.",
    quoteZh: "一页一页，也是在前进。",
    quoteDateLabel: ""
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // 4 tabs: 首页 / 日历 / 动态 / 我的 → profile is index 3
    tabBar?.setData?.({ selected: 3 });
    // Refresh the daily quote each time the user opens this tab so a
    // re-entry mid-day picks a different line. getDailyQuote already
    // persists "last shown" to avoid back-to-back duplicates.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const quote = getDailyQuote(today);
    this.setData({
      quoteEn: quote.en,
      quoteZh: quote.zh,
      quoteDateLabel: `${now.getMonth() + 1}月${now.getDate()}日`
    });
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
      const subjects = dashboard.subjects || [];
      const subjectsStarted = subjects.length;
      const subjectsCompleted = subjects.filter(
        (s: SubjectProgress) => (s.targetMinutes ?? 0) > 0 && s.totalMinutes >= (s.targetMinutes ?? 0)
      ).length;
      // Distinguish "started but none-completed" from "nothing started"
      // so the user always sees their actual progress reflected.
      const subjectsLabel = !subjectsStarted
        ? "尚未开始任何科目"
        : subjectsCompleted > 0
          ? `${subjectsCompleted} / 6 已达目标`
          : `${subjectsStarted} 科在学 · 0/6 达标`;
      this.setData({
        profile: {
          nickname: dashboard.profile?.nickname || "",
          avatarUrl: dashboard.profile?.avatarUrl || "",
          profileCompleted: Boolean(dashboard.profile?.profileCompleted)
        },
        totalText: formatDuration(summary.totalMinutes || 0),
        completedCount: summary.completedSessionCount || 0,
        currentStreak: summary.currentStreakDays || 0,
        longestStreak: summary.longestStreakDays || 0,
        badgeProgressLabel: totalBadges ? `已解锁 ${unlocked} / ${totalBadges}` : "—",
        subjectsHint: subjectsLabel,
        shareHint: dashboard.profile?.isPublic ? "已开启" : "未开启"
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

  async onChooseAvatar(event: WechatMiniprogram.CustomEvent) {
    await this.handleChosenAvatar(event, false);
  },

  async handleChosenAvatar(event: WechatMiniprogram.CustomEvent, focusNicknameAfter: boolean) {
    const localUrl = event.detail?.avatarUrl as string | undefined;
    if (!localUrl) return;
    wx.showLoading({ title: "上传中…", mask: true });
    try {
      const uploaded = await uploadAvatar(localUrl);
      await saveProfile({
        // Preserve existing nickname; if none yet, leave empty so the
        // user is gently nudged to set it (the CTA stays visible until
        // a non-empty nickname has been saved).
        nickname: this.data.profile.nickname || "",
        avatarUrl: uploaded.fileId
      });
      this.setData({
        profile: { ...this.data.profile, avatarUrl: localUrl }
      });
      wx.showToast({ title: "头像已更新", icon: "success" });
      if (focusNicknameAfter) {
        // Two-step focus toggle: the `focus` attribute only fires
        // when its value flips, so we reset and re-set with a short
        // gap to guarantee the keyboard opens.
        this.setData({ nicknameFocus: false });
        setTimeout(() => {
          this.setData({ nicknameFocus: true });
        }, 120);
      }
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
    this.setData({ nicknameFocus: false });
    const value = ((event.detail?.value as string | undefined) ?? "").trim();
    if (!value || value === this.data.profile.nickname) return;
    try {
      await saveProfile({
        nickname: value,
        avatarUrl: this.data.profile.avatarUrl || ""
      });
      this.setData({
        profile: { ...this.data.profile, nickname: value, profileCompleted: true }
      });
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

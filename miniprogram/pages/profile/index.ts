// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { Badge, ExamDateInfo, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, saveProfile, uploadAvatar } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

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
    nextExam: null
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // 4 tabs: 首页 / 日历 / 动态 / 我的 → profile is index 3
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
    await this.handleChosenAvatar(event, false);
  },

  /**
   * Triggered by the "使用微信资料 · 一键填充" CTA. Same upload flow as
   * the small avatar tap, but additionally auto-focuses the nickname
   * input on success so the user lands directly on WeChat's nickname
   * picker keyboard — i.e. one CTA fills both fields with two taps.
   */
  async onUseWechatProfile(event: WechatMiniprogram.CustomEvent) {
    await this.handleChosenAvatar(event, true);
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

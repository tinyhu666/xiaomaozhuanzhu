// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { Badge, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, saveProfile, uploadAvatar } from "../../utils/api";
import { formatDuration, getDailyQuote } from "../../utils/view-models";

/**
 * Plain-Chinese hour label, e.g. 8 → "早上 8 点", 20 → "晚上 8 点",
 * 0 → "凌晨 0 点". The hour=0 case keeps the explicit "0" so the
 * sentence "凌晨 0 点最高效" is unambiguous (vs. "凌晨 12 点" which
 * could mean noon or midnight in casual speech).
 * Hour bands chosen to match how native speakers parse the day:
 *   0–5 凌晨 · 6–10 早上 · 11–12 中午 · 13–17 下午 · 18–23 晚上
 */
function hourLabel(hour: number): string {
  const h12 = hour === 0 ? 0 : hour > 12 ? hour - 12 : hour;
  let period: string;
  if (hour < 6) period = "凌晨";
  else if (hour < 11) period = "早上";
  else if (hour < 13) period = "中午";
  else if (hour < 18) period = "下午";
  else period = "晚上";
  return `${period} ${h12} 点`;
}

type HighlightCard = {
  key: "bestDay" | "bestWeek";
  label: string;
  value: string;
  caption: string;
};

type InsightView = {
  hasData: boolean;
  peakHourLabel: string;
  peakWeekdayLabel: string;
  bars: Array<{ height: number; hourLabel: string; isPeak: boolean }>;
};

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
  /** Three "personal record" cards shown below the hero. */
  highlights: HighlightCard[];
  /** Hourly + weekday focus pattern card. `hasData=false` hides it. */
  insights: InsightView;
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
    quoteDateLabel: "",
    highlights: [],
    insights: { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] }
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
        shareHint: dashboard.profile?.isPublic ? "已开启" : "未开启",
        highlights: this.buildHighlights(dashboard),
        insights: this.buildInsightsView(dashboard.patterns)
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

  /**
   * Three personal-record cards shown between the hero and stat grid.
   * Each one falls back to a "—" placeholder when the user hasn't
   * accumulated any data yet so the cards still render at the same
   * size (avoids layout shift after first session).
   */
  /**
   * Two "personal record" cards. We deliberately don't show 最长连签
   * here because it already lives in the stat-grid below — two
   * identical "5 天" numbers a few rpx apart would look like a bug.
   * If you want to add a third record, pick something the stat-grid
   * doesn't already surface (e.g. peak single-session, weekend
   * power-week).
   */
  buildHighlights(dashboard: ProfileDashboardResponse): HighlightCard[] {
    const records = dashboard.records;
    const bestDay = records?.bestDay ?? dashboard.bestDay ?? { date: null, totalMinutes: 0 };
    const bestWeek = records?.bestWeek ?? null;

    const bestDayCaption = bestDay.date
      ? bestDay.date.slice(5).replace("-", ".")
      : "—";
    const bestWeekCaption = bestWeek?.weekStart
      ? `${bestWeek.weekStart.slice(5).replace("-", ".")} 起`
      : "—";

    return [
      {
        key: "bestDay",
        label: "单日最长",
        value: bestDay.totalMinutes > 0 ? formatDuration(bestDay.totalMinutes) : "—",
        caption: bestDayCaption
      },
      {
        key: "bestWeek",
        label: "最佳一周",
        value: bestWeek && bestWeek.totalMinutes > 0 ? formatDuration(bestWeek.totalMinutes) : "—",
        caption: bestWeekCaption
      }
    ];
  },

  /**
   * Convert the server's raw 24-bin hourly pattern into a sparkline-
   * style mini chart: each hour becomes a vertical bar whose height
   * is proportional to that hour's share of the peak. We also emit
   * the peak hour label ("晚上 8 点") and the peak weekday label
   * ("周三") so the user gets a one-line "你最高效的时段是 X" sentence
   * with no further math.
   */
  buildInsightsView(patterns?: ProfileDashboardResponse["patterns"]): InsightView {
    if (!patterns || !patterns.hourly?.length) {
      return { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] };
    }
    // Hide the card entirely when the user has zero minutes recorded
    // anywhere — a flat zero chart is not informative.
    const hourlySum = patterns.hourly.reduce((sum, value) => sum + value, 0);
    if (hourlySum <= 0) {
      return { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] };
    }
    const max = Math.max(...patterns.hourly, 1);
    const bars = patterns.hourly.map((minutes, hour) => ({
      // Floor at 4% so empty hours still render a tiny stub bar,
      // making the chart look like a chart instead of a gap row.
      height: minutes > 0 ? Math.max(8, Math.round((minutes / max) * 100)) : 4,
      hourLabel: hour % 6 === 0 ? `${hour}时` : "",
      isPeak: patterns.peakHour !== null && hour === patterns.peakHour
    }));

    const peakHourLabel = patterns.peakHour === null ? "—" : hourLabel(patterns.peakHour);
    const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const peakWeekdayLabel = patterns.peakWeekday === null
      ? "—"
      : weekdayNames[patterns.peakWeekday] || "—";

    return { hasData: true, peakHourLabel, peakWeekdayLabel, bars };
  },

  openBadges() {
    wx.navigateTo({ url: "/package-profile/badges/index" });
  },

  openSubjects() {
    wx.navigateTo({ url: "/package-profile/subjects/index" });
  },

  openShare() {
    wx.navigateTo({ url: "/package-profile/share/index" });
  },

  openPoster() {
    wx.navigateTo({ url: "/package-profile/poster/index" });
  },

  openMistakes() {
    wx.navigateTo({ url: "/package-profile/mistakes/index" });
  },

  openSettings() {
    wx.navigateTo({ url: "/package-profile/settings/index" });
  }
});

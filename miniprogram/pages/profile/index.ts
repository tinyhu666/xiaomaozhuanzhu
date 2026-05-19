// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { Badge, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, listMySessions, saveProfile, uploadAvatar } from "../../utils/api";
import { consumeMonthlySummary, type MonthlySummary } from "../../utils/monthly";
import { consumeWeeklyRecap, type WeeklyRecap } from "../../utils/weekly-recap";
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

/**
 * v0.15: collapsed the old "records" row (single-day-longest / best-
 * week) into the same 4-tile stat grid as the cumulative numbers,
 * so the page has one place to look for "how am I doing" instead of
 * two competing blocks.
 */
type StatTileView = {
  key: string;
  label: string;
  value: string;
  unit: string;
  caption: string;
  tone: "mint" | "amber" | "blue" | "rose";
};

type InsightView = {
  hasData: boolean;
  peakHourLabel: string;
  peakWeekdayLabel: string;
  /** 24 bars — no axis labels in v0.15 (the peak callout above the chart
   *  carries the only word the user actually needs). */
  bars: Array<{ height: number; isPeak: boolean }>;
};

type ProfilePageData = {
  profile: { nickname: string; avatarUrl: string; profileCompleted: boolean };
  nicknameFocus: boolean;
  badgeProgressLabel: string;
  subjectsHint: string;
  shareHint: string;
  appVersion: string;
  quoteEn: string;
  quoteZh: string;
  statTiles: StatTileView[];
  insights: InsightView;
  /** v0.18 — the "上月小结" modal payload. Non-null only on the first
   *  open of a new calendar month (when there was data last month). */
  monthlySummary: MonthlySummary | null;
  /** Human-friendly description of last-month-vs-prior, e.g.
   *  "比 3 月多 120 分钟（+18%）" / "比上月少了 30 分钟". Computed
   *  in TS rather than the template since the wxml ternary chain
   *  would otherwise be unreadable. */
  monthlyChangeText: string;
  /** v0.19 — Sunday-evening / Monday-morning weekly recap modal. */
  weeklyRecap: WeeklyRecap | null;
  weeklyRecapChangeText: string;
  /** 7-bar view-model derived from weeklyRecap.dailyMinutes. */
  weeklyRecapBars: Array<{ heightPercent: number; label: string; isPeak: boolean; minutes: number }>;
};

Page<{}, ProfilePageData>({
  data: {
    profile: { nickname: "", avatarUrl: "", profileCompleted: false },
    nicknameFocus: false,
    badgeProgressLabel: "—",
    subjectsHint: "—",
    shareHint: "未开启",
    appVersion: runtimeConfig.appVersion,
    quoteEn: "One page at a time.",
    quoteZh: "一页一页，也是在前进。",
    statTiles: [],
    insights: { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] },
    monthlySummary: null,
    monthlyChangeText: "",
    weeklyRecap: null,
    weeklyRecapChangeText: "",
    weeklyRecapBars: []
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    // v0.22 — 3 tabs (首页 / 日历 / 我的); profile is index 2.
    // 动态 tab was removed because it wasn't tied to the focus loop.
    tabBar?.setData?.({ selected: 2 });
    // Refresh the daily quote each time the user opens this tab so a
    // re-entry mid-day picks a different line. getDailyQuote already
    // persists "last shown" to avoid back-to-back duplicates.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const quote = getDailyQuote(today);
    this.setData({ quoteEn: quote.en, quoteZh: quote.zh });
    await getApp<IAppOption>().ensureProfile().catch((error) => {
      console.error("[profile] ensureProfile failed", error);
    });
    await this.refresh();
    // v0.18 — monthly summary modal; v0.19 — weekly recap modal.
    // Both gated on storage so they fire at most once per period.
    // We share a single sessions fetch (both compute fns derive from
    // the same /me/sessions response). The weekly recap takes
    // priority if both are eligible — weekly is the more immediate
    // "you just finished a week" moment, the monthly catches up
    // next time the user opens 我的.
    this.maybeShowPeriodicRecaps().catch((error) => {
      console.error("[profile] periodic recap failed", error);
    });
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
        badgeProgressLabel: totalBadges ? `已解锁 ${unlocked} / ${totalBadges}` : "—",
        subjectsHint: subjectsLabel,
        shareHint: dashboard.profile?.isPublic ? "已开启" : "未开启",
        statTiles: this.buildStatTiles(dashboard),
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
   * The four-tile grid: 累计学习 / 完成打卡 / 最长连签 / 单日最长.
   * Picking these four because:
   *   - 累计学习 / 完成打卡: cumulative totals (effort recap)
   *   - 最长连签: streak record (consistency)
   *   - 单日最长: peak-day record (intensity)
   * Current-streak is intentionally absent — it's already on the
   * home page as part of the timer-card meta line, and duplicating
   * it here just creates two competing "5 天" numbers.
   */
  buildStatTiles(dashboard: ProfileDashboardResponse): StatTileView[] {
    const summary = dashboard.summary || ({} as ProfileDashboardResponse["summary"]);
    const records = dashboard.records;
    const bestDay = records?.bestDay ?? dashboard.bestDay ?? { date: null, totalMinutes: 0 };
    const longestStreak = records?.longestStreakDays ?? summary.longestStreakDays ?? 0;
    const totalMinutes = summary.totalMinutes ?? 0;
    const completedCount = summary.completedSessionCount ?? 0;

    return [
      {
        key: "total",
        label: "累计学习",
        value: formatDuration(totalMinutes),
        unit: "",
        caption: "",
        tone: "mint"
      },
      {
        key: "completed",
        label: "完成打卡",
        value: String(completedCount),
        unit: completedCount > 0 ? "次" : "",
        caption: "",
        tone: "blue"
      },
      {
        key: "longestStreak",
        label: "最长连签",
        value: longestStreak > 0 ? String(longestStreak) : "—",
        unit: longestStreak > 0 ? "天" : "",
        caption: "",
        tone: "amber"
      },
      {
        key: "bestDay",
        label: "单日最长",
        value: bestDay.totalMinutes > 0 ? formatDuration(bestDay.totalMinutes) : "—",
        unit: "",
        caption: bestDay.date ? bestDay.date.slice(5).replace("-", ".") : "",
        tone: "rose"
      }
    ];
  },

  /**
   * 24-bin hourly pattern → sparkline view-model. The card around
   * this chart was compacted in v0.15 (single-line peak callout
   * instead of a 2-line title/subtitle block); the per-bar shape
   * stays the same.
   */
  buildInsightsView(patterns?: ProfileDashboardResponse["patterns"]): InsightView {
    if (!patterns || !patterns.hourly?.length) {
      return { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] };
    }
    const hourlySum = patterns.hourly.reduce((sum, value) => sum + value, 0);
    if (hourlySum <= 0) {
      return { hasData: false, peakHourLabel: "", peakWeekdayLabel: "", bars: [] };
    }
    const max = Math.max(...patterns.hourly, 1);
    const bars = patterns.hourly.map((minutes, hour) => ({
      height: minutes > 0 ? Math.max(8, Math.round((minutes / max) * 100)) : 4,
      isPeak: patterns.peakHour !== null && hour === patterns.peakHour
    }));

    const peakHourLabel = patterns.peakHour === null ? "—" : hourLabel(patterns.peakHour);
    const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const peakWeekdayLabel = patterns.peakWeekday === null
      ? "—"
      : weekdayNames[patterns.peakWeekday] || "—";

    return { hasData: true, peakHourLabel, peakWeekdayLabel, bars };
  },

  /**
   * v0.19 — single periodic-recap gate. Fetches sessions once and
   * runs both consumeWeeklyRecap (Sun 18:00 / Mon ≤ 06:00 / catch-up)
   * and consumeMonthlySummary (first open of a new calendar month).
   * Weekly takes priority if both are eligible at the same moment,
   * because the weekly is the more time-bound moment — the monthly
   * will catch up on the next 我的 open if needed.
   */
  async maybeShowPeriodicRecaps() {
    if (this.data.weeklyRecap || this.data.monthlySummary) return;
    let items;
    try {
      const result = await listMySessions();
      items = result?.items ?? [];
    } catch (_err) {
      // Non-fatal: transient failure → retry next onShow.
      return;
    }
    const now = new Date();
    const weeklyRecap = consumeWeeklyRecap(items, now);
    if (weeklyRecap) {
      this.setData({
        weeklyRecap,
        weeklyRecapChangeText: this.buildWeeklyChangeText(weeklyRecap),
        weeklyRecapBars: this.buildWeeklyRecapBars(weeklyRecap)
      });
      return;
    }
    const summary = consumeMonthlySummary(items, now);
    if (!summary) return;
    this.setData({
      monthlySummary: summary,
      monthlyChangeText: this.buildMonthlyChangeText(summary)
    });
  },

  /**
   * One-liner change text for the weekly recap modal. Mirrors
   * buildMonthlyChangeText so the two modals read consistently.
   */
  buildWeeklyChangeText(recap: WeeklyRecap): string {
    const c = recap.change;
    if (c.kind === "noPrior") return "上周没有数据 — 这是你的第一份周报。";
    if (c.kind === "flat") return "和上周节奏一致，稳。";
    if (c.kind === "up") return `比上周多 ${c.deltaMinutes} 分钟（+${c.percent}%）`;
    return `比上周少了 ${c.deltaMinutes} 分钟（-${c.percent}%）`;
  },

  /**
   * 7-bar chart view-model. Heights are normalized against the week's
   * peak day so a quiet week still produces a readable shape; bars are
   * always given a 4% minimum height for visual continuity.
   */
  buildWeeklyRecapBars(recap: WeeklyRecap): ProfilePageData["weeklyRecapBars"] {
    const max = Math.max(1, ...recap.dailyMinutes);
    const peakIdx = recap.dailyMinutes.indexOf(max);
    const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return recap.dailyMinutes.map((minutes, i) => ({
      heightPercent: minutes > 0 ? Math.max(8, Math.round((minutes / max) * 100)) : 4,
      label: labels[i],
      isPeak: i === peakIdx && minutes > 0,
      minutes
    }));
  },

  /** Tap to dismiss — both backdrop and CTA call this. */
  onTapWeeklyDismiss() {
    this.setData({ weeklyRecap: null, weeklyRecapChangeText: "", weeklyRecapBars: [] });
  },

  /** Stop tap propagation on the card itself. */
  onTapWeeklyContent(event: WechatMiniprogram.BaseEvent) {
    event.stopPropagation?.();
  },

  /**
   * One short sentence describing this month vs the prior month.
   * Kept in TS rather than wxml because the four MonthlyChange variants
   * (noPrior / flat / up / down) would otherwise nest poorly in
   * mustache ternaries.
   */
  buildMonthlyChangeText(summary: MonthlySummary): string {
    const change = summary.change;
    if (change.kind === "noPrior") return "上个月没有数据 — 这是你的第一份月小结。";
    if (change.kind === "flat") return "和上个月节奏一致，稳。";
    if (change.kind === "up") {
      return `比上个月多 ${change.deltaMinutes} 分钟（+${change.percent}%）`;
    }
    return `比上个月少了 ${change.deltaMinutes} 分钟（-${change.percent}%）`;
  },

  /** Tap-to-dismiss for both backdrop and CTA. We always clear the
   *  field — the storage write happens inside consumeMonthlySummary
   *  so a re-render here doesn't risk re-firing the modal. */
  onTapMonthlyDismiss() {
    this.setData({ monthlySummary: null, monthlyChangeText: "" });
  },

  /** Stop propagation so taps on the card itself don't dismiss. */
  onTapMonthlyContent(event: WechatMiniprogram.BaseEvent) {
    event.stopPropagation?.();
  },

  // v0.25 — openGarden removed alongside the garden subsystem.

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

  openSettings() {
    wx.navigateTo({ url: "/package-profile/settings/index" });
  }
});

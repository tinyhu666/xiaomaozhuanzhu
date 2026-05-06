// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { ActiveSession, HomeResponse, MakeupOpportunity, WeeklyReview } from "../../types/models";
import { getCalendar, getHome, makeupSession, pauseSession, resumeSession, startSession } from "../../utils/api";
import { formatStopwatch, getElapsedMs } from "../../utils/timer";
import { buildMonthGrid, formatDuration, getDailyQuote, getSessionActions } from "../../utils/view-models";

type WeeklyReviewView = {
  weekRangeText: string;
  thisWeekText: string;
  lastWeekText: string;
  bestDayText: string;
  topSubjectText: string;
  changeText: string;
  changeDirection: "up" | "down" | "flat";
};

type HomePageData = {
  profile: HomeResponse["profile"] | null;
  activeSession: ActiveSession | null;
  timerText: string;
  todayMinutesText: string;
  streakText: string;
  quoteEn: string;
  quoteZh: string;
  monthLabel: string;
  monthTotalText: string;
  monthGrid: ReturnType<typeof buildMonthGrid>;
  actions: string[];
  actionLoading: boolean;
  actionLoadingLabel: string;
  goalProgress: number;
  goalText: string;
  goalReached: boolean;
  pausedMinutes: number;
  weekly: WeeklyReviewView | null;
  makeup: MakeupOpportunity | null;
  makeupLoading: boolean;
  appVersion: string;
  showEmptyHint: boolean;
};

const DAILY_TARGET_MINUTES = 90;

let timerHandle: number | undefined;

Page<{}, HomePageData>({
  data: {
    profile: null,
    activeSession: null,
    timerText: "00:00:00",
    todayMinutesText: "0m",
    streakText: "0天",
    quoteEn: "One page at a time.",
    quoteZh: "一页一页，也是在前进。",
    monthLabel: "",
    monthTotalText: "0m",
    monthGrid: [],
    actions: ["start"],
    actionLoading: false,
    actionLoadingLabel: "",
    goalProgress: 0,
    goalText: `0m / ${formatDuration(DAILY_TARGET_MINUTES)}`,
    goalReached: false,
    pausedMinutes: 0,
    weekly: null,
    makeup: null,
    makeupLoading: false,
    appVersion: runtimeConfig.appVersion,
    showEmptyHint: true
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 0 });
    await getApp<IAppOption>().ensureProfile().catch((error) => {
      console.error("[home] ensureProfile failed", error);
    });
    this.refreshAll();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  async onPullDownRefresh() {
    await this.refreshAll();
    wx.stopPullDownRefresh();
  },

  async refreshAll() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const today = `${month}-${String(now.getDate()).padStart(2, "0")}`;
    const quote = getDailyQuote(today);
    // Render the heat-map skeleton immediately so users always see the
    // calendar grid (with day numbers + today highlight), even before the
    // network responds. The grid is overwritten with real heat values
    // once /api/calendar resolves.
    this.setData({
      quoteEn: quote.en,
      quoteZh: quote.zh,
      monthLabel: `${now.getMonth() + 1}月学习热力图`,
      monthGrid: this.data.monthGrid.length ? this.data.monthGrid : buildMonthGrid(month, {})
    });

    wx.showNavigationBarLoading();
    try {
      await Promise.all([this.loadHomeStats(), this.loadCalendar(month)]);
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async loadHomeStats() {
    try {
      const home = await getHome();
      const todayMinutes = home.today.totalMinutes ?? 0;
      const goalProgress = Math.min(100, Math.round((todayMinutes / DAILY_TARGET_MINUTES) * 100));
      this.setData({
        profile: home.profile,
        todayMinutesText: formatDuration(todayMinutes),
        streakText: `${home.summary.currentStreakDays}天`,
        goalProgress,
        goalText: `${formatDuration(todayMinutes)} / ${formatDuration(DAILY_TARGET_MINUTES)}`,
        goalReached: todayMinutes >= DAILY_TARGET_MINUTES,
        weekly: this.buildWeeklyView(home.weeklyReview ?? null),
        makeup: home.makeupAvailable ?? null
      });
      this.applyActiveSession(home.activeSession ?? null);
      this.refreshEmptyHint();
    } catch (error) {
      console.error("[home] loadHomeStats failed", error);
      // Surface a compact human message; the raw API path / HTML body
      // from cold-start failures is already logged above.
      const message = error instanceof Error ? error.message : "";
      const friendly =
        message.includes("唤醒") || message.includes("启动")
          ? message
          : message.includes("网络")
            ? message
            : "加载失败，请下拉刷新";
      wx.showToast({
        title: friendly,
        icon: "none",
        duration: 2400
      });
    }
  },

  buildWeeklyView(weekly: WeeklyReview | null): WeeklyReviewView | null {
    if (!weekly) return null;
    if (weekly.thisWeekMinutes === 0 && weekly.lastWeekMinutes === 0) return null;
    const formatRange = (start: string, end: string) => `${start.slice(5).replace("-", ".")} – ${end.slice(5).replace("-", ".")}`;
    const diff = weekly.thisWeekMinutes - weekly.lastWeekMinutes;
    let changeDirection: "up" | "down" | "flat" = "flat";
    let changeText = "持平上周";
    if (weekly.lastWeekMinutes === 0 && weekly.thisWeekMinutes > 0) {
      changeDirection = "up";
      changeText = "比上周多了 " + formatDuration(weekly.thisWeekMinutes);
    } else if (diff > 0) {
      changeDirection = "up";
      const ratio = Math.round((diff / Math.max(weekly.lastWeekMinutes, 1)) * 100);
      changeText = `比上周多 ${formatDuration(diff)}（+${ratio}%）`;
    } else if (diff < 0) {
      changeDirection = "down";
      const ratio = Math.round((Math.abs(diff) / Math.max(weekly.lastWeekMinutes, 1)) * 100);
      changeText = `比上周少 ${formatDuration(Math.abs(diff))}（-${ratio}%）`;
    }
    const bestDayText = weekly.bestDay.date
      ? `${weekly.bestDay.date.slice(5).replace("-", ".")} · ${formatDuration(weekly.bestDay.totalMinutes)}`
      : "本周还没开始记录";
    const topSubjectText = weekly.topSubject
      ? `${weekly.topSubject.subject} · ${formatDuration(weekly.topSubject.totalMinutes)}`
      : "尚无主科";
    return {
      weekRangeText: formatRange(weekly.weekStart, weekly.weekEnd),
      thisWeekText: formatDuration(weekly.thisWeekMinutes),
      lastWeekText: formatDuration(weekly.lastWeekMinutes),
      bestDayText,
      topSubjectText,
      changeText,
      changeDirection
    };
  },

  async handleMakeup() {
    if (!this.data.makeup || this.data.makeupLoading) return;
    this.setData({ makeupLoading: true });
    try {
      const result = await makeupSession();
      wx.showToast({ title: `补签成功，连签 ${result.streakDays} 天`, icon: "success" });
      this.refreshAll();
    } catch (error) {
      console.error("[home] makeup failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "补签失败，稍后再试",
        icon: "none"
      });
    } finally {
      this.setData({ makeupLoading: false });
    }
  },

  async loadCalendar(month: string) {
    try {
      const calendar = await getCalendar(month);
      const monthTotalMinutes = Object.values(calendar.days).reduce((sum, day) => sum + day.totalMinutes, 0);
      this.setData({
        monthTotalText: formatDuration(monthTotalMinutes),
        monthGrid: buildMonthGrid(month, calendar.days)
      });
    } catch (error) {
      console.error("[home] loadCalendar failed", error);
      // Fall back to an empty grid so the user still sees day numbers
      // instead of a blank panel.
      this.setData({
        monthGrid: buildMonthGrid(month, {})
      });
    }
  },

  applyActiveSession(session: ActiveSession | null) {
    const now = new Date();
    this.setData({
      activeSession: session,
      actions: getSessionActions(session?.status ?? null),
      timerText: session ? formatStopwatch(getElapsedMs(session, now)) : "00:00:00",
      pausedMinutes: this.computePausedMinutes(session, now)
    });
    this.refreshEmptyHint();
    this.syncTimer(session);
  },

  refreshEmptyHint() {
    const todayText = this.data.todayMinutesText || "0m";
    const todayHasZero = todayText === "0m";
    this.setData({
      showEmptyHint: !this.data.activeSession && todayHasZero
    });
  },

  computePausedMinutes(session: ActiveSession | null, now: Date) {
    if (!session || session.status !== "paused" || !session.currentPauseStartedAt) return 0;
    const ms = now.getTime() - new Date(session.currentPauseStartedAt).getTime();
    return Math.max(0, Math.floor(ms / 60000));
  },

  syncTimer(session: ActiveSession | null) {
    this.stopTimer();
    if (!session) return;

    const refresh = () => {
      const now = new Date();
      const update: Record<string, unknown> = {};
      if (session.status === "running") {
        update.timerText = formatStopwatch(getElapsedMs(session, now));
      }
      if (session.status === "paused") {
        update.pausedMinutes = this.computePausedMinutes(session, now);
      }
      if (Object.keys(update).length) {
        this.setData(update);
      }
    };

    refresh();
    timerHandle = setInterval(refresh, session.status === "running" ? 1000 : 30000) as unknown as number;
  },

  stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = undefined;
    }
  },

  friendlyError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : "";
    if (message) return message;
    if (typeof error === "object" && error && "errMsg" in error) {
      return String((error as { errMsg: string }).errMsg);
    }
    return fallback;
  },

  async runSessionAction(
    task: () => Promise<void>,
    options: { loadingLabel?: string; errorFallback?: string } = {}
  ) {
    if (this.data.actionLoading) return;
    const baseLabel = options.loadingLabel ?? "";
    this.setData({
      actionLoading: true,
      actionLoadingLabel: baseLabel
    });
    // Progressive label updates so the user knows the request is still
    // alive when a cold container takes the full retry budget. We only
    // mutate state if the action is still in flight.
    const updates: number[] = [];
    if (baseLabel) {
      updates.push(
        setTimeout(() => {
          if (this.data.actionLoading) {
            this.setData({ actionLoadingLabel: "服务启动中…" });
          }
        }, 2500) as unknown as number,
        setTimeout(() => {
          if (this.data.actionLoading) {
            this.setData({ actionLoadingLabel: "马上就好，请稍候…" });
          }
        }, 5000) as unknown as number
      );
    }
    try {
      await task();
    } catch (error) {
      console.error("[home] session action failed", error);
      wx.showToast({
        title: this.friendlyError(error, options.errorFallback ?? "操作失败，请稍后再试"),
        icon: "none",
        duration: 2400
      });
    } finally {
      for (const handle of updates) clearTimeout(handle);
      this.setData({ actionLoading: false, actionLoadingLabel: "" });
    }
  },

  async handleStart() {
    await this.runSessionAction(
      async () => {
        const result = await startSession();
        if (result?.session) {
          this.applyActiveSession(result.session);
        }
        this.refreshStatsInBackground();
      },
      { loadingLabel: "正在开始…", errorFallback: "开始失败，请稍后再试" }
    );
  },

  async handlePause() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(
      async () => {
        const result = await pauseSession(this.data.activeSession!.id);
        if (result?.session) {
          this.applyActiveSession(result.session);
        }
        this.refreshStatsInBackground();
      },
      { loadingLabel: "正在暂停…", errorFallback: "暂停失败，请稍后再试" }
    );
  },

  async handleResume() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(
      async () => {
        const result = await resumeSession(this.data.activeSession!.id);
        if (result?.session) {
          this.applyActiveSession(result.session);
        }
        this.refreshStatsInBackground();
      },
      { loadingLabel: "正在继续…", errorFallback: "继续失败，请稍后再试" }
    );
  },

  async handleComplete() {
    const session = this.data.activeSession;
    if (!session) return;

    await this.runSessionAction(
      async () => {
        let target: ActiveSession = session;

        if (session.status === "running") {
          try {
            const paused = await pauseSession(session.id);
            if (paused?.session) {
              target = paused.session as ActiveSession;
              this.applyActiveSession(target);
            }
          } catch (error) {
            console.warn("[home] pause-before-complete failed", error);
            // continue without blocking — the complete page can finish a
            // running session directly.
          }
        }

        wx.navigateTo({
          url: `/package-session/complete/index?sessionId=${target.id}&minutes=${Math.max(1, target.effectiveMinutes)}`
        });
      },
      { loadingLabel: "正在结束…", errorFallback: "结束失败，请稍后再试" }
    );
  },

  refreshStatsInBackground() {
    this.loadHomeStats().catch(() => {});
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    this.loadCalendar(month).catch(() => {});
  },

  handlePreviewDay(event: WechatMiniprogram.BaseEvent) {
    const { date, inmonth } = event.currentTarget.dataset as { date: string; inmonth: boolean };
    if (!inmonth) return;
    wx.navigateTo({
      url: `/package-calendar/day/index?date=${date}`
    });
  },

  openCalendar() {
    wx.switchTab({
      url: "/pages/calendar/index"
    });
  }
});

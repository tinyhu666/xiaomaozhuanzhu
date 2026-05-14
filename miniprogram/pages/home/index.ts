// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { ActiveSession, ExamDateInfo, HomeResponse, MakeupOpportunity, WeeklyReview } from "../../types/models";
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
  days: Array<{
    date: string;
    dayLabel: string;
    totalMinutes: number;
    fillPct: number;
    isToday: boolean;
    isFuture: boolean;
  }>;
};

type HomePageData = {
  profile: HomeResponse["profile"] | null;
  activeSession: ActiveSession | null;
  timerText: string;
  todayMinutesText: string;
  streakText: string;
  streakDays: number;
  quoteEn: string;
  quoteZh: string;
  quoteDateLabel: string;
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
  nextExam: null | {
    subject: string;
    dateLabel: string;
    daysRemaining: number;
    fallback: boolean;
    sourceYear: number;
    urgency: "calm" | "soon" | "urgent" | "imminent";
    motivation: string;
  };
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
    streakDays: 0,
    quoteEn: "One page at a time.",
    quoteZh: "一页一页，也是在前进。",
    quoteDateLabel: "",
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
    showEmptyHint: true,
    nextExam: null
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
      quoteDateLabel: `${now.getMonth() + 1}月${now.getDate()}日`,
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
        streakDays: home.summary.currentStreakDays || 0,
        goalProgress,
        goalText: `${formatDuration(todayMinutes)} / ${formatDuration(DAILY_TARGET_MINUTES)}`,
        goalReached: todayMinutes >= DAILY_TARGET_MINUTES,
        weekly: this.buildWeeklyView(home.weeklyReview ?? null),
        makeup: home.makeupAvailable ?? null,
        nextExam: this.pickNextExam(home.examSchedule)
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

  /**
   * Pick the subject whose exam is closest in the future. If multiple
   * subjects share the same date (typical for CPA), prefer 会计 as the
   * anchor — it's the heaviest and most-commonly-attempted subject.
   *
   * Adds an urgency tier (calm / soon / urgent / imminent) that drives
   * the home-page card's color + animation, and a tier-appropriate
   * one-liner so the countdown actually nudges behavior instead of
   * just displaying a number.
   */
  pickNextExam(schedule?: ExamDateInfo[]) {
    if (!schedule || !schedule.length) return null;
    const future = schedule.filter((e) => e.daysRemaining >= 0);
    if (!future.length) return null;
    future.sort((a, b) => a.daysRemaining - b.daysRemaining);
    const minDays = future[0].daysRemaining;
    const sameDay = future.filter((e) => e.daysRemaining === minDays);
    const preferred = sameDay.find((e) => e.subject === "会计") ?? sameDay[0];
    let urgency: "calm" | "soon" | "urgent" | "imminent" = "calm";
    let motivation = "稳扎稳打，每天 1.5h，足以拿下。";
    if (minDays <= 7) {
      urgency = "imminent";
      motivation = "考前一周，回归错题与公式，不要再刷新题。";
    } else if (minDays <= 30) {
      urgency = "urgent";
      motivation = "进入冲刺月，每天 3h+ 模考节奏，错题三刷。";
    } else if (minDays <= 90) {
      urgency = "soon";
      motivation = "强化阶段，主攻高频考点 + 真题。";
    }
    return {
      subject: preferred.subject,
      dateLabel: preferred.date.replace(/-/g, ".").slice(2),
      daysRemaining: preferred.daysRemaining,
      fallback: preferred.fallback,
      sourceYear: preferred.sourceYear,
      urgency,
      motivation
    };
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
      changeDirection,
      days: this.buildWeekDays(weekly.weekStart, weekly.bestDay.totalMinutes)
    };
  },

  /**
   * Build the 7-day mini bar chart for the weekly review card. We
   * derive per-day minutes from the already-loaded monthGrid (set by
   * loadCalendar) so this doesn't cost an extra API call. If the
   * week spans two months (Mon falls in last month), the leading
   * faded cells in the next-month grid carry no totalMinutes — those
   * bars render as zero, which is visually fine.
   */
  buildWeekDays(weekStartIso: string, bestDayMinutes: number) {
    const labels = ["一", "二", "三", "四", "五", "六", "日"];
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const start = new Date(weekStartIso + "T00:00:00+08:00");
    const lookup = new Map<string, number>();
    for (const cell of this.data.monthGrid as Array<{ date: string; totalMinutes: number }>) {
      lookup.set(cell.date, cell.totalMinutes);
    }

    const minutesByDay: number[] = [];
    const dayKeys: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(start.getTime() + i * 86400000);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      dayKeys.push(key);
      minutesByDay.push(lookup.get(key) ?? 0);
    }

    // Scale bar height so the tallest day is ~100%, with a floor so
    // a single 10-minute day doesn't render as a giant bar.
    const peak = Math.max(...minutesByDay, bestDayMinutes || 0, 90);
    return dayKeys.map((key, index) => {
      const minutes = minutesByDay[index];
      return {
        date: key,
        dayLabel: labels[index],
        totalMinutes: minutes,
        fillPct: Math.round((minutes / peak) * 100),
        isToday: key === todayKey,
        isFuture: key > todayKey
      };
    });
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

  // The home heat-map block was removed (duplicated the dedicated
  // calendar tab); the per-day navigation handlers it used to wire up
  // (handlePreviewDay / openCalendar) are no longer referenced.
});

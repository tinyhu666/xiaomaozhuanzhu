// @ts-nocheck
import type { ActiveSession, HomeResponse } from "../../types/models";
import { getCalendar, getHome, pauseSession, resumeSession, startSession } from "../../utils/api";
import { formatStopwatch, getElapsedMs } from "../../utils/timer";
import { buildMonthGrid, formatDuration, getDailyQuote, getSessionActions } from "../../utils/view-models";

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
  goalProgress: number;
  goalText: string;
  goalReached: boolean;
  pausedMinutes: number;
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
    goalProgress: 0,
    goalText: `0m / ${formatDuration(DAILY_TARGET_MINUTES)}`,
    goalReached: false,
    pausedMinutes: 0
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 0 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route).catch((error) => {
      console.error("[home] ensureProfile failed", error);
      return true;
    });
    if (!ready) return;
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
    this.setData({
      quoteEn: quote.en,
      quoteZh: quote.zh,
      monthLabel: `${now.getMonth() + 1}月学习热力图`
    });

    await Promise.all([this.loadHomeStats(), this.loadCalendar(month)]);
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
        goalReached: todayMinutes >= DAILY_TARGET_MINUTES
      });
      this.applyActiveSession(home.activeSession ?? null);
    } catch (error) {
      console.error("[home] loadHomeStats failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "加载主页数据失败",
        icon: "none"
      });
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
    this.syncTimer(session);
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

  async runSessionAction(task: () => Promise<void>) {
    if (this.data.actionLoading) return;
    this.setData({ actionLoading: true });
    try {
      await task();
    } catch (error) {
      console.error("[home] session action failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "操作失败，请稍后再试",
        icon: "none"
      });
    } finally {
      this.setData({ actionLoading: false });
    }
  },

  async handleStart() {
    await this.runSessionAction(async () => {
      const result = await startSession();
      if (result?.session) {
        this.applyActiveSession(result.session);
      }
      this.refreshStatsInBackground();
    });
  },

  async handlePause() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(async () => {
      const result = await pauseSession(this.data.activeSession!.id);
      if (result?.session) {
        this.applyActiveSession(result.session);
      }
      this.refreshStatsInBackground();
    });
  },

  async handleResume() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(async () => {
      const result = await resumeSession(this.data.activeSession!.id);
      if (result?.session) {
        this.applyActiveSession(result.session);
      }
      this.refreshStatsInBackground();
    });
  },

  async handleComplete() {
    const session = this.data.activeSession;
    if (!session) return;

    await this.runSessionAction(async () => {
      let target: ActiveSession = session;

      if (session.status === "running") {
        try {
          const paused = await pauseSession(session.id);
          if (paused?.session) {
            target = paused.session as ActiveSession;
            this.applyActiveSession(target);
          }
        } catch (error) {
          console.error("[home] pause-before-complete failed", error);
        }
      }

      wx.navigateTo({
        url: `/package-session/complete/index?sessionId=${target.id}&minutes=${Math.max(1, target.effectiveMinutes)}`
      });
    });
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

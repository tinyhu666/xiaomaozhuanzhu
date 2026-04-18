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
};

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
    actionLoading: false
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 0 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    await this.loadHome();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  async onPullDownRefresh() {
    await this.loadHome();
    wx.stopPullDownRefresh();
  },

  async loadHome() {
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const today = `${month}-${String(now.getDate()).padStart(2, "0")}`;
      const [home, calendar] = await Promise.all([getHome(), getCalendar(month)]);
      const monthTotalMinutes = Object.values(calendar.days).reduce((sum, day) => sum + day.totalMinutes, 0);
      const quote = getDailyQuote(today);

      this.setData({
        profile: home.profile,
        activeSession: home.activeSession,
        timerText: home.activeSession ? formatStopwatch(getElapsedMs(home.activeSession, new Date())) : "00:00:00",
        todayMinutesText: formatDuration(home.today.totalMinutes),
        streakText: `${home.summary.currentStreakDays}天`,
        quoteEn: quote.en,
        quoteZh: quote.zh,
        monthLabel: `${now.getMonth() + 1}月学习热力图`,
        monthTotalText: formatDuration(monthTotalMinutes),
        monthGrid: buildMonthGrid(month, calendar.days),
        actions: getSessionActions(home.activeSession?.status ?? null)
      });
      this.syncTimer(home.activeSession);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载首页失败",
        icon: "none"
      });
    }
  },

  syncTimer(session: ActiveSession | null) {
    this.stopTimer();
    if (!session) {
      this.setData({ timerText: "00:00:00" });
      return;
    }

    const refresh = () => {
      this.setData({
        timerText: formatStopwatch(getElapsedMs(session, new Date()))
      });
    };

    refresh();
    timerHandle = setInterval(refresh, 1000) as unknown as number;
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
      await startSession();
      await this.loadHome();
    });
  },

  async handlePause() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(async () => {
      await pauseSession(this.data.activeSession!.id);
      await this.loadHome();
    });
  },

  async handleResume() {
    if (!this.data.activeSession) return;
    await this.runSessionAction(async () => {
      await resumeSession(this.data.activeSession!.id);
      await this.loadHome();
    });
  },

  async handleComplete() {
    const session = this.data.activeSession;
    if (!session) return;

    await this.runSessionAction(async () => {
      let target = session;

      if (session.status === "running") {
        const paused = await pauseSession(session.id);
        target = paused.session as ActiveSession;
      }

      wx.navigateTo({
        url: `/package-session/complete/index?sessionId=${target.id}&minutes=${Math.max(1, target.effectiveMinutes)}`
      });
    });
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

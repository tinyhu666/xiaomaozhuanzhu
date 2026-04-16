// @ts-nocheck
import type { ActiveSession, HomeResponse } from "../../types/models";
import { getHome, pauseSession, resumeSession, startSession } from "../../utils/api";
import { formatStopwatch, getElapsedMs } from "../../utils/timer";
import { formatDuration, getSessionActions } from "../../utils/view-models";

type HomePageData = {
  profile: HomeResponse["profile"] | null;
  activeSession: ActiveSession | null;
  timerText: string;
  todayMinutesText: string;
  totalMinutesText: string;
  streakText: string;
  lastSummary: string;
  actions: string[];
};

let timerHandle: number | undefined;

Page<{}, HomePageData>({
  data: {
    profile: null,
    activeSession: null,
    timerText: "00:00:00",
    todayMinutesText: "0m",
    totalMinutesText: "0m",
    streakText: "0 天",
    lastSummary: "今晚从开始计时开始，把第一格热力点亮。",
    actions: ["start"]
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
      const home = await getHome();
      this.setData({
        profile: home.profile,
        activeSession: home.activeSession,
        todayMinutesText: formatDuration(home.today.totalMinutes),
        totalMinutesText: formatDuration(home.summary.totalMinutes),
        streakText: `${home.summary.currentStreakDays} 天`,
        lastSummary: home.summary.lastSummary || "今晚从开始计时开始，把第一格热力点亮。",
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

  async handleStart() {
    await startSession();
    await this.loadHome();
  },

  async handlePause() {
    if (!this.data.activeSession) return;
    await pauseSession(this.data.activeSession.id);
    await this.loadHome();
  },

  async handleResume() {
    if (!this.data.activeSession) return;
    await resumeSession(this.data.activeSession.id);
    await this.loadHome();
  },

  async handleComplete() {
    const session = this.data.activeSession;
    if (!session) return;
    let target = session;

    if (session.status === "running") {
      const paused = await pauseSession(session.id);
      target = paused.session as ActiveSession;
    }

    wx.navigateTo({
      url: `/package-session/complete/index?sessionId=${target.id}&minutes=${Math.max(1, target.effectiveMinutes)}`
    });
  }
});

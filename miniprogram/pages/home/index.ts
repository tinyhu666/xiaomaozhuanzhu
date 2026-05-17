// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { ActiveSession, ExamDateInfo, HomeResponse, MakeupOpportunity, ProfileDashboardResponse, SessionMode, SubjectProgress } from "../../types/models";
import { abandonSession, getHome, getProfileDashboard, listMySessions, makeupSession, pauseSession, resumeSession, startSession } from "../../utils/api";
import {
  getOrCreateTodayChallenge,
  markChallengeIfComplete,
  reasonLabel,
  type DailyChallenge
} from "../../utils/daily-challenge";
import {
  getActiveAudio,
  getAudioScene,
  pauseAmbient,
  resumeAmbient,
  startAmbient,
  stopAmbient
} from "../../utils/audio";
import { getSettings, type UserSettings } from "../../utils/settings";
import { formatStopwatch, getElapsedMs } from "../../utils/timer";
import { formatDuration, getSessionActions } from "../../utils/view-models";

/* ---------- Pomodoro constants ---------- */
const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"] as const;
/**
 * Default pomodoro parameters — used when the user hasn't set their
 * own in the settings page. v0.12 onward we look up the live values
 * from utils/settings.getSettings() on demand, so these are just
 * static fallbacks (and the source of truth for "what is industry
 * standard").
 */
const POMODORO_DEFAULTS = {
  focusSec: 25 * 60,
  shortBreakSec: 5 * 60,
  longBreakSec: 15 * 60,
  cyclesPerSet: 4
} as const;
const STORAGE_LAST_SUBJECT = "cpa.lastSubject";
// STORAGE_LAST_MODE removed in v0.18.1 — free timer is the only mode
// the user can start now. The pomodoro state-machine code stays in
// case a legacy "in-progress" pomodoro session is still on the server.

type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

type PomodoroState = {
  phase: PomodoroPhase;
  /** Wall-clock ms when this phase started. */
  phaseStartMs: number;
  /** How many *focus* cycles have ended so far in this session. */
  cyclesCompleted: number;
};

type HomePageData = {
  profile: HomeResponse["profile"] | null;
  activeSession: ActiveSession | null;
  timerText: string;
  timerSubLabel: string;
  todayMinutesText: string;
  streakText: string;
  streakDays: number;
  actions: string[];
  actionLoading: boolean;
  actionLoadingLabel: string;
  goalProgress: number;
  goalText: string;
  goalReached: boolean;
  weeklyGoal: { visible: boolean; text: string; progress: number; reached: boolean };
  pausedMinutes: number;
  makeup: MakeupOpportunity | null;
  makeupLoading: boolean;
  appVersion: string;
  showEmptyHint: boolean;
  /** Compact "音景: 雨声" badge that appears on the timer-card meta row when
   *  an ambient sound is playing during an active session. */
  audioBadge: { visible: boolean; label: string; emoji: string };
  /** Pre-start chip + mode picker state (hidden while a session is active). */
  selectedSubject: string | null;
  selectedMode: SessionMode;
  subjectChips: Array<{ label: string; active: boolean }>;
  pomodoroPhase: PomodoroPhase | null;
  pomodoroPhaseLabel: string;
  pomodoroCyclesCompleted: number;
  pomodoroCycleDots: Array<{ done: boolean }>;
  nextExam: null | {
    subject: string;
    dateLabel: string;
    daysRemaining: number;
    fallback: boolean;
    sourceYear: number;
    urgency: "calm" | "soon" | "urgent" | "imminent";
    motivation: string;
  };
  /** v0.18.1 — six-subject progress card on home. Visible only when
   *  at least one subject has positive total minutes (an all-zero
   *  grid is just noise on a brand-new account). */
  subjectsCard: {
    visible: boolean;
    hint: string;
    items: Array<{
      subject: string;
      percent: number;
      reached: boolean;
      valueText: string;
    }>;
  };
  /** v0.19 — adaptive daily challenge: a soft, system-generated floor
   *  target shown above the user-set 今日目标. Always non-null after
   *  the first /home load completes. */
  dailyChallenge: {
    targetMinutes: number;
    completed: boolean;
    reasonHint: string;
    progressMinutes: number;
    progressPercent: number;
  } | null;
};

const DAILY_TARGET_MINUTES = 90;

let timerHandle: number | undefined;
/**
 * Pomodoro state is kept in module scope (mirrors `timerHandle`) so the
 * tick callback can mutate without going through setData on every
 * frame; we only sync to the page when the displayed values change.
 */
let pomodoroState: PomodoroState | null = null;
/**
 * Pomodoro config snapshot taken at session start. We capture the
 * user's settings once-per-session so a mid-session settings change
 * (very rare — user would have to navigate away) doesn't desync the
 * state-machine clock. Reset to defaults whenever no pomodoro session
 * is active.
 */
let pomodoroConfig = {
  focusSec: POMODORO_DEFAULTS.focusSec,
  shortBreakSec: POMODORO_DEFAULTS.shortBreakSec,
  longBreakSec: POMODORO_DEFAULTS.longBreakSec,
  cyclesPerSet: POMODORO_DEFAULTS.cyclesPerSet
};

function snapshotPomodoroConfigFromSettings(settings: UserSettings) {
  pomodoroConfig = {
    focusSec: settings.pomodoroFocusMin * 60,
    shortBreakSec: settings.pomodoroShortBreakMin * 60,
    longBreakSec: settings.pomodoroLongBreakMin * 60,
    cyclesPerSet: settings.pomodoroCyclesPerSet
  };
}

Page<{}, HomePageData>({
  data: {
    profile: null,
    activeSession: null,
    timerText: "00:00:00",
    timerSubLabel: "",
    todayMinutesText: "0m",
    streakText: "0天",
    streakDays: 0,
    actions: ["start"],
    actionLoading: false,
    actionLoadingLabel: "",
    goalProgress: 0,
    goalText: `0m / ${formatDuration(DAILY_TARGET_MINUTES)}`,
    goalReached: false,
    weeklyGoal: { visible: false, text: "", progress: 0, reached: false },
    pausedMinutes: 0,
    audioBadge: { visible: false, label: "", emoji: "" },
    makeup: null,
    makeupLoading: false,
    appVersion: runtimeConfig.appVersion,
    showEmptyHint: true,
    selectedSubject: null,
    selectedMode: "free",
    subjectChips: SUBJECTS.map((label) => ({ label, active: false })),
    pomodoroPhase: null,
    pomodoroPhaseLabel: "",
    pomodoroCyclesCompleted: 0,
    pomodoroCycleDots: Array.from({ length: pomodoroConfig.cyclesPerSet }, () => ({ done: false })),
    nextExam: null,
    subjectsCard: { visible: false, hint: "", items: [] },
    dailyChallenge: null
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 0 });
    // Restore the user's last-used mode + subject so the picker
    // doesn't reset every time they open the app.
    this.restorePickerFromStorage();
    await getApp<IAppOption>().ensureProfile().catch((error) => {
      console.error("[home] ensureProfile failed", error);
    });
    this.refreshAll();
  },

  /**
   * Pre-start picker: read last selection from local storage so the
   * user doesn't have to re-pick their subject every time. We never
   * default to a subject the user hasn't explicitly chosen — null
   * (no subject yet) is the honest fallback.
   */
  restorePickerFromStorage() {
    try {
      const savedSubject = wx.getStorageSync(STORAGE_LAST_SUBJECT);
      const subject = SUBJECTS.includes(savedSubject) ? savedSubject : null;
      this.setData({
        selectedSubject: subject,
        // Mode pinned to "free" — see top-of-file note.
        selectedMode: "free",
        subjectChips: SUBJECTS.map((label) => ({ label, active: label === subject }))
      });
    } catch (error) {
      console.warn("[home] restorePicker failed", error);
    }
  },

  onTapSubjectChip(event: WechatMiniprogram.BaseEvent) {
    if (this.data.activeSession) return; // locked while session is live
    const label = String(event.currentTarget.dataset.label ?? "");
    // Tap-again toggles off so the user can clear without a separate
    // "不选" chip.
    const next = this.data.selectedSubject === label ? null : label;
    this.setData({
      selectedSubject: next,
      subjectChips: SUBJECTS.map((s) => ({ label: s, active: s === next }))
    });
    try {
      if (next) wx.setStorageSync(STORAGE_LAST_SUBJECT, next);
      else wx.removeStorageSync(STORAGE_LAST_SUBJECT);
    } catch (error) {
      console.warn("[home] persist subject failed", error);
    }
  },

  // onTapModeOption removed in v0.18.1 — see top-of-file note.
  // (The handler reference is no longer bound in the wxml.)

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
    // Home page is intentionally minimal now: just timer + countdown
    // + today's goal. Calendar / weekly review / quote moved out of
    // home so the "what should I do right now" question is answered
    // in one screen. Heat map lives in its own tab.
    wx.showNavigationBarLoading();
    try {
      await this.loadHomeStats();
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async loadHomeStats() {
    try {
      // v0.18.1: parallel fetch of dashboard for subject card.
      // v0.19: also parallel fetch of recent sessions for the daily
      // challenge derivation (needs the user's recent daily totals).
      // Both side fetches degrade gracefully: dashboard failure hides
      // the subject card; sessions failure makes the challenge fall
      // back to "newUser" mode.
      const [home, dashboardSettled, sessionsSettled] = await Promise.all([
        getHome(),
        getProfileDashboard().catch((err) => {
          console.warn("[home] dashboard fetch failed", err);
          return null;
        }),
        listMySessions().catch((err) => {
          console.warn("[home] sessions fetch failed", err);
          return null;
        })
      ]);
      const settings = getSettings();
      const dailyTarget = settings.dailyGoalMinutes;
      const todayMinutes = home.today.totalMinutes ?? 0;
      const goalProgress = Math.min(100, Math.round((todayMinutes / dailyTarget) * 100));

      // Weekly progress view-model (hidden when target = 0). We pull
      // thisWeekMinutes from /home's existing weeklyReview block, so
      // no new server work is needed.
      const weeklyTarget = settings.weeklyGoalMinutes;
      const thisWeekMinutes = home.weeklyReview?.thisWeekMinutes ?? 0;
      const weeklyGoal = weeklyTarget > 0
        ? {
            visible: true,
            text: `${formatDuration(thisWeekMinutes)} / ${formatDuration(weeklyTarget)}`,
            progress: Math.min(100, Math.round((thisWeekMinutes / weeklyTarget) * 100)),
            reached: thisWeekMinutes >= weeklyTarget
          }
        : { visible: false, text: "", progress: 0, reached: false };

      // v0.19 — derive the daily challenge view-model. Auto-marks
      // complete if today's running total has already crossed the
      // target by the time the home page loads.
      const now = new Date();
      const recentSessions = sessionsSettled?.items ?? [];
      let challenge = getOrCreateTodayChallenge(recentSessions, now);
      challenge = markChallengeIfComplete(challenge, todayMinutes, now);

      this.setData({
        profile: home.profile,
        todayMinutesText: formatDuration(todayMinutes),
        streakText: `${home.summary.currentStreakDays}天`,
        streakDays: home.summary.currentStreakDays || 0,
        goalProgress,
        goalText: `${formatDuration(todayMinutes)} / ${formatDuration(dailyTarget)}`,
        goalReached: todayMinutes >= dailyTarget,
        weeklyGoal,
        makeup: home.makeupAvailable ?? null,
        nextExam: this.pickNextExam(home.examSchedule),
        subjectsCard: this.buildSubjectsCard(dashboardSettled?.subjects ?? []),
        dailyChallenge: this.buildDailyChallengeView(challenge, todayMinutes)
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

  /**
   * v0.18.1 — six-row subject progress card for home. Shape matches
   * what the wxml renders directly (label / percent / valueText).
   * Sorted by descending progress so the user's most-engaged subject
   * sits at the top — gives a feeling of forward motion even when
   * other subjects are still at 0.
   */
  buildSubjectsCard(rows: SubjectProgress[]): HomePageData["subjectsCard"] {
    if (!rows.length) return { visible: false, hint: "", items: [] };
    const anyMinutes = rows.some((r) => (r.totalMinutes ?? 0) > 0);
    if (!anyMinutes) return { visible: false, hint: "", items: [] };

    const items = rows
      .slice()
      .sort((a, b) => (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0))
      .map((row) => {
        const total = row.totalMinutes ?? 0;
        const target = row.targetMinutes ?? 0;
        // Percent against the target if set, else cap at a soft 100h
        // ceiling so a single huge-grind subject doesn't dwarf the
        // bars of the others. (Honest: any > 0 ≥ 100h gets shown
        // visually as "full" in this preview; the full subjects
        // page shows real numbers.)
        const denominator = target > 0 ? target : 6000;
        const percent = denominator > 0 ? Math.min(100, Math.round((total / denominator) * 100)) : 0;
        const reached = target > 0 && total >= target;
        const valueText = target > 0
          ? `${formatDuration(total)} / ${formatDuration(target)}`
          : formatDuration(total);
        return { subject: row.subject, percent, reached, valueText };
      });
    const reachedCount = items.filter((r) => r.reached).length;
    const hint = reachedCount > 0 ? `${reachedCount}/6 已达目标` : "去查看";
    return { visible: true, hint, items };
  },

  openSubjectsPage() {
    wx.navigateTo({ url: "/package-profile/subjects/index" });
  },

  /**
   * v0.19 — daily challenge view-model. Always returns something
   * (challenge always exists after first load); progress is clamped
   * 0..100 so the bar can't overflow even when the user blows past
   * the target.
   */
  buildDailyChallengeView(
    challenge: DailyChallenge,
    todayMinutes: number
  ): NonNullable<HomePageData["dailyChallenge"]> {
    const target = challenge.targetMinutes;
    const percent = target > 0 ? Math.min(100, Math.round((todayMinutes / target) * 100)) : 0;
    return {
      targetMinutes: target,
      completed: !!challenge.completedAt,
      reasonHint: reasonLabel(challenge.reason),
      progressMinutes: Math.min(todayMinutes, target),
      progressPercent: percent
    };
  },

  /** Tap the challenge chip → friendly "why this number" toast. */
  onTapChallengeHint() {
    const c = this.data.dailyChallenge;
    if (!c) return;
    wx.showToast({ title: c.reasonHint, icon: "none", duration: 2400 });
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

  applyActiveSession(session: ActiveSession | null) {
    const now = new Date();
    const isPomodoro = session?.mode === "pomodoro";
    // Pomodoro state lifecycle:
    //  - new pomodoro session → seed at focus, t=startedAt
    //  - existing pomodoro session resumed → state-machine catch-up
    //  - free session or no session → clear
    if (isPomodoro && session) {
      if (!pomodoroState) {
        // App reopened mid-session — re-snapshot config from current
        // settings. The state-machine then catches up against those
        // durations. If the user changed settings while a pomodoro
        // was running on another tab, this picks up the new values,
        // which is the more useful behavior than silently sticking
        // to whatever the session started with.
        snapshotPomodoroConfigFromSettings(getSettings());
        pomodoroState = {
          phase: "focus",
          phaseStartMs: new Date(session.startedAt).getTime(),
          cyclesCompleted: session.pomodoroCycles ?? 0
        };
      }
      // Always silent-catch-up on (re-)entry so a long background
      // gap doesn't fire a flood of phase-end toasts when the user
      // comes back. Live phase transitions during foreground use
      // are handled by the per-tick path in syncTimer().
      this.catchUpPomodoroSilently(now.getTime());
    } else {
      pomodoroState = null;
    }
    const pomodoroView = isPomodoro && pomodoroState
      ? this.buildPomodoroView(session!, now.getTime())
      : { timerText: session ? formatStopwatch(getElapsedMs(session, now)) : "00:00:00",
          timerSubLabel: "",
          pomodoroPhase: null,
          pomodoroPhaseLabel: "",
          pomodoroCyclesCompleted: 0,
          pomodoroCycleDots: Array.from({ length: pomodoroConfig.cyclesPerSet }, () => ({ done: false })) };
    // v0.16: ambient audio follows the session state machine. We
    // call into the audio module unconditionally — the module
    // itself decides whether to play (it no-ops when scene = "off"
    // or already in the requested state). This way refresh() / app-
    // reopen / pause→resume / complete all converge to the right
    // playback state without per-call branching here.
    this.syncAmbientAudio(session);

    this.setData({
      activeSession: session,
      actions: getSessionActions(session?.status ?? null),
      ...pomodoroView,
      pausedMinutes: this.computePausedMinutes(session, now),
      // Keep the pre-start picker in sync with what's actually running
      // (server is the source of truth for subject + mode).
      selectedSubject: session?.subject ?? this.data.selectedSubject,
      selectedMode: (session?.mode ?? this.data.selectedMode) as SessionMode,
      subjectChips: SUBJECTS.map((s) => ({
        label: s,
        active: s === (session?.subject ?? this.data.selectedSubject)
      })),
      audioBadge: this.buildAudioBadge(session)
    });
    this.refreshEmptyHint();
    this.syncTimer(session);
  },

  /**
   * Translate the session.status into the audio module's actions.
   * Called from applyActiveSession on every state change.
   *   - running    → startAmbient (idempotent if already playing the
   *                 same scene at the same volume)
   *   - paused     → pauseAmbient
   *   - any other  → stopAmbient
   * The audio module persists scene + volume in storage, so it
   * already knows what to play; we just signal the state.
   */
  syncAmbientAudio(session: ActiveSession | null) {
    if (!session) {
      stopAmbient();
      return;
    }
    if (session.status === "running") {
      startAmbient();
    } else if (session.status === "paused") {
      pauseAmbient();
    } else {
      stopAmbient();
    }
  },

  /**
   * Compact "currently playing" indicator for the timer-card meta
   * row. Empty when the user has scene = off OR there's no live
   * session — we don't want to advertise the audio feature when it's
   * not actually doing anything.
   */
  buildAudioBadge(session: ActiveSession | null) {
    if (!session || session.status !== "running") {
      return { visible: false, label: "", emoji: "" };
    }
    const scene = getAudioScene();
    if (scene === "off") return { visible: false, label: "", emoji: "" };
    const info = getActiveAudio();
    return { visible: true, label: info.label, emoji: info.emoji };
  },

  /**
   * Pomodoro derivation: from the session start time and the in-memory
   * phase state, compute the countdown label, phase, and completed
   * cycles. The state-machine is purely client-side; the server only
   * cares about the final `pomodoroCycles` count on session complete.
   */
  buildPomodoroView(session: ActiveSession, nowMs: number) {
    const state = pomodoroState!;
    const phaseLength = this.pomodoroPhaseLength(state.phase) * 1000;
    let remainingMs = phaseLength - Math.max(0, nowMs - state.phaseStartMs);
    if (remainingMs < 0) remainingMs = 0;
    const remainingSec = Math.ceil(remainingMs / 1000);
    const mm = Math.floor(remainingSec / 60);
    const ss = remainingSec % 60;
    const timerText = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    const phaseLabel = state.phase === "focus"
      ? `专注 · 第 ${state.cyclesCompleted + 1} 个番茄`
      : state.phase === "longBreak"
        ? "长休息 15 分钟"
        : "短休息 5 分钟";
    return {
      timerText,
      timerSubLabel: phaseLabel,
      pomodoroPhase: state.phase,
      pomodoroPhaseLabel: phaseLabel,
      pomodoroCyclesCompleted: state.cyclesCompleted,
      pomodoroCycleDots: Array.from({ length: pomodoroConfig.cyclesPerSet }, (_, i) => ({
        done: i < (state.cyclesCompleted % pomodoroConfig.cyclesPerSet)
      }))
    };
  },

  pomodoroPhaseLength(phase: PomodoroPhase): number {
    if (phase === "focus") return pomodoroConfig.focusSec;
    if (phase === "longBreak") return pomodoroConfig.longBreakSec;
    return pomodoroConfig.shortBreakSec;
  },

  /**
   * If the app reopens with a session whose pomodoro phase elapsed
   * while backgrounded, fast-forward through any expired phases
   * silently (no toasts / haptics). The user has had no chance to
   * react to those transitions in this app session — let them resume
   * at "where it should be now" without spamming notifications.
   */
  catchUpPomodoroSilently(nowMs: number) {
    if (!pomodoroState) return;
    let safety = 0;
    while (safety < 200) {
      const phaseLen = this.pomodoroPhaseLength(pomodoroState.phase) * 1000;
      if (nowMs - pomodoroState.phaseStartMs < phaseLen) break;
      this.advancePomodoroPhaseInternal(false);
      safety += 1;
    }
  },

  /**
   * Move to the next phase. Internal helper — the caller decides
   * whether to deliver user feedback (vibrate + toast). `notify=true`
   * for the live tick that crosses a phase boundary; false during
   * silent catch-up.
   */
  advancePomodoroPhaseInternal(notify: boolean) {
    if (!pomodoroState) return;
    const phaseLen = this.pomodoroPhaseLength(pomodoroState.phase) * 1000;
    const wasFocus = pomodoroState.phase === "focus";
    let nextPhase: PomodoroPhase;
    if (wasFocus) {
      pomodoroState.cyclesCompleted += 1;
      // Long break every Nth focus cycle.
      nextPhase = pomodoroState.cyclesCompleted % pomodoroConfig.cyclesPerSet === 0
        ? "longBreak"
        : "shortBreak";
    } else {
      nextPhase = "focus";
    }
    pomodoroState.phase = nextPhase;
    pomodoroState.phaseStartMs += phaseLen;
    if (notify) {
      try { wx.vibrateShort({ type: "medium" }); } catch (_) { /* no-op */ }
      const message = wasFocus
        ? (nextPhase === "longBreak" ? "完成一组，休息 15 分钟" : "完成一个番茄，休息 5 分钟")
        : "休息结束，开始下一个番茄";
      wx.showToast({ title: message, icon: "none", duration: 2000 });
    }
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
    const isPomodoro = session.mode === "pomodoro";

    const refresh = () => {
      const now = new Date();
      const update: Record<string, unknown> = {};

      if (isPomodoro && pomodoroState && session.status === "running") {
        // Check for phase rollover. If a single tick already
        // crossed the boundary, fire user feedback exactly once.
        const phaseLen = this.pomodoroPhaseLength(pomodoroState.phase) * 1000;
        if (now.getTime() - pomodoroState.phaseStartMs >= phaseLen) {
          this.advancePomodoroPhaseInternal(true);
        }
        const view = this.buildPomodoroView(session, now.getTime());
        update.timerText = view.timerText;
        update.timerSubLabel = view.timerSubLabel;
        update.pomodoroPhase = view.pomodoroPhase;
        update.pomodoroPhaseLabel = view.pomodoroPhaseLabel;
        update.pomodoroCyclesCompleted = view.pomodoroCyclesCompleted;
        update.pomodoroCycleDots = view.pomodoroCycleDots;
      } else if (session.status === "running") {
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
    // Reset the pomodoro state machine on every fresh start. This is
    // also where we tell the server which mode + subject we're
    // starting in so the session row carries both from creation.
    pomodoroState = null;
    // Snapshot pomodoro params from settings at start time so the
    // running session uses the user's custom durations rather than
    // the static defaults.
    snapshotPomodoroConfigFromSettings(getSettings());
    const subject = this.data.selectedSubject;
    const mode = this.data.selectedMode;
    await this.runSessionAction(
      async () => {
        const result = await startSession({ subject, mode });
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

        // Forward subject + pomodoro cycles to the complete page so
        // the user doesn't have to re-pick the subject they already
        // chose before starting, and so the cycle count lands in
        // the database with the session.
        const subject = target.subject || this.data.selectedSubject || "";
        const cycles = target.mode === "pomodoro"
          ? (pomodoroState?.cyclesCompleted ?? target.pomodoroCycles ?? 0)
          : 0;
        const params = [
          `sessionId=${target.id}`,
          `minutes=${Math.max(1, target.effectiveMinutes)}`
        ];
        if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
        if (cycles > 0) params.push(`cycles=${cycles}`);
        wx.navigateTo({
          url: `/package-session/complete/index?${params.join("&")}`
        });
      },
      { loadingLabel: "正在结束…", errorFallback: "结束失败，请稍后再试" }
    );
  },

  refreshStatsInBackground() {
    this.loadHomeStats().catch(() => {});
  }
});

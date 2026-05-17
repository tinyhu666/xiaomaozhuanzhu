// @ts-nocheck
import { getReminderStatus, type ReminderStatus } from "../../utils/api";
import {
  AUDIO_SCENES,
  getAudioScene,
  setAudioScene,
  type AudioScene
} from "../../utils/audio";
import {
  disableReminder,
  requestReminderSubscribe
} from "../../utils/reminder";
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  getSettings,
  saveSettings,
  type UserSettings
} from "../../utils/settings";

/**
 * Row view-model. Each setting renders as a stepper row with a label
 * + value display + −/+ buttons. We pre-compute the "off" override
 * (weekly goal only) and the unit suffix so the WXML stays dumb.
 */
type SettingRowVM = {
  key: keyof UserSettings;
  label: string;
  description: string;
  /** Current numeric value. */
  value: number;
  /** Display string: respects "off" sentinel for weekly goal. */
  displayValue: string;
  /** Suffix shown after the number (e.g. "分钟"). */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Stepper enabled state for −/+ buttons. */
  canDecrement: boolean;
  canIncrement: boolean;
};

type AudioSceneVM = {
  key: AudioScene;
  label: string;
  emoji: string;
  description: string;
  active: boolean;
};

type ReminderVM = {
  /** Toggle state — fed from the server `enabled` flag. */
  enabled: boolean;
  /** Remaining WeChat 一次性订阅 grants available to consume. */
  credits: number;
  /** True iff openid is available (anonymous users can't be sent to). */
  hasOpenid: boolean;
  /** Friendly status line, e.g. "已开启 · 还能推送 3 次" / "未开启". */
  statusLabel: string;
  /** True while we're calling wx.requestSubscribeMessage. */
  busy: boolean;
};

type SettingsPageData = {
  goalRows: SettingRowVM[];
  pomodoroRows: SettingRowVM[];
  audioScenes: AudioSceneVM[];
  reminder: ReminderVM;
};

const ROW_TEMPLATES: Array<{
  key: keyof UserSettings;
  label: string;
  description: string;
  unit: string;
  group: "goal" | "pomodoro";
}> = [
  {
    key: "dailyGoalMinutes",
    label: "每日目标",
    description: "用来驱动首页「今日目标」进度条",
    unit: "分钟",
    group: "goal"
  },
  {
    key: "weeklyGoalMinutes",
    label: "每周目标",
    description: "设为 0 即关闭，不再显示周目标进度",
    unit: "分钟",
    group: "goal"
  },
  {
    key: "pomodoroFocusMin",
    label: "番茄钟 · 专注",
    description: "每个番茄的专注时长",
    unit: "分钟",
    group: "pomodoro"
  },
  {
    key: "pomodoroShortBreakMin",
    label: "番茄钟 · 短休",
    description: "每个番茄结束后的短休时长",
    unit: "分钟",
    group: "pomodoro"
  },
  {
    key: "pomodoroLongBreakMin",
    label: "番茄钟 · 长休",
    description: "一组结束后的长休时长",
    unit: "分钟",
    group: "pomodoro"
  },
  {
    key: "pomodoroCyclesPerSet",
    label: "番茄钟 · 一组数量",
    description: "几个番茄后进入长休",
    unit: "个",
    group: "pomodoro"
  }
];

function rowFor(settings: UserSettings, template: typeof ROW_TEMPLATES[number]): SettingRowVM {
  const bounds = SETTINGS_BOUNDS[template.key];
  const value = settings[template.key];
  const isOffSentinel = template.key === "weeklyGoalMinutes" && value === 0;
  return {
    key: template.key,
    label: template.label,
    description: template.description,
    value,
    displayValue: isOffSentinel ? "未设置" : String(value),
    unit: isOffSentinel ? "" : template.unit,
    min: bounds.min,
    max: bounds.max,
    step: bounds.step,
    canDecrement: value > bounds.min,
    canIncrement: value < bounds.max
  };
}

function buildAudioScenes(active: AudioScene): AudioSceneVM[] {
  return AUDIO_SCENES.map((s) => ({
    key: s.key,
    label: s.label,
    emoji: s.emoji,
    description: s.description,
    active: s.key === active
  }));
}

function buildPageRows(settings: UserSettings) {
  return {
    audioScenes: buildAudioScenes(getAudioScene()),
    goalRows: ROW_TEMPLATES.filter((t) => t.group === "goal").map((t) => rowFor(settings, t)),
    pomodoroRows: ROW_TEMPLATES.filter((t) => t.group === "pomodoro").map((t) => rowFor(settings, t))
  };
}

function buildReminderVM(status: ReminderStatus | null, busy = false): ReminderVM {
  if (!status) {
    return {
      enabled: false,
      credits: 0,
      hasOpenid: false,
      statusLabel: "正在加载…",
      busy
    };
  }
  const statusLabel = !status.hasOpenid
    ? "需要微信账号授权后才能开启"
    : status.enabled
      ? status.credits > 0
        ? `已开启 · 还能推送 ${status.credits} 次`
        : "已开启 · 需要再次授权才能继续推送"
      : "未开启";
  return {
    enabled: status.enabled,
    credits: status.credits,
    hasOpenid: status.hasOpenid,
    statusLabel,
    busy
  };
}

Page<{}, SettingsPageData>({
  data: {
    goalRows: [],
    pomodoroRows: [],
    audioScenes: [],
    reminder: buildReminderVM(null)
  },

  onLoad() {
    this.rebuild(getSettings());
    this.refreshReminder();
  },

  async refreshReminder() {
    try {
      const status = await getReminderStatus();
      this.setData({ reminder: buildReminderVM(status) });
    } catch (err) {
      console.warn("[settings] reminder status failed", err);
    }
  },

  /**
   * Toggle the 每日提醒 (20:30 daily reminder).
   *   - off → on: trigger wx.requestSubscribeMessage; on accept, the
   *     server bumps credits and flips enabled=true
   *   - on → off: server flips enabled=false; credits stay (so user
   *     can toggle back without re-authorizing immediately)
   *
   * The "refill" pattern (asking again when credits are low) lives
   * on the home page cold-start, not here. This handler just owns
   * the explicit user-driven toggle.
   */
  async onTapReminderToggle() {
    if (this.data.reminder.busy) return;
    this.setData({ reminder: { ...this.data.reminder, busy: true } });
    try {
      if (this.data.reminder.enabled) {
        // User turning it OFF — simple POST, no wx prompt needed.
        await disableReminder();
        await this.refreshReminder();
        wx.showToast({ title: "已关闭每日提醒", icon: "none" });
        return;
      }
      // User turning it ON — trigger the WeChat subscribe prompt.
      const outcome = await requestReminderSubscribe();
      if (outcome.ok) {
        await this.refreshReminder();
        wx.showToast({
          title: `已开启 · 还能推送 ${outcome.credits} 次`,
          icon: "none",
          duration: 2400
        });
        return;
      }
      // User declined or wx threw. Don't leave the toggle in a fake-on state.
      const text = outcome.reason === "rejected"
        ? "未授权 · 暂不开启"
        : outcome.reason === "blocked"
          ? outcome.message ?? "微信已禁用此模板的订阅"
          : outcome.message ?? "授权失败";
      wx.showToast({ title: text, icon: "none", duration: 2400 });
      await this.refreshReminder();
    } catch (err) {
      console.error("[settings] reminder toggle failed", err);
      wx.showToast({
        title: err instanceof Error ? err.message : "切换失败",
        icon: "none"
      });
      this.setData({ reminder: { ...this.data.reminder, busy: false } });
    }
  },

  /** Explicit "续订" button — visible only when credits run low and
   *  reminder is already enabled. Same wx.requestSubscribeMessage
   *  flow as toggle-on, but UX framing is "top up" not "turn on". */
  async onTapReminderRefill() {
    if (this.data.reminder.busy) return;
    this.setData({ reminder: { ...this.data.reminder, busy: true } });
    try {
      const outcome = await requestReminderSubscribe();
      if (outcome.ok) {
        wx.showToast({ title: `已续订 · 共 ${outcome.credits} 次`, icon: "none" });
      } else if (outcome.reason !== "rejected") {
        wx.showToast({
          title: outcome.message ?? "续订失败",
          icon: "none",
          duration: 2400
        });
      }
      await this.refreshReminder();
    } catch (err) {
      console.error("[settings] reminder refill failed", err);
      this.setData({ reminder: { ...this.data.reminder, busy: false } });
    }
  },

  rebuild(settings: UserSettings) {
    this.setData(buildPageRows(settings));
  },

  /**
   * Stepper handler: shared between − and +. We move the value by
   * one `step` for that field (e.g. daily goal moves in 15-min
   * blocks) and persist immediately so the user doesn't need a
   * "save" button — it's idempotent and feels lighter.
   */
  onStepperTap(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.key as keyof UserSettings;
    const direction = (event.currentTarget.dataset.dir as string) === "up" ? 1 : -1;
    const bounds = SETTINGS_BOUNDS[key];
    const current = getSettings();
    const next = current[key] + direction * bounds.step;
    if (next < bounds.min || next > bounds.max) return;
    const updated = saveSettings({ [key]: next });
    this.rebuild(updated);
  },

  /**
   * Pick (or clear) the ambient audio scene. The audio module
   * persists the choice + hot-swaps the playing track if a session
   * is currently running, so the user hears the change immediately
   * if they switch mid-session.
   */
  onTapAudioScene(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.key as AudioScene;
    if (!key) return;
    setAudioScene(key);
    this.setData({ audioScenes: buildAudioScenes(key) });
  },

  /**
   * Reset all settings to defaults — useful when the user has tuned
   * themselves into a corner.
   */
  onResetTap() {
    wx.showModal({
      title: "恢复默认",
      content: "把所有设置恢复成出厂值（每日目标 90 分钟 / 番茄钟 25-5-15-4）。已记录的学习数据不会被清除。",
      confirmText: "恢复",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) return;
        saveSettings({ ...DEFAULT_SETTINGS });
        this.rebuild(getSettings());
        wx.showToast({ title: "已恢复默认", icon: "success" });
      }
    });
  }
});

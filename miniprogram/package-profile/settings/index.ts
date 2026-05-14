// @ts-nocheck
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

type SettingsPageData = {
  goalRows: SettingRowVM[];
  pomodoroRows: SettingRowVM[];
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

function buildPageRows(settings: UserSettings) {
  return {
    goalRows: ROW_TEMPLATES.filter((t) => t.group === "goal").map((t) => rowFor(settings, t)),
    pomodoroRows: ROW_TEMPLATES.filter((t) => t.group === "pomodoro").map((t) => rowFor(settings, t))
  };
}

Page<{}, SettingsPageData>({
  data: {
    goalRows: [],
    pomodoroRows: []
  },

  onLoad() {
    this.rebuild(getSettings());
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

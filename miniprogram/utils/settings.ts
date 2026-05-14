/**
 * Per-device user preferences. v0.12 introduces a settings page where
 * the user can tune the previously-hard-coded constants:
 *   - daily / weekly study goals
 *   - pomodoro cycle lengths
 *
 * Why client-side (wx.setStorageSync)
 * -----------------------------------
 * These are *device* preferences, not portable account data. A user
 * who tunes "25 → 30 min" on phone A doesn't necessarily want phone B
 * to inherit it (different context, different ergonomics). Keeping
 * settings local also avoids a server schema migration and an
 * authenticated round-trip on every home-page render. If we ever need
 * cross-device sync, we add `GET/PUT /api/me/settings` and wrap the
 * same shape — readers don't need to change.
 *
 * All getters do bounds-checking and fall back to the defaults on any
 * shape mismatch (missing field, wrong type, out-of-range value).
 * That makes the format forward-compatible: a v0.13 reader running on
 * a v0.12-written record still works.
 */

export const STORAGE_SETTINGS_KEY = "cpa.settings.v1";

export type UserSettings = {
  /** Daily study target. Default 90 min = the old hard-coded 1.5h. */
  dailyGoalMinutes: number;
  /**
   * Weekly target. `0` is the "not set" sentinel — UI hides the
   * weekly progress bar entirely when this is zero, so the home
   * page doesn't bother a user who hasn't asked for the feature.
   */
  weeklyGoalMinutes: number;
  /** Pomodoro focus phase length. Industry standard 25 min. */
  pomodoroFocusMin: number;
  /** Short break after each focus. Industry standard 5 min. */
  pomodoroShortBreakMin: number;
  /** Long break after a full set. Industry standard 15 min. */
  pomodoroLongBreakMin: number;
  /** Focus cycles per set before the long break. Standard 4. */
  pomodoroCyclesPerSet: number;
};

export const DEFAULT_SETTINGS: UserSettings = {
  dailyGoalMinutes: 90,
  weeklyGoalMinutes: 0,
  pomodoroFocusMin: 25,
  pomodoroShortBreakMin: 5,
  pomodoroLongBreakMin: 15,
  pomodoroCyclesPerSet: 4
};

/** Hard bounds — UI steppers also clamp to these. */
export const SETTINGS_BOUNDS = {
  dailyGoalMinutes: { min: 15, max: 600, step: 15 },
  weeklyGoalMinutes: { min: 0, max: 5000, step: 60 }, // 0 = off
  pomodoroFocusMin: { min: 5, max: 90, step: 5 },
  pomodoroShortBreakMin: { min: 1, max: 30, step: 1 },
  pomodoroLongBreakMin: { min: 5, max: 60, step: 5 },
  pomodoroCyclesPerSet: { min: 2, max: 8, step: 1 }
} as const;

function clamp(value: number, key: keyof typeof SETTINGS_BOUNDS): number {
  const { min, max } = SETTINGS_BOUNDS[key];
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Read settings from local storage with full validation. Always
 * returns a valid object — corrupted or missing fields fall back to
 * the default for that field.
 */
export function getSettings(): UserSettings {
  let raw: unknown;
  try {
    raw = wx.getStorageSync(STORAGE_SETTINGS_KEY);
  } catch (_) {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const partial = raw as Partial<UserSettings>;
  return {
    dailyGoalMinutes: clamp(Number(partial.dailyGoalMinutes ?? DEFAULT_SETTINGS.dailyGoalMinutes), "dailyGoalMinutes"),
    weeklyGoalMinutes: clamp(Number(partial.weeklyGoalMinutes ?? DEFAULT_SETTINGS.weeklyGoalMinutes), "weeklyGoalMinutes"),
    pomodoroFocusMin: clamp(Number(partial.pomodoroFocusMin ?? DEFAULT_SETTINGS.pomodoroFocusMin), "pomodoroFocusMin"),
    pomodoroShortBreakMin: clamp(Number(partial.pomodoroShortBreakMin ?? DEFAULT_SETTINGS.pomodoroShortBreakMin), "pomodoroShortBreakMin"),
    pomodoroLongBreakMin: clamp(Number(partial.pomodoroLongBreakMin ?? DEFAULT_SETTINGS.pomodoroLongBreakMin), "pomodoroLongBreakMin"),
    pomodoroCyclesPerSet: clamp(Number(partial.pomodoroCyclesPerSet ?? DEFAULT_SETTINGS.pomodoroCyclesPerSet), "pomodoroCyclesPerSet")
  };
}

/** Persist a settings update. Partial — only writes fields the caller passes. */
export function saveSettings(patch: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const next: UserSettings = { ...current };
  for (const key of Object.keys(patch) as Array<keyof UserSettings>) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = clamp(value, key);
    }
  }
  try {
    wx.setStorageSync(STORAGE_SETTINGS_KEY, next);
  } catch (error) {
    console.warn("[settings] persist failed", error);
  }
  return next;
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the wx global before importing settings — vitest hoists vi.mock
// for ES imports, so this works even though wx isn't a real module.
const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key)
};

import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  getSettings,
  saveSettings,
  STORAGE_SETTINGS_KEY
} from "../utils/settings";

describe("utils/settings", () => {
  beforeEach(() => {
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
  });

  it("returns defaults when storage is empty", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps a stored over-max value down to the bound on read", () => {
    storage.set(STORAGE_SETTINGS_KEY, { pomodoroFocusMin: 9999 });
    const settings = getSettings();
    expect(settings.pomodoroFocusMin).toBe(SETTINGS_BOUNDS.pomodoroFocusMin.max);
  });

  it("clamps a stored under-min value up to the bound on read", () => {
    storage.set(STORAGE_SETTINGS_KEY, { pomodoroShortBreakMin: 0 });
    const settings = getSettings();
    expect(settings.pomodoroShortBreakMin).toBe(SETTINGS_BOUNDS.pomodoroShortBreakMin.min);
  });

  it("falls back to defaults for non-numeric / missing fields", () => {
    storage.set(STORAGE_SETTINGS_KEY, {
      dailyGoalMinutes: "not a number",
      pomodoroFocusMin: null
    } as unknown);
    const settings = getSettings();
    expect(settings.dailyGoalMinutes).toBe(DEFAULT_SETTINGS.dailyGoalMinutes);
    expect(settings.pomodoroFocusMin).toBe(DEFAULT_SETTINGS.pomodoroFocusMin);
  });

  it("saveSettings only updates the patched fields and clamps each", () => {
    saveSettings({ dailyGoalMinutes: 120, pomodoroLongBreakMin: 999 });
    const settings = getSettings();
    expect(settings.dailyGoalMinutes).toBe(120);
    expect(settings.pomodoroLongBreakMin).toBe(SETTINGS_BOUNDS.pomodoroLongBreakMin.max);
    expect(settings.pomodoroFocusMin).toBe(DEFAULT_SETTINGS.pomodoroFocusMin);
  });

  it("weekly goal accepts 0 as the off sentinel", () => {
    saveSettings({ weeklyGoalMinutes: 0 });
    expect(getSettings().weeklyGoalMinutes).toBe(0);
  });

  it("a corrupt storage value (not an object) falls back cleanly", () => {
    storage.set(STORAGE_SETTINGS_KEY, "garbage");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

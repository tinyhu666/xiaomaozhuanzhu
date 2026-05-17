import { afterEach, beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key)
};

import {
  __resetDailyChallengeForTests,
  deriveChallenge,
  getOrCreateTodayChallenge,
  markChallengeIfComplete,
  reasonLabel,
  toShanghaiDayKey
} from "../utils/daily-challenge";
import type { CompletedSession } from "../utils/api";

beforeEach(() => storage.clear());
afterEach(() => storage.clear());

function s(endedAt: string, durationMinutes: number, id = "s"): CompletedSession {
  return {
    id,
    subject: null,
    mode: "free",
    durationMinutes,
    pomodoroCycles: 0,
    startedAt: endedAt,
    endedAt
  };
}

describe("deriveChallenge", () => {
  const may17 = new Date("2026-05-17T08:00:00.000Z"); // Shanghai 16:00 May 17

  it("returns 20 min + newUser reason when there is no history", () => {
    const r = deriveChallenge("2026-05-17", [], may17);
    expect(r.targetMinutes).toBe(20);
    expect(r.reason).toBe("newUser");
  });

  it("returns 20 min + minimumFloor when the median is positive but tiny", () => {
    // 6 days of 10 min each → median 10 → 70% = 7 → floor 20
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 10, "a"),
      s("2026-05-12T08:00:00.000Z", 10, "b"),
      s("2026-05-13T08:00:00.000Z", 10, "c"),
      s("2026-05-14T08:00:00.000Z", 10, "d"),
      s("2026-05-15T08:00:00.000Z", 10, "e"),
      s("2026-05-16T08:00:00.000Z", 10, "f")
    ];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(20);
    expect(r.reason).toBe("minimumFloor");
  });

  it("returns roughly 70% of median rounded to 15 for a typical user", () => {
    // 6 days of 60 min → median 60 → 70% = 42 → rounded to 45
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 60, "a"),
      s("2026-05-12T08:00:00.000Z", 60, "b"),
      s("2026-05-13T08:00:00.000Z", 60, "c"),
      s("2026-05-14T08:00:00.000Z", 60, "d"),
      s("2026-05-15T08:00:00.000Z", 60, "e"),
      s("2026-05-16T08:00:00.000Z", 60, "f")
    ];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(45);
    expect(r.reason).toBe("fromMedian");
  });

  it("caps at 90 with cappedHigh reason for heavy users", () => {
    // 6 days of 4h = 240 min each → median 240 → 70% = 168 → capped to 90
    const sessions = [
      s("2026-05-11T08:00:00.000Z", 240, "a"),
      s("2026-05-12T08:00:00.000Z", 240, "b"),
      s("2026-05-13T08:00:00.000Z", 240, "c"),
      s("2026-05-14T08:00:00.000Z", 240, "d"),
      s("2026-05-15T08:00:00.000Z", 240, "e"),
      s("2026-05-16T08:00:00.000Z", 240, "f")
    ];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(90);
    expect(r.reason).toBe("cappedHigh");
  });

  it("excludes today's sessions from the median (we want yesterday-typical, not in-progress today)", () => {
    // 5 zero-days + 1 huge today: today is excluded, so median = 0 → newUser
    const sessions = [
      s("2026-05-17T08:00:00.000Z", 500, "today")
    ];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(20);
    expect(r.reason).toBe("newUser");
  });

  it("includes zero-days in the median (a 1-on-6-off pattern → low target)", () => {
    // One 240-min day + 5 zero days → sorted [0,0,0,0,0,240], median=0
    const sessions = [s("2026-05-11T08:00:00.000Z", 240, "a")];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(20);
    expect(r.reason).toBe("newUser");
  });

  it("respects Shanghai TZ when bucketing sessions to days", () => {
    // 2026-05-16 23:30 Shanghai = 15:30 UTC. Should land in the May 16
    // bucket (a "yesterday" relative to May 17), not bleed into May 17.
    // Six identical days at the Shanghai night → median 60 → 45 target.
    const sessions = [
      s("2026-05-11T15:30:00.000Z", 60, "a"),
      s("2026-05-12T15:30:00.000Z", 60, "b"),
      s("2026-05-13T15:30:00.000Z", 60, "c"),
      s("2026-05-14T15:30:00.000Z", 60, "d"),
      s("2026-05-15T15:30:00.000Z", 60, "e"),
      s("2026-05-16T15:30:00.000Z", 60, "f")
    ];
    const r = deriveChallenge("2026-05-17", sessions, may17);
    expect(r.targetMinutes).toBe(45);
  });
});

describe("getOrCreateTodayChallenge", () => {
  beforeEach(() => __resetDailyChallengeForTests());
  const may17 = new Date("2026-05-17T08:00:00.000Z");

  it("creates a fresh challenge on first call of the day", () => {
    const c = getOrCreateTodayChallenge([], may17);
    expect(c.day).toBe("2026-05-17");
    expect(c.targetMinutes).toBe(20);
    expect(c.completedAt).toBeNull();
  });

  it("returns the same challenge on subsequent same-day calls", () => {
    const first = getOrCreateTodayChallenge([], may17);
    const second = getOrCreateTodayChallenge([], new Date("2026-05-17T15:00:00.000Z"));
    expect(second.day).toBe(first.day);
    expect(second.targetMinutes).toBe(first.targetMinutes);
  });

  it("regenerates when the day flips (Shanghai TZ)", () => {
    const may17 = new Date("2026-05-17T08:00:00.000Z");
    const may18 = new Date("2026-05-18T08:00:00.000Z");
    const a = getOrCreateTodayChallenge([], may17);
    const b = getOrCreateTodayChallenge([], may18);
    expect(a.day).toBe("2026-05-17");
    expect(b.day).toBe("2026-05-18");
  });
});

describe("markChallengeIfComplete", () => {
  beforeEach(() => __resetDailyChallengeForTests());
  const may17 = new Date("2026-05-17T08:00:00.000Z");

  it("marks complete when today's minutes >= target", () => {
    const challenge = getOrCreateTodayChallenge([], may17);
    const updated = markChallengeIfComplete(challenge, 25, may17);
    expect(updated.completedAt).not.toBeNull();
  });

  it("leaves challenge open when below target", () => {
    const challenge = getOrCreateTodayChallenge([], may17);
    const updated = markChallengeIfComplete(challenge, 10, may17);
    expect(updated.completedAt).toBeNull();
  });

  it("does not re-mark a completed challenge", () => {
    let challenge = getOrCreateTodayChallenge([], may17);
    challenge = markChallengeIfComplete(challenge, 25, may17);
    const firstCompletion = challenge.completedAt;
    // Subsequent crossing — wouldn't update timestamp
    challenge = markChallengeIfComplete(challenge, 60, new Date("2026-05-17T18:00:00.000Z"));
    expect(challenge.completedAt).toBe(firstCompletion);
  });
});

describe("toShanghaiDayKey", () => {
  it("formats a UTC moment to a Shanghai YYYY-MM-DD", () => {
    // Midnight UTC → 08:00 Shanghai same day
    expect(toShanghaiDayKey(new Date("2026-05-17T00:00:00.000Z"))).toBe("2026-05-17");
    // 17:00 UTC → 01:00 Shanghai next day
    expect(toShanghaiDayKey(new Date("2026-05-17T17:00:00.000Z"))).toBe("2026-05-18");
  });
});

describe("reasonLabel", () => {
  it("returns a friendly Chinese label for each reason", () => {
    expect(reasonLabel("newUser")).toMatch(/起步/);
    expect(reasonLabel("minimumFloor")).toMatch(/起步/);
    expect(reasonLabel("cappedHigh")).toMatch(/封顶/);
    expect(reasonLabel("fromMedian")).toMatch(/推荐/);
  });
});

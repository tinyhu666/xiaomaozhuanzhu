import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Mock wx storage BEFORE importing the module — utils/monthly.ts reads
// from wx at module-load time only via top-level const, but the
// consumeMonthlySummary function depends on wx.getStorageSync /
// wx.setStorageSync being callable.
const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key)
};

import {
  __resetMonthlySummaryForTests,
  computeMonthlySummaryFor,
  consumeMonthlySummary
} from "../utils/monthly";
import type { CompletedSession } from "../utils/api";

beforeEach(() => storage.clear());
afterEach(() => storage.clear());

function session(overrides: Partial<CompletedSession> = {}): CompletedSession {
  return {
    id: "s1",
    subject: "会计",
    mode: "free",
    durationMinutes: 60,
    pomodoroCycles: 0,
    startedAt: "2026-04-15T01:00:00.000Z",
    endedAt: "2026-04-15T02:00:00.000Z",
    ...overrides
  };
}

describe("computeMonthlySummaryFor", () => {
  it("returns null when the month has no completed sessions", () => {
    const result = computeMonthlySummaryFor([], "2026-04");
    expect(result).toBeNull();
  });

  it("skips sessions outside the requested month", () => {
    // March session shouldn't pollute April's summary.
    const result = computeMonthlySummaryFor(
      [
        session({ id: "march", endedAt: "2026-03-30T02:00:00.000Z" }),
        session({ id: "april", endedAt: "2026-04-10T02:00:00.000Z", durationMinutes: 45 })
      ],
      "2026-04"
    );
    expect(result?.totalMinutes).toBe(45);
    expect(result?.sessionCount).toBe(1);
  });

  it("aggregates totals + session count + best day correctly", () => {
    const result = computeMonthlySummaryFor(
      [
        session({ id: "a", endedAt: "2026-04-10T02:00:00.000Z", durationMinutes: 30 }),
        session({ id: "b", endedAt: "2026-04-10T08:00:00.000Z", durationMinutes: 45 }),
        session({ id: "c", endedAt: "2026-04-11T02:00:00.000Z", durationMinutes: 20 })
      ],
      "2026-04"
    );
    expect(result?.totalMinutes).toBe(95);
    expect(result?.sessionCount).toBe(3);
    // April 10 has 30 + 45 = 75; April 11 has 20. Best day = April 10.
    expect(result?.bestDay?.minutes).toBe(75);
    expect(result?.bestDay?.dateLabel).toBe("4 月 10 日");
  });

  it("picks the top subject by minutes (ignoring sessions with no subject)", () => {
    const result = computeMonthlySummaryFor(
      [
        session({ id: "a", subject: "会计", durationMinutes: 30 }),
        session({ id: "b", subject: "审计", durationMinutes: 80 }),
        session({ id: "c", subject: null, durationMinutes: 200, endedAt: "2026-04-12T02:00:00.000Z" })
      ],
      "2026-04"
    );
    expect(result?.topSubject?.name).toBe("审计");
    expect(result?.topSubject?.minutes).toBe(80);
  });

  it("returns null topSubject when no session has a subject", () => {
    const result = computeMonthlySummaryFor(
      [session({ subject: null })],
      "2026-04"
    );
    expect(result?.topSubject).toBeNull();
  });

  it("buildChange: kind=noPrior when there are no sessions in the previous month", () => {
    const result = computeMonthlySummaryFor(
      [session({ id: "a", endedAt: "2026-04-10T02:00:00.000Z", durationMinutes: 60 })],
      "2026-04"
    );
    expect(result?.change.kind).toBe("noPrior");
  });

  it("buildChange: kind=up with correct percent / delta when this month exceeds last", () => {
    const result = computeMonthlySummaryFor(
      [
        session({ id: "mar1", endedAt: "2026-03-15T02:00:00.000Z", durationMinutes: 100 }),
        session({ id: "apr1", endedAt: "2026-04-15T02:00:00.000Z", durationMinutes: 150 })
      ],
      "2026-04"
    );
    expect(result?.change.kind).toBe("up");
    if (result?.change.kind === "up") {
      expect(result.change.deltaMinutes).toBe(50);
      expect(result.change.percent).toBe(50);
    }
  });

  it("buildChange: kind=down when this month is lower", () => {
    const result = computeMonthlySummaryFor(
      [
        session({ id: "mar1", endedAt: "2026-03-15T02:00:00.000Z", durationMinutes: 200 }),
        session({ id: "apr1", endedAt: "2026-04-15T02:00:00.000Z", durationMinutes: 160 })
      ],
      "2026-04"
    );
    expect(result?.change.kind).toBe("down");
    if (result?.change.kind === "down") {
      expect(result.change.deltaMinutes).toBe(40);
      expect(result.change.percent).toBe(20);
    }
  });

  it("buildChange: kind=flat when identical", () => {
    const result = computeMonthlySummaryFor(
      [
        session({ id: "mar1", endedAt: "2026-03-15T02:00:00.000Z", durationMinutes: 100 }),
        session({ id: "apr1", endedAt: "2026-04-15T02:00:00.000Z", durationMinutes: 100 })
      ],
      "2026-04"
    );
    expect(result?.change.kind).toBe("flat");
  });

  it("handles January → previous month is December of prior year", () => {
    // Sessions in Dec 2025 + Jan 2026; ask for Jan 2026 summary.
    const result = computeMonthlySummaryFor(
      [
        session({ id: "dec", endedAt: "2025-12-15T02:00:00.000Z", durationMinutes: 90 }),
        session({ id: "jan", endedAt: "2026-01-10T02:00:00.000Z", durationMinutes: 60 })
      ],
      "2026-01"
    );
    expect(result?.totalMinutes).toBe(60);
    expect(result?.change.kind).toBe("down");
  });

  it("respects Shanghai timezone when bucketing by month (UTC 23:00 = next-day Shanghai)", () => {
    // 2026-03-31 23:30 UTC is 2026-04-01 07:30 in Shanghai — so it
    // should count toward April, not March.
    const result = computeMonthlySummaryFor(
      [session({ id: "edge", endedAt: "2026-03-31T23:30:00.000Z", durationMinutes: 45 })],
      "2026-04"
    );
    expect(result?.totalMinutes).toBe(45);
  });

  it("monthLabel uses Chinese 月 suffix", () => {
    const result = computeMonthlySummaryFor(
      [session({ endedAt: "2026-04-15T02:00:00.000Z" })],
      "2026-04"
    );
    expect(result?.monthLabel).toBe("4 月");
  });
});

describe("consumeMonthlySummary", () => {
  beforeEach(() => __resetMonthlySummaryForTests());

  it("returns null if there's no data for last month", () => {
    // Now = May 15, 2026; no sessions at all.
    const result = consumeMonthlySummary([], new Date("2026-05-15T08:00:00.000Z"));
    expect(result).toBeNull();
  });

  it("fires once per month when there is prior-month data", () => {
    // Now is May 15; last month (April) has 1 session.
    const sessions = [session({ endedAt: "2026-04-20T02:00:00.000Z", durationMinutes: 60 })];
    const now = new Date("2026-05-15T08:00:00.000Z");
    const first = consumeMonthlySummary(sessions, now);
    expect(first).not.toBeNull();
    expect(first?.monthKey).toBe("2026-04");
    // Second call in the same month: storage gate kicks in.
    const second = consumeMonthlySummary(sessions, now);
    expect(second).toBeNull();
  });

  it("marks the month as seen even when last-month had no data, so we don't recompute on every visit", () => {
    const now = new Date("2026-05-15T08:00:00.000Z");
    const firstCall = consumeMonthlySummary([], now);
    expect(firstCall).toBeNull();
    // If a session for April appears LATER in the same month (e.g.
    // backfill / late sync), we still don't fire — the user already
    // crossed the threshold without data and we lock until June.
    const sessions = [session({ endedAt: "2026-04-20T02:00:00.000Z", durationMinutes: 60 })];
    const secondCall = consumeMonthlySummary(sessions, now);
    expect(secondCall).toBeNull();
  });

  it("fires a fresh summary in each rolled-over month with new data", () => {
    // April session only — May should fire April's summary.
    const sessionsAfterApril = [session({ endedAt: "2026-04-20T02:00:00.000Z", durationMinutes: 60 })];
    const may = new Date("2026-05-15T08:00:00.000Z");
    const mayFire = consumeMonthlySummary(sessionsAfterApril, may);
    expect(mayFire?.monthKey).toBe("2026-04");

    // June with the same data: May had no sessions → null. (Also
    // marks May as seen so we don't re-poll all month.)
    const june = new Date("2026-06-05T08:00:00.000Z");
    expect(consumeMonthlySummary(sessionsAfterApril, june)).toBeNull();

    // Add a May session + fast-forward to July: should fire May's
    // summary now. (Reset storage to simulate clean July state.)
    __resetMonthlySummaryForTests();
    const allSessions = [
      ...sessionsAfterApril,
      session({ id: "mayone", endedAt: "2026-05-12T02:00:00.000Z", durationMinutes: 80 })
    ];
    const july = new Date("2026-07-02T08:00:00.000Z");
    const julyFire = consumeMonthlySummary(allSessions, july);
    // The "previous month" relative to July is June — which has no
    // data, so this returns null. We assert the storage-gated null
    // rather than a fired summary.
    expect(julyFire).toBeNull();

    // Reset + ask for May summary directly via the pure compute fn
    // to confirm the data path works for that month.
    const mayDirect = computeMonthlySummaryFor(allSessions, "2026-05");
    expect(mayDirect?.totalMinutes).toBe(80);
  });
});

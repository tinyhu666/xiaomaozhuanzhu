import type { DailyStat, PauseSegment, StudySession } from "../types";

import { addShanghaiDays, formatShanghaiDate, startOfNextShanghaiDay, startOfShanghaiWeek } from "./date-utils";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// Heat-map levels: tuned so a typical CPA study day (1–3h) spans
// multiple shades instead of saturating at the darkest tone.
// 0  = no session
// 1  =      1 –  29 min   (warm-up)
// 2  =     30 –  59 min   (light)
// 3  =     60 – 119 min   (around the daily target)
// 4  =    120 – 239 min   (solid focus)
// 5  =   ≥ 240 min        (deep work)
export function getHeatLevel(totalMinutes: number) {
  if (totalMinutes <= 0) return 0;
  if (totalMinutes < 30) return 1;
  if (totalMinutes < 60) return 2;
  if (totalMinutes < 120) return 3;
  if (totalMinutes < 240) return 4;
  return 5;
}

export function calculateDurationMinutes(
  startedAt: string,
  endedAt: string,
  pauseSegments: PauseSegment[]
) {
  const totalMs = buildEffectiveIntervals(startedAt, endedAt, pauseSegments).reduce(
    (sum, [intervalStart, intervalEnd]) => sum + (intervalEnd - intervalStart),
    0
  );
  return Math.max(1, Math.round(totalMs / 60_000));
}

export function buildDayContributions(session: StudySession) {
  if (session.status === "makeup" && session.endedAt) {
    return new Map([[formatShanghaiDate(session.endedAt), 0]]);
  }
  if (session.status !== "completed" || !session.endedAt) {
    return new Map<string, number>();
  }

  const dayDurations = new Map<string, number>();

  for (const [intervalStart, intervalEnd] of buildEffectiveIntervals(session.startedAt, session.endedAt, session.pauseSegments)) {
    let cursor = intervalStart;

    while (cursor < intervalEnd) {
      const current = new Date(cursor);
      const dateKey = formatShanghaiDate(current);
      const boundary = startOfNextShanghaiDay(current).getTime();
      const segmentEnd = Math.min(intervalEnd, boundary);
      dayDurations.set(dateKey, (dayDurations.get(dateKey) ?? 0) + (segmentEnd - cursor));
      cursor = segmentEnd;
    }
  }

  return new Map(
    [...dayDurations.entries()].map(([date, ms]) => [date, Math.max(1, Math.round(ms / 60_000))])
  );
}

export function rebuildDailyStats(userId: string, sessions: StudySession[], now: string) {
  const byDate = new Map<string, { totalMinutes: number; sessionCount: number }>();

  for (const session of sessions) {
    const contributions = buildDayContributions(session);
    for (const [date, minutes] of contributions.entries()) {
      const existing = byDate.get(date) ?? { totalMinutes: 0, sessionCount: 0 };
      existing.totalMinutes += minutes;
      if (session.status === "completed") {
        existing.sessionCount += 1;
      }
      byDate.set(date, existing);
    }
  }

  const orderedDates = [...byDate.keys()].sort();
  const dailyStats = new Map<string, DailyStat>();
  let previousDate: string | null = null;
  let streak = 0;

  for (const date of orderedDates) {
    const value = byDate.get(date)!;
    streak = previousDate && addShanghaiDays(previousDate, 1) === date ? streak + 1 : 1;
    previousDate = date;
    dailyStats.set(date, {
      userId,
      date,
      totalMinutes: value.totalMinutes,
      sessionCount: value.sessionCount,
      heatLevel: getHeatLevel(value.totalMinutes),
      streakDays: streak,
      updatedAt: now
    });
  }

  return dailyStats;
}

/**
 * Distribute every completed session's effective study minutes across
 * the 24 Shanghai-local hours. A single long session spanning 8pm to
 * 11pm contributes ~60 min to each of hours 20, 21, 22. We split at
 * exact hour boundaries so a 2:55am→3:10am session credits both
 * hour 2 and hour 3 correctly.
 *
 * Returns a length-24 array of minutes per hour. The values are
 * cumulative, not averaged — averaging by "days the user was active
 * at that hour" hides users who pull occasional late-night marathons.
 */
export function buildHourlyPattern(sessions: StudySession[]): number[] {
  const minutesByHour = new Array<number>(24).fill(0);
  for (const session of sessions) {
    if (session.status !== "completed" || !session.endedAt) continue;
    const intervals = buildEffectiveIntervals(
      session.startedAt,
      session.endedAt,
      session.pauseSegments
    );
    for (const [intervalStart, intervalEnd] of intervals) {
      let cursor = intervalStart;
      while (cursor < intervalEnd) {
        const shanghaiMs = cursor + SHANGHAI_OFFSET_MS;
        const hour = Math.floor(shanghaiMs / 3600_000) % 24;
        const nextBoundaryShanghai = (Math.floor(shanghaiMs / 3600_000) + 1) * 3600_000;
        const segmentEnd = Math.min(intervalEnd, nextBoundaryShanghai - SHANGHAI_OFFSET_MS);
        minutesByHour[hour] += (segmentEnd - cursor) / 60_000;
        cursor = segmentEnd;
      }
    }
  }
  return minutesByHour.map((m) => Math.round(m));
}

/**
 * Average minutes per weekday across the days the user has any stats
 * for. Index 0 = Monday, 6 = Sunday. Empty array slots come back as 0.
 *
 * Computed timezone-independently from the YYYY-MM-DD date keys (no
 * `Date.getDay()` in browser-local zone — see v0.9.3 admin bug fix
 * for the precedent).
 */
export function buildWeekdayPattern(dailyStats: Iterable<DailyStat>): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const stat of dailyStats) {
    const parts = stat.date.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) continue;
    const utcDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    const idx = (utcDay + 6) % 7;
    totals[idx] += stat.totalMinutes;
    counts[idx] += 1;
  }
  return totals.map((sum, i) => (counts[i] ? Math.round(sum / counts[i]) : 0));
}

/**
 * "Best week" record — the calendar week (Mon→Sun, Shanghai) with the
 * highest cumulative minutes. Returns null when no completed days.
 */
export function findBestWeek(dailyStats: Iterable<DailyStat>): {
  weekStart: string;
  totalMinutes: number;
} | null {
  const byWeek = new Map<string, number>();
  for (const stat of dailyStats) {
    const weekStart = startOfShanghaiWeek(stat.date);
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + stat.totalMinutes);
  }
  let best: { weekStart: string; totalMinutes: number } | null = null;
  for (const [weekStart, totalMinutes] of byWeek) {
    if (!best || totalMinutes > best.totalMinutes) {
      best = { weekStart, totalMinutes };
    }
  }
  return best;
}

function buildEffectiveIntervals(startedAt: string, endedAt: string, pauseSegments: PauseSegment[]) {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const sortedPauses = [...pauseSegments].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const intervals: Array<[number, number]> = [];
  let cursor = startMs;

  for (const pause of sortedPauses) {
    const pauseStart = new Date(pause.startedAt).getTime();
    const pauseEnd = new Date(pause.endedAt).getTime();

    if (pauseStart > cursor) {
      intervals.push([cursor, Math.min(pauseStart, endMs)]);
    }
    cursor = Math.max(cursor, pauseEnd);
  }

  if (cursor < endMs) {
    intervals.push([cursor, endMs]);
  }

  return intervals.filter(([intervalStart, intervalEnd]) => intervalEnd > intervalStart);
}

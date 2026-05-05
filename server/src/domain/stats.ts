import type { DailyStat, PauseSegment, StudySession } from "../types";

import { addShanghaiDays, formatShanghaiDate, startOfNextShanghaiDay } from "./date-utils";

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

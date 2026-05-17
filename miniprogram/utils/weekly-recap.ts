/**
 * Weekly recap — Sunday-evening (or Monday-morning) automatic
 * pop-up on the profile tab. Companion to the monthly summary
 * but with a much shorter horizon. Shanghai-TZ + ISO-week aware.
 *
 * Firing rules
 * ============
 *   - Fires once per ISO week. Storage key:
 *       `cpa.weeklyRecap.lastSeen` = "2026-W20"
 *   - Eligible windows (Shanghai local):
 *       Sunday  ≥ 18:00  → "this week ending today"
 *       Monday  ≤ 06:00  → "last week"
 *     (Outside these windows we don't fire, even on a new week —
 *      the user is in the middle of the week and the recap would
 *      be misleading.)
 *   - If the user opens the app on Tuesday and missed Mon morning,
 *     we still fire if `lastSeen` is older than the just-finished
 *     ISO week. Better late than never.
 *
 * Content
 * =======
 *   - Total minutes / sessions for the recap week
 *   - 7-bar weekly chart (Mon..Sun)
 *   - vs prior week (noPrior / flat / up / down)
 *   - Top 2 subjects by minutes
 *   - One-line "next-week suggestion" derived from subject mix
 */
import type { CompletedSession } from "./api";

const STORAGE_KEY = "cpa.weeklyRecap.lastSeen";

export type WeeklyChange =
  | { kind: "noPrior" }
  | { kind: "flat" }
  | { kind: "up"; deltaMinutes: number; percent: number }
  | { kind: "down"; deltaMinutes: number; percent: number };

export type WeeklySubjectTotal = { name: string; minutes: number };

export type WeeklyRecap = {
  /** ISO week label like "2026-W20". */
  weekKey: string;
  /** Display range "5 月 11 日 – 17 日". */
  rangeLabel: string;
  /** Mon-anchored day labels for the 7 chart bars. */
  dayLabels: string[];
  /** 7 entries Mon..Sun, minutes per day. */
  dailyMinutes: number[];
  /** Total minutes across the 7-day window. */
  totalMinutes: number;
  /** Number of completed sessions in the window. */
  sessionCount: number;
  /** vs prior week. */
  change: WeeklyChange;
  /** Top subjects by minutes (descending), capped at 2 for display. */
  topSubjects: WeeklySubjectTotal[];
  /** Auto-generated "下周建议" line. */
  suggestion: string;
};

/* -------------------------------------------------------------------------- */
/*  Shanghai-TZ + ISO-week date math                                           */
/* -------------------------------------------------------------------------- */

function shiftToShanghai(date: Date): Date {
  return new Date(date.getTime() + 8 * 3600 * 1000);
}

/** Returns Shanghai-local YYYY-MM-DD for an ISO timestamp. */
function toShanghaiDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const s = shiftToShanghai(d);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}

/**
 * ISO-week key for a Shanghai-local moment, e.g. "2026-W20".
 * Standard ISO: weeks start Monday; week 1 contains January 4th.
 */
export function isoWeekKey(date: Date): string {
  // Shift to Shanghai noon to keep date math comfortable.
  const shifted = shiftToShanghai(date);
  const target = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  // Set to Thursday in current week (ISO weeks anchor on Thu).
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekDiff = Math.round(
    (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000)
  );
  const weekNo = weekDiff + 1;
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Subtract 7 days from an ISO-week key (handles year boundary). */
function previousWeekKey(weekKey: string, anchor: Date): string {
  const prevAnchor = new Date(anchor.getTime() - 7 * 24 * 3600 * 1000);
  return isoWeekKey(prevAnchor);
}

/** Start of the ISO week (Monday 00:00) containing `date`, in Shanghai TZ. */
function isoWeekStartShanghai(date: Date): Date {
  const shifted = shiftToShanghai(date);
  const dayNum = (shifted.getUTCDay() + 6) % 7; // Mon=0
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - dayNum));
  // Shift back to "real" UTC moment for Mon 00:00 Shanghai
  return new Date(start.getTime() - 8 * 3600 * 1000);
}

function dayLabel(shanghaiDate: Date): string {
  return `${shanghaiDate.getUTCMonth() + 1} 月 ${shanghaiDate.getUTCDate()} 日`;
}

function formatRange(weekStartUtc: Date): string {
  const start = shiftToShanghai(weekStartUtc);
  const end = shiftToShanghai(new Date(weekStartUtc.getTime() + 6 * 24 * 3600 * 1000));
  // Same month?
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCMonth() + 1} 月 ${start.getUTCDate()} 日 – ${end.getUTCDate()} 日`;
  }
  return `${start.getUTCMonth() + 1} 月 ${start.getUTCDate()} 日 – ${end.getUTCMonth() + 1} 月 ${end.getUTCDate()} 日`;
}

/* -------------------------------------------------------------------------- */
/*  Aggregation                                                                */
/* -------------------------------------------------------------------------- */

type WeekAggregate = {
  totalMinutes: number;
  sessionCount: number;
  /** 7 entries Mon..Sun. */
  dailyMinutes: number[];
  /** Subject minutes map. */
  bySubject: Map<string, number>;
};

function aggregateForWeekStart(
  sessions: CompletedSession[],
  weekStartUtc: Date
): WeekAggregate {
  const result: WeekAggregate = {
    totalMinutes: 0,
    sessionCount: 0,
    dailyMinutes: [0, 0, 0, 0, 0, 0, 0],
    bySubject: new Map()
  };
  // Build the 7-day key set (Mon..Sun) in Shanghai.
  const keys: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = shiftToShanghai(new Date(weekStartUtc.getTime() + i * 24 * 3600 * 1000));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
  }
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const dk = toShanghaiDayKey(s.endedAt);
    if (dk === null) continue;
    const idx = keyIndex.get(dk);
    if (idx === undefined) continue;
    result.totalMinutes += s.durationMinutes;
    result.sessionCount += 1;
    result.dailyMinutes[idx] += s.durationMinutes;
    if (s.subject) {
      result.bySubject.set(s.subject, (result.bySubject.get(s.subject) ?? 0) + s.durationMinutes);
    }
  }
  return result;
}

function buildChange(thisMin: number, priorMin: number): WeeklyChange {
  if (priorMin === 0) return { kind: "noPrior" };
  const delta = thisMin - priorMin;
  if (delta === 0) return { kind: "flat" };
  const percent = Math.round((Math.abs(delta) / priorMin) * 100);
  return delta > 0
    ? { kind: "up", percent, deltaMinutes: delta }
    : { kind: "down", percent, deltaMinutes: Math.abs(delta) };
}

function topSubjects(map: Map<string, number>, n = 2): WeeklySubjectTotal[] {
  return Array.from(map.entries())
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, n);
}

/**
 * Build the "下周建议" line. Rules walked in order; first match wins.
 *   - empty week → starter nudge
 *   - one subject took > 60% → diversification hint
 *   - any of the known 6 subjects is < 10% of weekly total → catch-up hint
 *   - otherwise → "keep it up"
 */
const SIX_SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"];

function buildSuggestion(
  totalMinutes: number,
  bySubject: Map<string, number>
): string {
  if (totalMinutes === 0) {
    return "下周从一次 25 分钟开始，节奏拉起来再加量。";
  }
  if (totalMinutes < 120) {
    return "本周量偏少，下周可以争取 5 天各 30 分钟以上。";
  }
  // Single subject dominates
  let topName: string | null = null;
  let topMinutes = 0;
  for (const [name, mins] of bySubject) {
    if (mins > topMinutes) {
      topName = name;
      topMinutes = mins;
    }
  }
  if (topName && topMinutes / totalMinutes > 0.6) {
    return `${topName} 占了 ${Math.round((topMinutes / totalMinutes) * 100)}%，下周适当分给薄弱科目。`;
  }
  // Find a "neglected" known subject
  for (const name of SIX_SUBJECTS) {
    const mins = bySubject.get(name) ?? 0;
    if (mins === 0) {
      return `${name} 本周没碰，下周尝试安排 1 次专注。`;
    }
  }
  return "节奏不错，下周继续保持。";
}

/* -------------------------------------------------------------------------- */
/*  Public compute + storage-gated fire                                        */
/* -------------------------------------------------------------------------- */

export function computeWeeklyRecap(
  sessions: CompletedSession[],
  weekStartUtc: Date
): WeeklyRecap {
  const week = aggregateForWeekStart(sessions, weekStartUtc);
  const priorStart = new Date(weekStartUtc.getTime() - 7 * 24 * 3600 * 1000);
  const prior = aggregateForWeekStart(sessions, priorStart);

  const dayLabels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = shiftToShanghai(new Date(weekStartUtc.getTime() + i * 24 * 3600 * 1000));
    dayLabels.push(dayLabel(d));
  }

  return {
    weekKey: isoWeekKey(new Date(weekStartUtc.getTime() + 12 * 3600 * 1000)),
    rangeLabel: formatRange(weekStartUtc),
    dayLabels,
    dailyMinutes: week.dailyMinutes,
    totalMinutes: week.totalMinutes,
    sessionCount: week.sessionCount,
    change: buildChange(week.totalMinutes, prior.totalMinutes),
    topSubjects: topSubjects(week.bySubject),
    suggestion: buildSuggestion(week.totalMinutes, week.bySubject)
  };
}

/**
 * Eligibility window: Sun 18:00 → Mon 06:00 Shanghai. The "recap week"
 * is the ISO week that just ended.
 *
 * If we're in the eligible window AND haven't shown this week yet,
 * returns a recap. Otherwise null. Side-effect-free; the caller
 * writes the storage when it actually displays.
 */
export function checkWeeklyRecapEligibility(now: Date): {
  eligible: boolean;
  recapWeekStartUtc: Date | null;
  recapWeekKey: string | null;
} {
  const sh = shiftToShanghai(now);
  const dayNum = (sh.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const hour = sh.getUTCHours();
  // Sunday after 18:00 → recap is this just-finished week (current week)
  if (dayNum === 6 && hour >= 18) {
    const start = isoWeekStartShanghai(now);
    return {
      eligible: true,
      recapWeekStartUtc: start,
      recapWeekKey: isoWeekKey(now)
    };
  }
  // Monday before 06:00 → recap last week
  if (dayNum === 0 && hour < 6) {
    const lastWeekAnchor = new Date(now.getTime() - 24 * 3600 * 1000);
    const start = isoWeekStartShanghai(lastWeekAnchor);
    return {
      eligible: true,
      recapWeekStartUtc: start,
      recapWeekKey: isoWeekKey(lastWeekAnchor)
    };
  }
  // Catch-up: if we never showed the immediately-previous ISO week
  // AND we're past Monday 06:00, show it on first open Tue-Sat.
  // (Handled in consumeWeeklyRecap by checking lastSeen vs previous-week.)
  return { eligible: false, recapWeekStartUtc: null, recapWeekKey: null };
}

function readLastSeen(): string {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch (_) {
    return "";
  }
}

function writeLastSeen(weekKey: string) {
  try {
    wx.setStorageSync(STORAGE_KEY, weekKey);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Public entry — storage-gated. Returns a recap iff the user is in
 * an eligibility window (or has a missed week) AND hasn't seen that
 * week's recap yet. Persists "seen" on every fire (incl. catch-up).
 */
export function consumeWeeklyRecap(
  sessions: CompletedSession[],
  now: Date
): WeeklyRecap | null {
  const lastSeen = readLastSeen();

  // First: in-window check.
  const direct = checkWeeklyRecapEligibility(now);
  if (direct.eligible && direct.recapWeekKey && direct.recapWeekStartUtc && lastSeen !== direct.recapWeekKey) {
    const recap = computeWeeklyRecap(sessions, direct.recapWeekStartUtc);
    if (recap.totalMinutes === 0 && recap.sessionCount === 0) {
      // No data — still mark seen so a quiet week doesn't trigger every
      // open. (User will see *next* week's recap if they log anything.)
      writeLastSeen(direct.recapWeekKey);
      return null;
    }
    writeLastSeen(direct.recapWeekKey);
    return recap;
  }

  // Catch-up: are we past Monday 06:00 but haven't seen last week's recap?
  // Only fire once between Mon 06:01 and Sat 23:59 if we missed it.
  const sh = shiftToShanghai(now);
  const dayNum = (sh.getUTCDay() + 6) % 7;
  const hour = sh.getUTCHours();
  const pastMondayMorning =
    (dayNum === 0 && hour >= 6) || dayNum >= 1; // Mon ≥6 or Tue..Sat
  if (!pastMondayMorning) return null;

  // Last week relative to "now": the ISO week ending at the most recent
  // Sunday.
  const lookbackAnchor = new Date(now.getTime() - 24 * 3600 * 1000 * Math.max(1, dayNum + 1));
  const lastWeekKey = isoWeekKey(lookbackAnchor);
  if (lastSeen === lastWeekKey) return null;
  const lastWeekStart = isoWeekStartShanghai(lookbackAnchor);
  const recap = computeWeeklyRecap(sessions, lastWeekStart);
  if (recap.totalMinutes === 0 && recap.sessionCount === 0) {
    writeLastSeen(lastWeekKey);
    return null;
  }
  writeLastSeen(lastWeekKey);
  return recap;
}

/** Test seam. */
export function __resetWeeklyRecapForTests() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}

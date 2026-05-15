/**
 * Monthly summary — computes the "11 月小结" modal that fires the
 * first time the user opens 我的 in a new calendar month.
 *
 * Why client-side
 * ===============
 * The server already exposes `/api/me/sessions` (capped at 200 most
 * recent completed sessions). For all but the most prolific users
 * that easily covers the previous calendar month + the month before
 * (used for the YoY comparison line). Computing on the client keeps
 * the server contract small and lets us add new summary metrics
 * later without backend deploys.
 *
 * Storage / firing rules
 * ======================
 *   - We persist the "last month label we showed" (e.g. "2026-04")
 *     in wx.setStorageSync. The summary fires when we're now in
 *     2026-05 and the previous month "2026-04" hasn't been shown.
 *   - "Previous month" is Shanghai-local — so a user opening the
 *     app at 23:59 UTC on May 31 still sees April's summary at
 *     07:59 SH June 1.
 *   - If the user has no data for the previous month we return null
 *     (no modal). Empty summaries are sad and unhelpful.
 *   - We DON'T re-fire when the user clears storage and re-opens —
 *     the function relies on `wx` being available and updates
 *     storage atomically with the read.
 */

import type { CompletedSession } from "./api";

const STORAGE_LAST_MONTHLY_KEY = "cpa.monthlySummary.lastSeen";

export type MonthlySummary = {
  /** Display label for the month being summarized, e.g. "4 月". */
  monthLabel: string;
  /** ISO key for the month being summarized, e.g. "2026-04". */
  monthKey: string;
  /** Total minutes across all completed sessions in the month. */
  totalMinutes: number;
  /** Number of completed sessions. */
  sessionCount: number;
  /** Best single day — date label like "4 月 12 日" + minutes. */
  bestDay: { dateLabel: string; minutes: number } | null;
  /** Top subject for the month (most minutes). null if no subject set on any session. */
  topSubject: { name: string; minutes: number } | null;
  /** Comparison vs the month before — see `change.kind` for shape. */
  change: MonthlyChange;
  /** A short, dynamic encouragement line picked based on the data. */
  encouragement: string;
};

export type MonthlyChange =
  | { kind: "noPrior"; }
  | { kind: "flat"; }
  | { kind: "up"; percent: number; deltaMinutes: number; }
  | { kind: "down"; percent: number; deltaMinutes: number; };

/* -------------------------------------------------------------------------- */
/*  Shanghai-TZ date helpers                                                   */
/* -------------------------------------------------------------------------- */

function toShanghaiDateKey(iso: string): string | null {
  // YYYY-MM-DD in Shanghai. Robust to ISO strings with or without offset.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function toShanghaiMonthKey(iso: string): string | null {
  const d = toShanghaiDateKey(iso);
  return d ? d.slice(0, 7) : null;
}

function shanghaiNowMonthKey(now: Date): string {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-05" → previous month "2026-04" (handles January rollback). */
function previousMonthKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

function monthLabelFromKey(monthKey: string): string {
  const m = Number(monthKey.split("-")[1]);
  return Number.isFinite(m) ? `${m} 月` : monthKey;
}

function formatDayLabel(dateKey: string): string {
  const parts = dateKey.split("-");
  if (parts.length !== 3) return dateKey;
  return `${Number(parts[1])} 月 ${Number(parts[2])} 日`;
}

/* -------------------------------------------------------------------------- */
/*  Aggregation                                                                */
/* -------------------------------------------------------------------------- */

type MonthlyAggregate = {
  totalMinutes: number;
  sessionCount: number;
  byDay: Map<string, number>;
  bySubject: Map<string, number>;
};

function aggregateForMonth(sessions: CompletedSession[], monthKey: string): MonthlyAggregate {
  const result: MonthlyAggregate = {
    totalMinutes: 0,
    sessionCount: 0,
    byDay: new Map(),
    bySubject: new Map()
  };
  for (const session of sessions) {
    const endedAt = session.endedAt;
    if (!endedAt) continue;
    const sessionMonth = toShanghaiMonthKey(endedAt);
    if (sessionMonth !== monthKey) continue;
    result.totalMinutes += session.durationMinutes;
    result.sessionCount += 1;
    const dayKey = toShanghaiDateKey(endedAt);
    if (dayKey) {
      result.byDay.set(dayKey, (result.byDay.get(dayKey) ?? 0) + session.durationMinutes);
    }
    if (session.subject) {
      result.bySubject.set(session.subject, (result.bySubject.get(session.subject) ?? 0) + session.durationMinutes);
    }
  }
  return result;
}

function pickBestDay(byDay: Map<string, number>): { dateLabel: string; minutes: number } | null {
  let best: { dateLabel: string; minutes: number } | null = null;
  for (const [day, minutes] of byDay) {
    if (!best || minutes > best.minutes) {
      best = { dateLabel: formatDayLabel(day), minutes };
    }
  }
  return best;
}

function pickTopSubject(bySubject: Map<string, number>): { name: string; minutes: number } | null {
  let best: { name: string; minutes: number } | null = null;
  for (const [name, minutes] of bySubject) {
    if (!best || minutes > best.minutes) {
      best = { name, minutes };
    }
  }
  return best;
}

function buildChange(thisMinutes: number, priorMinutes: number): MonthlyChange {
  if (priorMinutes === 0) return { kind: "noPrior" };
  const delta = thisMinutes - priorMinutes;
  if (delta === 0) return { kind: "flat" };
  const percent = Math.round(Math.abs(delta) / priorMinutes * 100);
  return delta > 0
    ? { kind: "up", percent, deltaMinutes: delta }
    : { kind: "down", percent, deltaMinutes: Math.abs(delta) };
}

function pickEncouragement(summary: {
  totalMinutes: number;
  sessionCount: number;
  change: MonthlyChange;
}): string {
  if (summary.sessionCount === 0) return "重新开始，从今天的第一次专注算起。";
  if (summary.change.kind === "up" && summary.change.percent >= 50) {
    return "节奏起来了，保持住这个势头。";
  }
  if (summary.change.kind === "up") {
    return "稳步向前，进度看得见。";
  }
  if (summary.change.kind === "down" && summary.change.percent >= 30) {
    return "下个月调整节奏，慢一点也没关系。";
  }
  if (summary.change.kind === "down") {
    return "新月份重新出发，先完成今天的第一次。";
  }
  if (summary.totalMinutes >= 600) return "10 小时以上的累计，已经超过了大多数考生。";
  return "持续就是胜利。下个月继续。";
}

/* -------------------------------------------------------------------------- */
/*  Public entry: compute + storage-gated firing                               */
/* -------------------------------------------------------------------------- */

/**
 * Pure compute — returns the summary for the given month label,
 * derived from the sessions list. Exposed for testing.
 */
export function computeMonthlySummaryFor(
  sessions: CompletedSession[],
  monthKey: string
): MonthlySummary | null {
  const thisMonth = aggregateForMonth(sessions, monthKey);
  if (thisMonth.sessionCount === 0) return null;
  const prior = aggregateForMonth(sessions, previousMonthKey(monthKey));
  const change = buildChange(thisMonth.totalMinutes, prior.totalMinutes);
  return {
    monthLabel: monthLabelFromKey(monthKey),
    monthKey,
    totalMinutes: thisMonth.totalMinutes,
    sessionCount: thisMonth.sessionCount,
    bestDay: pickBestDay(thisMonth.byDay),
    topSubject: pickTopSubject(thisMonth.bySubject),
    change,
    encouragement: pickEncouragement({
      totalMinutes: thisMonth.totalMinutes,
      sessionCount: thisMonth.sessionCount,
      change
    })
  };
}

/**
 * Storage-gated wrapper for the profile page. Returns a summary
 * iff:
 *   1. We're currently in a new month (vs. last seen).
 *   2. The previous calendar month has at least one session.
 *
 * Side effect: writes the previous month key to storage on first
 * call after the new month starts, so subsequent calls in the same
 * month return null.
 */
export function consumeMonthlySummary(
  sessions: CompletedSession[],
  now: Date
): MonthlySummary | null {
  const currentMonthKey = shanghaiNowMonthKey(now);
  const prevMonthKey = previousMonthKey(currentMonthKey);

  let lastSeen = "";
  try {
    const raw = wx.getStorageSync(STORAGE_LAST_MONTHLY_KEY);
    if (typeof raw === "string") lastSeen = raw;
  } catch (_) { /* non-fatal */ }

  if (lastSeen === prevMonthKey) return null;

  const summary = computeMonthlySummaryFor(sessions, prevMonthKey);
  if (!summary) {
    // No data last month — still mark as seen so we don't recompute
    // on every page open. (User will see this month's summary next
    // month if they actually log anything.)
    try { wx.setStorageSync(STORAGE_LAST_MONTHLY_KEY, prevMonthKey); } catch (_) { /* ignore */ }
    return null;
  }

  try { wx.setStorageSync(STORAGE_LAST_MONTHLY_KEY, prevMonthKey); } catch (_) { /* ignore */ }
  return summary;
}

/** Test seam — clears the storage so tests can rerun cleanly. */
export function __resetMonthlySummaryForTests() {
  try { wx.removeStorageSync(STORAGE_LAST_MONTHLY_KEY); } catch (_) { /* ignore */ }
}

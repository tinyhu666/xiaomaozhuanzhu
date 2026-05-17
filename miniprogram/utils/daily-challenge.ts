/**
 * Daily challenge — a small auto-generated target shown on the home
 * page each morning. Lives next to the user-set 今日目标 but serves
 * a different role: the goal is the user's *stretch ambition*; the
 * challenge is a *floor* the system asks for today.
 *
 * Why adaptive
 * ============
 * Static challenges ("hit 90 minutes today!") fail two populations:
 *   - new users for whom 90 is impossibly high
 *   - heavy users for whom 90 is trivial
 *
 * We pick a target that's ~70% of the user's recent median daily
 * minutes, rounded to a friendly multiple of 15. Floor at 20 so
 * brand-new accounts get a low-friction first step.
 *
 * Storage
 * =======
 *   wx storage key `cpa.dailyChallenge.v1` holds:
 *     { day: "2026-05-17", targetMinutes: 60, completedAt: iso|null }
 *   Re-generated when `day` changes (Shanghai TZ).
 */
import type { CompletedSession } from "./api";

const STORAGE_KEY = "cpa.dailyChallenge.v1";

export type DailyChallenge = {
  /** Shanghai-local day this challenge applies to, "YYYY-MM-DD". */
  day: string;
  /** Target minutes the user is asked to hit today. */
  targetMinutes: number;
  /** ISO timestamp when the user crossed the target, or null. */
  completedAt: string | null;
  /** Internal: how the target was chosen (for the "why" tooltip). */
  reason: ChallengeReason;
};

export type ChallengeReason =
  | "newUser"      // no history → starter target
  | "fromMedian"   // 70% of recent median rounded
  | "minimumFloor" // median was < 20 → floor applied
  | "cappedHigh";  // median was very high → cap at 90

/* -------------------------------------------------------------------------- */
/*  Shanghai-TZ helpers                                                        */
/* -------------------------------------------------------------------------- */

export function toShanghaiDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function sessionDayKey(session: CompletedSession): string | null {
  if (!session.endedAt) return null;
  const d = new Date(session.endedAt);
  if (Number.isNaN(d.getTime())) return null;
  return toShanghaiDayKey(d);
}

/* -------------------------------------------------------------------------- */
/*  Target derivation                                                          */
/* -------------------------------------------------------------------------- */

/** Round to the nearest multiple of 15, with a sensible minimum. */
function roundFriendly(minutes: number): number {
  if (minutes < 20) return 20;
  if (minutes >= 90) return 90; // cap — see "cappedHigh" reason
  return Math.round(minutes / 15) * 15;
}

/**
 * Recent daily totals (Shanghai TZ) for the last `windowDays` days
 * ending at `now`. Includes zero-days so the median reflects rest
 * days honestly (a 1-on/6-off pattern shouldn't suggest a punishing
 * daily target).
 */
export function recentDailyTotals(
  sessions: CompletedSession[],
  now: Date,
  windowDays = 7
): number[] {
  const todayKey = toShanghaiDayKey(now);
  const dayKeys: string[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
    dayKeys.push(toShanghaiDayKey(d));
  }
  // Avoid counting today's in-progress accumulation as "yesterday's
  // typical day": we want a steady-state median. Exclude today.
  const lookbackKeys = new Set(dayKeys.filter((k) => k !== todayKey));
  const byDay = new Map<string, number>();
  for (const key of lookbackKeys) byDay.set(key, 0);
  for (const s of sessions) {
    const key = sessionDayKey(s);
    if (key && lookbackKeys.has(key)) {
      byDay.set(key, (byDay.get(key) ?? 0) + s.durationMinutes);
    }
  }
  return Array.from(byDay.values());
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Pure derivation — given a day + history, what's today's challenge? */
export function deriveChallenge(
  day: string,
  sessions: CompletedSession[],
  now: Date
): Pick<DailyChallenge, "day" | "targetMinutes" | "reason"> {
  const recents = recentDailyTotals(sessions, now);
  if (recents.length === 0) {
    return { day, targetMinutes: 20, reason: "newUser" };
  }
  const med = median(recents);
  if (med === 0) {
    return { day, targetMinutes: 20, reason: "newUser" };
  }
  const raw = Math.round(med * 0.7);
  if (raw < 20) {
    return { day, targetMinutes: 20, reason: "minimumFloor" };
  }
  if (raw > 90) {
    return { day, targetMinutes: 90, reason: "cappedHigh" };
  }
  return { day, targetMinutes: roundFriendly(raw), reason: "fromMedian" };
}

/* -------------------------------------------------------------------------- */
/*  Storage-gated public API                                                   */
/* -------------------------------------------------------------------------- */

function readStored(): DailyChallenge | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.day !== "string" || typeof raw.targetMinutes !== "number") return null;
    return {
      day: raw.day,
      targetMinutes: raw.targetMinutes,
      completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
      reason: (raw.reason as ChallengeReason) ?? "fromMedian"
    };
  } catch (_) {
    return null;
  }
}

function writeStored(c: DailyChallenge) {
  try {
    wx.setStorageSync(STORAGE_KEY, c);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Return today's challenge, generating it on first call of the day
 * and persisting through subsequent calls. Idempotent on repeat
 * calls during the same Shanghai-local day.
 */
export function getOrCreateTodayChallenge(
  sessions: CompletedSession[],
  now: Date
): DailyChallenge {
  const todayKey = toShanghaiDayKey(now);
  const stored = readStored();
  if (stored && stored.day === todayKey) {
    return stored;
  }
  const derived = deriveChallenge(todayKey, sessions, now);
  const challenge: DailyChallenge = {
    ...derived,
    completedAt: null
  };
  writeStored(challenge);
  return challenge;
}

/**
 * After computing today's total minutes (from /home or local), call
 * this to flip the challenge to completed and persist. No-op if
 * already completed or not yet hit.
 */
export function markChallengeIfComplete(
  challenge: DailyChallenge,
  todayMinutes: number,
  now: Date
): DailyChallenge {
  if (challenge.completedAt) return challenge;
  if (todayMinutes < challenge.targetMinutes) return challenge;
  const updated: DailyChallenge = {
    ...challenge,
    completedAt: now.toISOString()
  };
  writeStored(updated);
  return updated;
}

/** Test seam — clears storage so tests can run cleanly. */
export function __resetDailyChallengeForTests() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/*  View-model helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Friendly Chinese sub-label for the "why this number" tooltip. */
export function reasonLabel(reason: ChallengeReason): string {
  switch (reason) {
    case "newUser":
      return "新账号起步目标";
    case "minimumFloor":
      return "最低起步 20 分钟";
    case "cappedHigh":
      return "封顶 90 分钟，保持余力";
    case "fromMedian":
      return "基于近 7 天节奏推荐";
  }
}

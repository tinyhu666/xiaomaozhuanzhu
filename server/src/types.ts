import type { SessionTag, Subject } from "./constants";

export type SessionStatus = "running" | "paused" | "completed" | "abandoned" | "makeup";

/**
 * "free" = the original free-running stopwatch.
 * "pomodoro" = 25-min focus / 5-min break cycles. The session row is
 * still a single record; cycle count is captured on completion.
 */
export type SessionMode = "free" | "pomodoro";

export interface User {
  id: string;
  openid: string | null;
  clientUid: string | null;
  nickname: string;
  avatarUrl: string;
  profileCompleted: boolean;
  /**
   * Optional admin-only label for this user. Set via the /admin
   * dashboard, never visible to the user themselves. Used as a
   * display fallback when the user has no nickname yet, and as a
   * primary label when the admin wants to categorize a user.
   */
  adminRemark: string;
  /**
   * v0.20 — opt-in WeChat 一次性订阅消息 daily 20:30 reminder.
   *   reminderEnabled  : user toggled it on
   *   reminderCredits  : # of unused subscribe-message authorizations
   *   reminderLastSentAt : last successful dispatch ISO; used to make
   *                       the cron idempotent within a Shanghai-day
   *   reminderLastError: last WeChat API error message (admin-only)
   */
  reminderEnabled: boolean;
  reminderCredits: number;
  reminderLastSentAt: string | null;
  reminderLastError: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface UserResolutionInput {
  openid?: string | null;
  clientUid?: string | null;
}

export interface PublicProfileSettings {
  userId: string;
  shareSlug: string;
  isPublic: boolean;
  requireWechatAuth: boolean;
}

export interface PauseSegment {
  startedAt: string;
  endedAt: string;
}

export interface StudySession {
  id: string;
  userId: string;
  status: SessionStatus;
  mode: SessionMode;
  startedAt: string;
  endedAt: string | null;
  currentPauseStartedAt: string | null;
  pauseSegments: PauseSegment[];
  durationMinutes: number;
  /** Pomodoro cycles completed in this session (0 for free mode). */
  pomodoroCycles: number;
  summary: string;
  subject: Subject | null;
  /** v0.37 — A3: optional free-text chapter/topic within a subject
   *  (e.g. "会计·金融资产"). Optional so existing session literals and
   *  rows without it stay valid. */
  topic?: string | null;
  tags: SessionTag[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionPhoto {
  id: string;
  sessionId: string;
  fileId: string;
  objectKey: string;
  sortOrder: number;
  createdAt: string;
}

/**
 * v0.38 — B2/B4 周复盘. A free-text weekly reflection the user writes
 * during their weekly review, keyed by an opaque client-supplied week
 * key (e.g. "2026-W21"). One row per user+week (upsert).
 */
export interface WeeklyReview {
  id: string;
  userId: string;
  weekKey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyStat {
  userId: string;
  date: string;
  totalMinutes: number;
  sessionCount: number;
  heatLevel: number;
  streakDays: number;
  updatedAt: string;
}

export interface TemporaryUrl {
  objectKey: string;
  url: string;
  expiresAt: string;
}

/**
 * Top-level news category surfaced in the miniprogram's 「动态」 tab.
 * Maps roughly to CICPA's own section breakdown:
 *   - announce: 公告 (official announcements: registration, fees, etc.)
 *   - outline:  考试大纲 / 命题说明
 *   - news:     news, policy interpretation, candidate guidance
 */
export type NewsCategory = "announce" | "outline" | "news";

export const NEWS_CATEGORIES: readonly NewsCategory[] = ["announce", "outline", "news"] as const;

export interface NewsItem {
  id: string;
  source: string;
  category: NewsCategory;
  title: string;
  summary: string;
  /** Plain-text body. Null when only the listing row has been parsed yet. */
  content: string | null;
  url: string;
  publishedAt: string;
  fetchedAt: string;
  hidden: boolean;
  /** True for admin-curated items; fetcher will never overwrite these. */
  manual: boolean;
  /** True for authoritative items (e.g. CICPA 官方公告); sort to top. */
  pinned: boolean;
}


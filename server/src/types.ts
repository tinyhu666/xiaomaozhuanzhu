import type { SessionTag, Subject } from "./constants";

export type SessionStatus = "running" | "paused" | "completed" | "abandoned" | "makeup";

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
  startedAt: string;
  endedAt: string | null;
  currentPauseStartedAt: string | null;
  pauseSegments: PauseSegment[];
  durationMinutes: number;
  summary: string;
  subject: Subject | null;
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
}


import type { SessionTag, Subject } from "./constants";

export type SessionStatus = "running" | "paused" | "completed" | "abandoned";

export interface User {
  id: string;
  openid: string;
  nickname: string;
  avatarUrl: string;
  profileCompleted: boolean;
  createdAt: string;
  lastLoginAt: string;
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

export interface QuoteSource {
  id: string;
  name: string;
  baseUrl: string;
  fetchType: string;
  isActive: boolean;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  quoteEn: string;
  quoteZh: string;
  author: string;
  topic: string;
  sourceId: string;
  sourceUrl: string;
  rawTitle: string;
  fingerprint: string;
  qualityScore: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDailyQuote {
  userId: string;
  quoteDate: string;
  slot: number;
  quoteId: string;
  createdAt: string;
}

export interface UserDailyQuoteState {
  userId: string;
  quoteDate: string;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HomeQuote {
  id: string;
  en: string;
  zh: string;
  author: string;
  topic: string;
  dailyIndex: number;
  dailyLimit: number;
}

export interface TemporaryUrl {
  objectKey: string;
  url: string;
  expiresAt: string;
}

import type {
  DailyStat,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User
} from "../types";

export type DataStore = {
  ensureUser(openid: string, now: string):
    | { user: User; publicProfile: PublicProfileSettings }
    | Promise<{ user: User; publicProfile: PublicProfileSettings }>;
  updateProfile(
    userId: string,
    profile: Partial<User>,
    publicProfile: Partial<PublicProfileSettings>
  ):
    | { user: User; publicProfile: PublicProfileSettings }
    | Promise<{ user: User; publicProfile: PublicProfileSettings }>;
  getPublicSettingsByUserId(userId: string): PublicProfileSettings | null | Promise<PublicProfileSettings | null>;
  getPublicSettingsBySlug(
    slug: string
  ):
    | { user: User; publicProfile: PublicProfileSettings }
    | null
    | Promise<{ user: User; publicProfile: PublicProfileSettings } | null>;
  getCurrentSession(userId: string): StudySession | null | Promise<StudySession | null>;
  getSession(sessionId: string): StudySession | null | Promise<StudySession | null>;
  saveSession(session: StudySession): StudySession | Promise<StudySession>;
  listSessions(userId: string): StudySession[] | Promise<StudySession[]>;
  savePhotos(sessionId: string, photos: SessionPhoto[]): void | Promise<void>;
  getPhotosBySessionId(sessionId: string): SessionPhoto[] | Promise<SessionPhoto[]>;
  getPhotosBySessionIds(sessionIds: string[]): SessionPhoto[] | Promise<SessionPhoto[]>;
  replaceDailyStats(userId: string, dailyStats: Map<string, DailyStat>): void | Promise<void>;
  getDailyStats(userId: string): Map<string, DailyStat> | Promise<Map<string, DailyStat>>;
};


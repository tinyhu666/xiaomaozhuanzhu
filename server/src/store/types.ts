import type {
  DailyStat,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User,
  UserResolutionInput
} from "../types";

export type DataStore = {
  ensureUser(input: UserResolutionInput, now: string):
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

  // Admin-facing reads. These are aggregate queries used by the
  // /admin dashboard and are not on the user-facing hot path.
  listAllUsers(): AdminUserSummary[] | Promise<AdminUserSummary[]>;
  getUserById(userId: string): User | null | Promise<User | null>;
  listRecentCompletedSessions(limit: number): AdminSessionWithOwner[] | Promise<AdminSessionWithOwner[]>;
};

export type AdminUserSummary = {
  user: User;
  totalMinutes: number;
  completedSessions: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastSessionAt: string | null;
};

export type AdminSessionWithOwner = {
  session: StudySession;
  user: Pick<User, "id" | "nickname" | "avatarUrl" | "openid" | "clientUid">;
};


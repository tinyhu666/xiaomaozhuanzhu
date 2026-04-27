export type SessionStatus = "running" | "paused" | "completed" | "abandoned";

export type UserProfile = {
  id: string;
  nickname: string;
  avatarUrl: string;
  profileCompleted: boolean;
  shareSlug: string;
  isPublic: boolean;
  requireWechatAuth: boolean;
};

export type PauseSegment = {
  startedAt: string;
  endedAt: string;
};

export type ActiveSession = {
  id: string;
  status: "running" | "paused";
  startedAt: string;
  currentPauseStartedAt: string | null;
  pauseSegments: PauseSegment[];
  effectiveMinutes: number;
};

export type DailyStat = {
  userId: string;
  date: string;
  totalMinutes: number;
  sessionCount: number;
  heatLevel: number;
  streakDays: number;
  updatedAt: string;
};

export type SessionPhoto = {
  fileId: string;
  objectKey: string;
  sortOrder?: number;
  tempUrl?: string;
};

export type WeeklyReview = {
  weekStart: string;
  weekEnd: string;
  thisWeekMinutes: number;
  lastWeekMinutes: number;
  bestDay: { date: string | null; totalMinutes: number };
  topSubject: { subject: string; totalMinutes: number } | null;
};

export type MakeupOpportunity = {
  date: string;
  streakIfRecovered: number;
};

export type HomeResponse = {
  profile: UserProfile;
  activeSession: ActiveSession | null;
  today: DailyStat;
  summary: {
    totalMinutes: number;
    currentStreakDays: number;
    lastSummary: string;
  };
  weeklyReview?: WeeklyReview;
  makeupAvailable?: MakeupOpportunity | null;
};

export type CalendarDayResponse = {
  date: string;
  totalMinutes: number;
  sessionCount: number;
  heatLevel: number;
  sessions: Array<{
    id: string;
    summary: string;
    subject: string | null;
    tags: string[];
    totalMinutes: number;
    photos: SessionPhoto[];
  }>;
};

export type PublicProfileResponse = {
  profile: UserProfile;
  summary: {
    totalMinutes: number;
    currentStreakDays: number;
  };
  calendar: DailyStat[];
  photos: Array<SessionPhoto & { tempUrl: string }>;
  recentSummaries: Array<{
    id: string;
    summary: string;
    subject: string | null;
    tags: string[];
    endedAt: string | null;
  }>;
};

export type Badge = {
  key: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
};

export type SubjectProgress = {
  subject: string;
  totalMinutes: number;
  targetMinutes?: number;
  progress?: number;
};

export type ProfileDashboardResponse = {
  profile: UserProfile;
  summary: {
    totalMinutes: number;
    currentStreakDays: number;
    longestStreakDays?: number;
    completedSessionCount?: number;
  };
  subjects: SubjectProgress[];
  subjectTargets?: SubjectProgress[];
  bestDay: {
    date: string | null;
    totalMinutes: number;
  };
  badges?: Badge[];
};

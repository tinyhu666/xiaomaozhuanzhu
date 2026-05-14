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

export type SessionMode = "free" | "pomodoro";

export type ActiveSession = {
  id: string;
  status: "running" | "paused";
  mode: SessionMode;
  startedAt: string;
  currentPauseStartedAt: string | null;
  pauseSegments: PauseSegment[];
  pomodoroCycles: number;
  subject: string | null;
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
  examSchedule?: ExamDateInfo[];
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
  progress: number;
  current: number;
  goal: number;
  unit: string;
};

export type SubjectProgress = {
  subject: string;
  totalMinutes: number;
  targetMinutes?: number;
  progress?: number;
};

export type ExamDateInfo = {
  subject: string;
  date: string;
  daysRemaining: number;
  fallback: boolean;
  sourceYear: number;
};

export type NewsCategory = "announce" | "outline" | "news";

export type NewsListItem = {
  id: string;
  source: string;
  category: NewsCategory;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
};

export type NewsDetail = NewsListItem & {
  content: string | null;
  fetchedAt: string;
};

export type NewsListResponse = {
  items: NewsListItem[];
  nextBefore: string | null;
};

export type NewsDetailResponse = {
  item: NewsDetail;
};

export type BestWeek = {
  weekStart: string;
  totalMinutes: number;
};

export type DashboardRecords = {
  bestDay: { date: string | null; totalMinutes: number };
  longestStreakDays: number;
  bestWeek: BestWeek | null;
};

export type DashboardPatterns = {
  /** 24 entries — cumulative minutes per Shanghai hour (00..23). */
  hourly: number[];
  /** 7 entries — average minutes per weekday (Mon..Sun, index 0=Mon). */
  weekday: number[];
  /** Index of the hour with most cumulative minutes, or null. */
  peakHour: number | null;
  /** Index of the weekday with highest average minutes, or null. */
  peakWeekday: number | null;
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
  examSchedule?: ExamDateInfo[];
  records?: DashboardRecords;
  patterns?: DashboardPatterns;
};

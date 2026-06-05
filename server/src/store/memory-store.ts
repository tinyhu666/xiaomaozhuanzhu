import { randomUUID } from "node:crypto";

import type {
  DailyStat,
  NewsItem,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User,
  UserResolutionInput,
  WeeklyReview
} from "../types";
import type { NewsListOptions, NewsUpsertResult } from "./types";

export class MemoryStore {
  private users = new Map<string, User>();
  private userByOpenId = new Map<string, string>();
  private userByClientUid = new Map<string, string>();
  private publicByUser = new Map<string, PublicProfileSettings>();
  private publicBySlug = new Map<string, string>();
  private sessions = new Map<string, StudySession>();
  private photos = new Map<string, SessionPhoto[]>();
  private dailyStats = new Map<string, Map<string, DailyStat>>();
  private newsById = new Map<string, NewsItem>();
  /** (source, url) -> id index, mirrors the MySQL UNIQUE constraint. */
  private newsBySourceUrl = new Map<string, string>();
  /** v0.38 — B2/B4 周复盘: userId -> reviews (one per weekKey). */
  private weeklyReviews = new Map<string, WeeklyReview[]>();

  /**
   * Resolve (or create) a user from an identity bundle. The miniprogram
   * sends both X-WX-OPENID (WeChat-injected) and X-CLIENT-UID (locally
   * persisted UUID) when available. Resolution prefers the wechat
   * identity but transparently merges anonymous-only history when the
   * same device later gains an openid.
   *
   *   1. openid hits an existing user → return; opportunistically attach
   *      clientUid for future anonymous fallback.
   *   2. openid miss but clientUid hits an anonymous user → promote that
   *      user by attaching the openid (no data loss).
   *   3. neither matches → create a fresh user carrying whichever
   *      identifiers we received.
   *   4. neither identifier given → throw to caller (401).
   */
  ensureUser(input: UserResolutionInput, now: string) {
    const openid = input.openid?.trim() || null;
    const clientUid = input.clientUid?.trim() || null;
    if (!openid && !clientUid) {
      throw new Error("UserResolutionInput requires openid or clientUid");
    }

    let target: User | null = null;
    if (openid) {
      const id = this.userByOpenId.get(openid);
      if (id) target = this.users.get(id) ?? null;
    }
    if (!target && clientUid) {
      const id = this.userByClientUid.get(clientUid);
      if (id) target = this.users.get(id) ?? null;
    }

    if (target) {
      // Backfill any missing identifier so subsequent calls can resolve
      // via either path.
      if (openid && !target.openid) {
        target.openid = openid;
        this.userByOpenId.set(openid, target.id);
      }
      if (clientUid && !target.clientUid) {
        target.clientUid = clientUid;
        this.userByClientUid.set(clientUid, target.id);
      }
      target.lastLoginAt = now;
      return {
        user: target,
        publicProfile: this.publicByUser.get(target.id)!
      };
    }

    const user: User = {
      id: randomUUID(),
      openid,
      clientUid,
      nickname: "",
      avatarUrl: "",
      profileCompleted: false,
      adminRemark: "",
      reminderEnabled: false,
      reminderCredits: 0,
      reminderLastSentAt: null,
      reminderLastError: "",
      createdAt: now,
      lastLoginAt: now
    };
    const publicProfile: PublicProfileSettings = {
      userId: user.id,
      shareSlug: randomUUID().slice(0, 8),
      isPublic: false,
      requireWechatAuth: true
    };

    this.users.set(user.id, user);
    if (openid) this.userByOpenId.set(openid, user.id);
    if (clientUid) this.userByClientUid.set(clientUid, user.id);
    this.publicByUser.set(user.id, publicProfile);
    this.publicBySlug.set(publicProfile.shareSlug, user.id);

    return { user, publicProfile };
  }

  updateProfile(userId: string, profile: Partial<User>, publicProfile: Partial<PublicProfileSettings>) {
    const user = this.users.get(userId)!;
    Object.assign(user, profile);
    const settings = this.publicByUser.get(userId)!;
    const previousSlug = settings.shareSlug;
    Object.assign(settings, publicProfile);

    if (settings.shareSlug !== previousSlug) {
      this.publicBySlug.delete(previousSlug);
      this.publicBySlug.set(settings.shareSlug, userId);
    }

    return { user, publicProfile: settings };
  }

  getPublicSettingsByUserId(userId: string) {
    return this.publicByUser.get(userId) ?? null;
  }

  getPublicSettingsBySlug(slug: string) {
    const userId = this.publicBySlug.get(slug);
    if (!userId) return null;
    return {
      user: this.users.get(userId)!,
      publicProfile: this.publicByUser.get(userId)!
    };
  }

  getCurrentSession(userId: string) {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.userId === userId && (session.status === "running" || session.status === "paused")
    );
    return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  saveSession(session: StudySession) {
    this.sessions.set(session.id, session);
    return session;
  }

  listSessions(userId: string) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  savePhotos(sessionId: string, photos: SessionPhoto[]) {
    this.photos.set(sessionId, photos);
  }

  getPhotosBySessionId(sessionId: string) {
    return this.photos.get(sessionId) ?? [];
  }

  getPhotosBySessionIds(sessionIds: string[]) {
    return sessionIds.flatMap((sessionId) => this.photos.get(sessionId) ?? []);
  }

  replaceDailyStats(userId: string, dailyStats: Map<string, DailyStat>) {
    this.dailyStats.set(userId, dailyStats);
  }

  getDailyStats(userId: string) {
    return this.dailyStats.get(userId) ?? new Map<string, DailyStat>();
  }

  listAllUsers() {
    const out: Array<{
      user: User;
      totalMinutes: number;
      completedSessions: number;
      currentStreakDays: number;
      longestStreakDays: number;
      lastSessionAt: string | null;
    }> = [];
    for (const user of this.users.values()) {
      const stats = this.dailyStats.get(user.id) ?? new Map<string, DailyStat>();
      let totalMinutes = 0;
      let completedSessions = 0;
      let longestStreakDays = 0;
      let latestStat: DailyStat | null = null;
      for (const stat of stats.values()) {
        totalMinutes += stat.totalMinutes;
        completedSessions += stat.sessionCount;
        if (stat.streakDays > longestStreakDays) longestStreakDays = stat.streakDays;
        if (!latestStat || stat.date > latestStat.date) latestStat = stat;
      }
      const sessions = [...this.sessions.values()]
        .filter((s) => s.userId === user.id && s.status === "completed")
        .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
      out.push({
        user,
        totalMinutes,
        completedSessions,
        currentStreakDays: latestStat?.streakDays ?? 0,
        longestStreakDays,
        lastSessionAt: sessions[0]?.endedAt ?? null
      });
    }
    return out.sort((a, b) =>
      (b.user.lastLoginAt ?? "").localeCompare(a.user.lastLoginAt ?? "")
    );
  }

  getUserById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  setAdminRemark(userId: string, remark: string) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.adminRemark = remark;
    return user;
  }

  // ---------------------------------------------------------------
  // v0.20 reminder module
  // ---------------------------------------------------------------

  incrementReminderCredits(userId: string, by: number) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.reminderCredits = Math.max(0, Math.min(999, user.reminderCredits + by));
    return user;
  }

  setReminderEnabled(userId: string, enabled: boolean) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.reminderEnabled = enabled;
    return user;
  }

  recordReminderDispatch(userId: string, sentAtIso: string, error?: string) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (error) {
      user.reminderLastError = String(error).slice(0, 240);
    } else {
      user.reminderCredits = Math.max(0, user.reminderCredits - 1);
      user.reminderLastSentAt = sentAtIso;
      user.reminderLastError = "";
    }
    return user;
  }

  listReminderRecipients() {
    return [...this.users.values()].filter(
      (u) => u.reminderEnabled && u.reminderCredits > 0 && u.openid
    );
  }

  // ---------------------------------------------------------------
  // News module
  // ---------------------------------------------------------------

  listNews(options: NewsListOptions = {}) {
    return this.listNewsInternal({ ...options, includeHidden: options.includeHidden ?? false });
  }

  listNewsForAdmin(options: NewsListOptions = {}) {
    return this.listNewsInternal({ ...options, includeHidden: options.includeHidden ?? true });
  }

  private listNewsInternal(options: NewsListOptions) {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const beforeKey = options.before ?? "";
    const wantCategory = options.category && options.category !== "all" ? options.category : null;
    return [...this.newsById.values()]
      .filter((item) => (options.includeHidden ? true : !item.hidden))
      .filter((item) => (wantCategory ? item.category === wantCategory : true))
      .filter((item) => (beforeKey ? item.publishedAt < beforeKey : true))
      // Sort: pinned (官方源) first, then most recent.
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return right.publishedAt.localeCompare(left.publishedAt);
      })
      .slice(0, limit);
  }

  getNewsById(id: string) {
    return this.newsById.get(id) ?? null;
  }

  upsertNewsBatch(items: NewsItem[]): NewsUpsertResult {
    let inserted = 0;
    let updated = 0;
    for (const item of items) {
      const key = `${item.source} ${item.url}`;
      const existingId = this.newsBySourceUrl.get(key);
      if (existingId) {
        const existing = this.newsById.get(existingId);
        if (existing?.manual) continue;
        // Preserve admin-set hidden + pinned flags through refreshes.
        const next: NewsItem = {
          ...item,
          id: existingId,
          hidden: existing?.hidden ?? item.hidden,
          manual: existing?.manual ?? item.manual,
          pinned: existing?.pinned ?? item.pinned
        };
        this.newsById.set(existingId, next);
        updated += 1;
        continue;
      }
      this.newsById.set(item.id, item);
      this.newsBySourceUrl.set(key, item.id);
      inserted += 1;
    }
    return { inserted, updated };
  }

  putNewsManual(item: NewsItem) {
    const manualItem: NewsItem = { ...item, manual: true };
    this.newsById.set(item.id, manualItem);
    this.newsBySourceUrl.set(`${item.source} ${item.url}`, item.id);
    return manualItem;
  }

  setNewsHidden(id: string, hidden: boolean) {
    const item = this.newsById.get(id);
    if (!item) return null;
    const updated: NewsItem = { ...item, hidden };
    this.newsById.set(id, updated);
    return updated;
  }

  deleteNewsById(id: string) {
    const item = this.newsById.get(id);
    if (!item) return false;
    this.newsById.delete(id);
    this.newsBySourceUrl.delete(`${item.source} ${item.url}`);
    return true;
  }

  saveWeeklyReview(userId: string, weekKey: string, content: string, now: string): WeeklyReview {
    const list = this.weeklyReviews.get(userId) ?? [];
    const existing = list.find((review) => review.weekKey === weekKey);
    if (existing) {
      existing.content = content;
      existing.updatedAt = now;
      this.weeklyReviews.set(userId, list);
      return existing;
    }
    const review: WeeklyReview = {
      id: randomUUID(),
      userId,
      weekKey,
      content,
      createdAt: now,
      updatedAt: now
    };
    list.push(review);
    this.weeklyReviews.set(userId, list);
    return review;
  }

  listWeeklyReviews(userId: string): WeeklyReview[] {
    const list = this.weeklyReviews.get(userId) ?? [];
    return [...list].sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  }

  listRecentCompletedSessions(limit: number) {
    const sessions = [...this.sessions.values()]
      .filter((session) => session.status === "completed" && session.endedAt)
      .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))
      .slice(0, Math.max(0, Math.min(limit, 200)));
    return sessions.map((session) => {
      const owner = this.users.get(session.userId);
      return {
        session,
        user: {
          id: session.userId,
          nickname: owner?.nickname ?? "",
          avatarUrl: owner?.avatarUrl ?? "",
          openid: owner?.openid ?? null,
          clientUid: owner?.clientUid ?? null
        }
      };
    });
  }
}


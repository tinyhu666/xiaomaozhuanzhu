import { randomUUID } from "node:crypto";

import type {
  DailyStat,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User,
  UserResolutionInput
} from "../types";

export class MemoryStore {
  private users = new Map<string, User>();
  private userByOpenId = new Map<string, string>();
  private userByClientUid = new Map<string, string>();
  private publicByUser = new Map<string, PublicProfileSettings>();
  private publicBySlug = new Map<string, string>();
  private sessions = new Map<string, StudySession>();
  private photos = new Map<string, SessionPhoto[]>();
  private dailyStats = new Map<string, Map<string, DailyStat>>();

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


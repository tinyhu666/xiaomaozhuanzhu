import { randomUUID } from "node:crypto";

import type {
  DailyStat,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User
} from "../types";

export class MemoryStore {
  private users = new Map<string, User>();
  private userByOpenId = new Map<string, string>();
  private publicByUser = new Map<string, PublicProfileSettings>();
  private publicBySlug = new Map<string, string>();
  private sessions = new Map<string, StudySession>();
  private photos = new Map<string, SessionPhoto[]>();
  private dailyStats = new Map<string, Map<string, DailyStat>>();

  ensureUser(openid: string, now: string) {
    const existingId = this.userByOpenId.get(openid);
    if (existingId) {
      const user = this.users.get(existingId)!;
      user.lastLoginAt = now;
      return {
        user,
        publicProfile: this.publicByUser.get(user.id)!
      };
    }

    const user: User = {
      id: randomUUID(),
      openid,
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
    this.userByOpenId.set(openid, user.id);
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
}


import { randomUUID } from "node:crypto";

import type {
  DailyStat,
  Quote,
  QuoteSource,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  UserDailyQuote,
  UserDailyQuoteState,
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
  private quoteSources = new Map<string, QuoteSource>();
  private quotes = new Map<string, Quote>();
  private userDailyQuotes = new Map<string, UserDailyQuote[]>();
  private userDailyQuoteStates = new Map<string, UserDailyQuoteState>();

  listUsers() {
    return [...this.users.values()].sort(
      (left, right) => right.lastLoginAt.localeCompare(left.lastLoginAt) || right.createdAt.localeCompare(left.createdAt)
    );
  }

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

  saveQuoteSources(sources: QuoteSource[]) {
    for (const source of sources) {
      this.quoteSources.set(source.id, { ...source });
    }
  }

  getActiveQuoteSources() {
    return [...this.quoteSources.values()]
      .filter((source) => source.isActive)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  saveQuotes(quotes: Quote[]) {
    for (const quote of quotes) {
      this.quotes.set(quote.id, { ...quote });
    }
  }

  getActiveQuotes() {
    return [...this.quotes.values()]
      .filter((quote) => quote.isActive)
      .sort(compareQuotes);
  }

  getQuotesByIds(quoteIds: string[]) {
    return quoteIds
      .map((quoteId) => this.quotes.get(quoteId))
      .filter((quote): quote is Quote => Boolean(quote))
      .map((quote) => ({ ...quote }));
  }

  replaceUserDailyQuotes(userId: string, quoteDate: string, quotes: UserDailyQuote[]) {
    this.userDailyQuotes.set(getDailyKey(userId, quoteDate), quotes.map((quote) => ({ ...quote })));
  }

  getUserDailyQuotes(userId: string, quoteDate: string) {
    return [...(this.userDailyQuotes.get(getDailyKey(userId, quoteDate)) ?? [])]
      .sort((left, right) => left.slot - right.slot)
      .map((quote) => ({ ...quote }));
  }

  getUserDailyQuoteState(userId: string, quoteDate: string) {
    const state = this.userDailyQuoteStates.get(getDailyKey(userId, quoteDate));
    return state ? { ...state } : null;
  }

  saveUserDailyQuoteState(state: UserDailyQuoteState) {
    this.userDailyQuoteStates.set(getDailyKey(state.userId, state.quoteDate), { ...state });
  }
}

function getDailyKey(userId: string, quoteDate: string) {
  return `${userId}:${quoteDate}`;
}

function compareQuotes(left: Quote, right: Quote) {
  return (
    right.qualityScore - left.qualityScore ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

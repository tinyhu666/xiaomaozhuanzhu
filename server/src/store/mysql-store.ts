import { randomUUID } from "node:crypto";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { fromMySqlDateTime, toMySqlDateTime } from "./mysql-date";
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

type SessionRow = RowDataPacket & {
  id: string;
  user_id: string;
  status: StudySession["status"];
  started_at: string;
  ended_at: string | null;
  current_pause_started_at: string | null;
  pause_segments_json: string | null;
  duration_minutes: number;
  summary: string;
  subject: string | null;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
};

type DailyStatRow = RowDataPacket & {
  user_id: string;
  stat_date: string;
  total_minutes: number;
  session_count: number;
  heat_level: number;
  streak_snapshot: number;
  updated_at: string;
};

type QuoteSourceRow = RowDataPacket & {
  id: string;
  name: string;
  base_url: string;
  fetch_type: string;
  is_active: number;
  last_fetched_at: string | null;
  created_at: string;
  updated_at: string;
};

type QuoteRow = RowDataPacket & {
  id: string;
  quote_en: string;
  quote_zh: string;
  author: string;
  topic: string;
  source_id: string;
  source_url: string;
  raw_title: string;
  fingerprint: string;
  quality_score: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type UserDailyQuoteRow = RowDataPacket & {
  user_id: string;
  quote_date: string;
  slot: number;
  quote_id: string;
  created_at: string;
};

type UserDailyQuoteStateRow = RowDataPacket & {
  user_id: string;
  quote_date: string;
  visit_count: number;
  created_at: string;
  updated_at: string;
};

export class MySQLStore {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    return new MySQLStore(
      createPool({
        uri: connectionString,
        connectionLimit: 10,
        namedPlaceholders: true
      })
    );
  }

  async ensureUser(openid: string, now: string) {
    const persistedNow = toMySqlDateTime(now);
    const suggestedUserId = randomUUID();
    const shareSlug = randomUUID().slice(0, 8);
    await this.pool.execute(
      `INSERT INTO users (id, openid, nickname, avatar_url, profile_completed, created_at, last_login_at)
      VALUES (?, ?, '', '', 0, ?, ?)
      ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)`,
      [suggestedUserId, openid, persistedNow, persistedNow]
    );
    const user = (await this.getUserByOpenid(openid))!;
    await this.pool.execute(
      `INSERT INTO user_public_settings (user_id, share_slug, is_public, require_wechat_auth)
      VALUES (?, ?, 0, 1)
      ON DUPLICATE KEY UPDATE user_id = user_id`,
      [user.id, shareSlug]
    );
    const publicProfile = (await this.getPublicSettingsByUserId(user.id))!;
    return {
      user,
      publicProfile
    };
  }

  async updateProfile(userId: string, profile: Partial<User>, publicProfile: Partial<PublicProfileSettings>) {
    await this.pool.execute(
      "UPDATE users SET nickname = ?, avatar_url = ?, profile_completed = ? WHERE id = ?",
      [profile.nickname ?? "", profile.avatarUrl ?? "", profile.profileCompleted ? 1 : 0, userId]
    );
    await this.pool.execute(
      "UPDATE user_public_settings SET is_public = ?, require_wechat_auth = ? WHERE user_id = ?",
      [publicProfile.isPublic ? 1 : 0, publicProfile.requireWechatAuth ? 1 : 0, userId]
    );

    const [user] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
    const updatedUser = mapUserRow(user[0]);
    const updatedPublic = (await this.getPublicSettingsByUserId(userId))!;
    return { user: updatedUser, publicProfile: updatedPublic };
  }

  async getPublicSettingsByUserId(userId: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT user_id, share_slug, is_public, require_wechat_auth FROM user_public_settings WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: String(row.user_id),
      shareSlug: String(row.share_slug),
      isPublic: Boolean(row.is_public),
      requireWechatAuth: Boolean(row.require_wechat_auth)
    };
  }

  async getPublicSettingsBySlug(slug: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
        u.id,
        u.openid,
        u.nickname,
        u.avatar_url,
        u.profile_completed,
        u.created_at,
        u.last_login_at,
        ups.user_id,
        ups.share_slug,
        ups.is_public,
        ups.require_wechat_auth
      FROM user_public_settings ups
      INNER JOIN users u ON u.id = ups.user_id
      WHERE ups.share_slug = ?
      LIMIT 1`,
      [slug]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      user: {
        id: String(row.id),
        openid: String(row.openid),
        nickname: String(row.nickname),
        avatarUrl: String(row.avatar_url),
        profileCompleted: Boolean(row.profile_completed),
        createdAt: fromMySqlDateTime(row.created_at) ?? "",
        lastLoginAt: fromMySqlDateTime(row.last_login_at) ?? ""
      },
      publicProfile: {
        userId: String(row.user_id),
        shareSlug: String(row.share_slug),
        isPublic: Boolean(row.is_public),
        requireWechatAuth: Boolean(row.require_wechat_auth)
      }
    };
  }

  async getCurrentSession(userId: string) {
    const [rows] = await this.pool.query<SessionRow[]>(
      "SELECT * FROM study_sessions WHERE user_id = ? AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    return rows[0] ? mapSessionRow(rows[0]) : null;
  }

  async getSession(sessionId: string) {
    const [rows] = await this.pool.query<SessionRow[]>("SELECT * FROM study_sessions WHERE id = ? LIMIT 1", [sessionId]);
    return rows[0] ? mapSessionRow(rows[0]) : null;
  }

  async saveSession(session: StudySession) {
    await this.pool.execute(
      `INSERT INTO study_sessions
        (id, user_id, status, started_at, ended_at, current_pause_started_at, pause_segments_json, duration_minutes, summary, subject, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        ended_at = VALUES(ended_at),
        current_pause_started_at = VALUES(current_pause_started_at),
        pause_segments_json = VALUES(pause_segments_json),
        duration_minutes = VALUES(duration_minutes),
        summary = VALUES(summary),
        subject = VALUES(subject),
        tags_json = VALUES(tags_json),
        updated_at = VALUES(updated_at)`,
      [
        session.id,
        session.userId,
        session.status,
        toMySqlDateTime(session.startedAt),
        toMySqlDateTime(session.endedAt),
        toMySqlDateTime(session.currentPauseStartedAt),
        JSON.stringify(session.pauseSegments),
        session.durationMinutes,
        session.summary,
        session.subject,
        JSON.stringify(session.tags),
        toMySqlDateTime(session.createdAt),
        toMySqlDateTime(session.updatedAt)
      ]
    );
    return session;
  }

  async listSessions(userId: string) {
    const [rows] = await this.pool.query<SessionRow[]>(
      "SELECT * FROM study_sessions WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    return rows.map(mapSessionRow);
  }

  async savePhotos(sessionId: string, photos: SessionPhoto[]) {
    await this.pool.execute("DELETE FROM session_photos WHERE session_id = ?", [sessionId]);
    if (!photos.length) return;
    await this.pool.query(
      "INSERT INTO session_photos (id, session_id, file_id, object_key, sort_order, created_at) VALUES ?",
      [
        photos.map((photo) => [
          photo.id,
          photo.sessionId,
          photo.fileId,
          photo.objectKey,
          photo.sortOrder,
          toMySqlDateTime(photo.createdAt)
        ])
      ]
    );
  }

  async getPhotosBySessionId(sessionId: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT id, session_id, file_id, object_key, sort_order, created_at FROM session_photos WHERE session_id = ? ORDER BY sort_order ASC",
      [sessionId]
    );
    return rows.map(mapPhotoRow);
  }

  async getPhotosBySessionIds(sessionIds: string[]) {
    if (!sessionIds.length) return [];
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, session_id, file_id, object_key, sort_order, created_at
       FROM session_photos
       WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})
       ORDER BY created_at DESC, sort_order ASC`,
      sessionIds
    );
    return rows.map(mapPhotoRow);
  }

  async replaceDailyStats(userId: string, dailyStats: Map<string, DailyStat>) {
    await this.pool.execute("DELETE FROM daily_stats WHERE user_id = ?", [userId]);
    const values = [...dailyStats.values()];
    if (!values.length) return;
    await this.pool.query(
      "INSERT INTO daily_stats (user_id, stat_date, total_minutes, session_count, heat_level, streak_snapshot, updated_at) VALUES ?",
      [
        values.map((stat) => [
          stat.userId,
          stat.date,
          stat.totalMinutes,
          stat.sessionCount,
          stat.heatLevel,
          stat.streakDays,
          toMySqlDateTime(stat.updatedAt)
        ])
      ]
    );
  }

  async getDailyStats(userId: string) {
    const [rows] = await this.pool.query<DailyStatRow[]>(
      "SELECT user_id, stat_date, total_minutes, session_count, heat_level, streak_snapshot, updated_at FROM daily_stats WHERE user_id = ? ORDER BY stat_date ASC",
      [userId]
    );
    return new Map(rows.map((row) => [row.stat_date, mapDailyStatRow(row)]));
  }

  async saveQuoteSources(sources: QuoteSource[]) {
    if (!sources.length) return;
    await this.pool.query(
      `INSERT INTO quote_sources
        (id, name, base_url, fetch_type, is_active, last_fetched_at, created_at, updated_at)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        base_url = VALUES(base_url),
        fetch_type = VALUES(fetch_type),
        is_active = VALUES(is_active),
        last_fetched_at = VALUES(last_fetched_at),
        updated_at = VALUES(updated_at)`,
      [
        sources.map((source) => [
          source.id,
          source.name,
          source.baseUrl,
          source.fetchType,
          source.isActive ? 1 : 0,
          toMySqlDateTime(source.lastFetchedAt),
          toMySqlDateTime(source.createdAt),
          toMySqlDateTime(source.updatedAt)
        ])
      ]
    );
  }

  async getActiveQuoteSources() {
    const [rows] = await this.pool.query<QuoteSourceRow[]>(
      "SELECT id, name, base_url, fetch_type, is_active, last_fetched_at, created_at, updated_at FROM quote_sources WHERE is_active = 1 ORDER BY name ASC"
    );
    return rows.map(mapQuoteSourceRow);
  }

  async saveQuotes(quotes: Quote[]) {
    if (!quotes.length) return;
    await this.pool.query(
      `INSERT INTO quotes
        (id, quote_en, quote_zh, author, topic, source_id, source_url, raw_title, fingerprint, quality_score, is_active, created_at, updated_at)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        quote_en = VALUES(quote_en),
        quote_zh = VALUES(quote_zh),
        author = VALUES(author),
        topic = VALUES(topic),
        source_id = VALUES(source_id),
        source_url = VALUES(source_url),
        raw_title = VALUES(raw_title),
        fingerprint = VALUES(fingerprint),
        quality_score = VALUES(quality_score),
        is_active = VALUES(is_active),
        updated_at = VALUES(updated_at)`,
      [
        quotes.map((quote) => [
          quote.id,
          quote.quoteEn,
          quote.quoteZh,
          quote.author,
          quote.topic,
          quote.sourceId,
          quote.sourceUrl,
          quote.rawTitle,
          quote.fingerprint,
          quote.qualityScore,
          quote.isActive ? 1 : 0,
          toMySqlDateTime(quote.createdAt),
          toMySqlDateTime(quote.updatedAt)
        ])
      ]
    );
  }

  async getActiveQuotes() {
    const [rows] = await this.pool.query<QuoteRow[]>(
      `SELECT
        id,
        quote_en,
        quote_zh,
        author,
        topic,
        source_id,
        source_url,
        raw_title,
        fingerprint,
        quality_score,
        is_active,
        created_at,
        updated_at
      FROM quotes
      WHERE is_active = 1
      ORDER BY quality_score DESC, updated_at DESC, id ASC`
    );
    return rows.map(mapQuoteRow);
  }

  async getQuotesByIds(quoteIds: string[]) {
    if (!quoteIds.length) return [];
    const [rows] = await this.pool.query<QuoteRow[]>(
      `SELECT
        id,
        quote_en,
        quote_zh,
        author,
        topic,
        source_id,
        source_url,
        raw_title,
        fingerprint,
        quality_score,
        is_active,
        created_at,
        updated_at
      FROM quotes
      WHERE id IN (${quoteIds.map(() => "?").join(", ")})`,
      quoteIds
    );
    const byId = new Map(rows.map((row) => [row.id, mapQuoteRow(row)]));
    return quoteIds.map((quoteId) => byId.get(quoteId)).filter((quote): quote is Quote => Boolean(quote));
  }

  async replaceUserDailyQuotes(userId: string, quoteDate: string, quotes: UserDailyQuote[]) {
    await this.pool.execute("DELETE FROM user_daily_quotes WHERE user_id = ? AND quote_date = ?", [userId, quoteDate]);
    if (!quotes.length) return;
    await this.pool.query(
      "INSERT INTO user_daily_quotes (user_id, quote_date, slot, quote_id, created_at) VALUES ?",
      [
        quotes.map((quote) => [quote.userId, quote.quoteDate, quote.slot, quote.quoteId, toMySqlDateTime(quote.createdAt)])
      ]
    );
  }

  async getUserDailyQuotes(userId: string, quoteDate: string) {
    const [rows] = await this.pool.query<UserDailyQuoteRow[]>(
      "SELECT user_id, quote_date, slot, quote_id, created_at FROM user_daily_quotes WHERE user_id = ? AND quote_date = ? ORDER BY slot ASC",
      [userId, quoteDate]
    );
    return rows.map(mapUserDailyQuoteRow);
  }

  async getUserDailyQuoteState(userId: string, quoteDate: string) {
    const [rows] = await this.pool.query<UserDailyQuoteStateRow[]>(
      "SELECT user_id, quote_date, visit_count, created_at, updated_at FROM user_daily_quote_state WHERE user_id = ? AND quote_date = ? LIMIT 1",
      [userId, quoteDate]
    );
    return rows[0] ? mapUserDailyQuoteStateRow(rows[0]) : null;
  }

  async saveUserDailyQuoteState(state: UserDailyQuoteState) {
    await this.pool.execute(
      `INSERT INTO user_daily_quote_state (user_id, quote_date, visit_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        visit_count = VALUES(visit_count),
        updated_at = VALUES(updated_at)`,
      [
        state.userId,
        state.quoteDate,
        state.visitCount,
        toMySqlDateTime(state.createdAt),
        toMySqlDateTime(state.updatedAt)
      ]
    );
  }

  private async getUserByOpenid(openid: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users WHERE openid = ? LIMIT 1", [openid]);
    return rows[0] ? mapUserRow(rows[0]) : null;
  }
}

function mapUserRow(row: RowDataPacket): User {
  return {
    id: String(row.id),
    openid: String(row.openid),
    nickname: String(row.nickname),
    avatarUrl: String(row.avatar_url),
    profileCompleted: Boolean(row.profile_completed),
    createdAt: fromMySqlDateTime(row.created_at) ?? "",
    lastLoginAt: fromMySqlDateTime(row.last_login_at) ?? ""
  };
}

function mapSessionRow(row: SessionRow): StudySession {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    startedAt: fromMySqlDateTime(row.started_at) ?? "",
    endedAt: fromMySqlDateTime(row.ended_at),
    currentPauseStartedAt: fromMySqlDateTime(row.current_pause_started_at),
    pauseSegments: row.pause_segments_json ? JSON.parse(row.pause_segments_json) : [],
    durationMinutes: row.duration_minutes,
    summary: row.summary,
    subject: (row.subject as StudySession["subject"]) ?? null,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    createdAt: fromMySqlDateTime(row.created_at) ?? "",
    updatedAt: fromMySqlDateTime(row.updated_at) ?? ""
  };
}

function mapPhotoRow(row: RowDataPacket): SessionPhoto {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    fileId: String(row.file_id),
    objectKey: String(row.object_key),
    sortOrder: Number(row.sort_order),
    createdAt: fromMySqlDateTime(row.created_at) ?? ""
  };
}

function mapDailyStatRow(row: DailyStatRow): DailyStat {
  return {
    userId: row.user_id,
    date: row.stat_date,
    totalMinutes: row.total_minutes,
    sessionCount: row.session_count,
    heatLevel: row.heat_level,
    streakDays: row.streak_snapshot,
    updatedAt: fromMySqlDateTime(row.updated_at) ?? ""
  };
}

function mapQuoteSourceRow(row: QuoteSourceRow): QuoteSource {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    fetchType: row.fetch_type,
    isActive: Boolean(row.is_active),
    lastFetchedAt: fromMySqlDateTime(row.last_fetched_at),
    createdAt: fromMySqlDateTime(row.created_at) ?? "",
    updatedAt: fromMySqlDateTime(row.updated_at) ?? ""
  };
}

function mapQuoteRow(row: QuoteRow): Quote {
  return {
    id: row.id,
    quoteEn: row.quote_en,
    quoteZh: row.quote_zh,
    author: row.author,
    topic: row.topic,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    rawTitle: row.raw_title,
    fingerprint: row.fingerprint,
    qualityScore: row.quality_score,
    isActive: Boolean(row.is_active),
    createdAt: fromMySqlDateTime(row.created_at) ?? "",
    updatedAt: fromMySqlDateTime(row.updated_at) ?? ""
  };
}

function mapUserDailyQuoteRow(row: UserDailyQuoteRow): UserDailyQuote {
  return {
    userId: row.user_id,
    quoteDate: row.quote_date,
    slot: row.slot,
    quoteId: row.quote_id,
    createdAt: fromMySqlDateTime(row.created_at) ?? ""
  };
}

function mapUserDailyQuoteStateRow(row: UserDailyQuoteStateRow): UserDailyQuoteState {
  return {
    userId: row.user_id,
    quoteDate: row.quote_date,
    visitCount: row.visit_count,
    createdAt: fromMySqlDateTime(row.created_at) ?? "",
    updatedAt: fromMySqlDateTime(row.updated_at) ?? ""
  };
}

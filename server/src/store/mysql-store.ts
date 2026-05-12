import { randomUUID } from "node:crypto";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { formatShanghaiDate } from "../domain/date-utils";
import type {
  DailyStat,
  NewsCategory,
  NewsItem,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User,
  UserResolutionInput
} from "../types";
import type { NewsListOptions, NewsUpsertResult } from "./types";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toMySQLDateTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Connection runs with timezone: "+08:00"; emit Shanghai wall-clock to match.
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  const seconds = String(shifted.getUTCSeconds()).padStart(2, "0");
  const ms = String(shifted.getUTCMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

function toMySQLDateTimeRequired(value: string): string {
  return toMySQLDateTime(value) ?? value;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value) {
    // mysql2 with dateStrings: true returns DATETIME as "YYYY-MM-DD HH:mm:ss"
    // assumed to be in Shanghai timezone (timezone: "+08:00")
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) {
      const normalized = value.replace(" ", "T") + (value.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(value) ? "" : "+08:00");
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return value;
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

function toDateKey(value: unknown): string {
  if (value instanceof Date) {
    return formatShanghaiDate(value);
  }
  if (typeof value === "string") {
    if (value.length >= 10 && value[4] === "-") return value.slice(0, 10);
    return value;
  }
  return String(value ?? "");
}

function toNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIsoString(value);
}

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

export class MySQLStore {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string) {
    return new MySQLStore(
      createPool({
        uri: connectionString,
        connectionLimit: 10,
        namedPlaceholders: true,
        dateStrings: true,
        timezone: "+08:00"
      })
    );
  }

  /**
   * See {@link MemoryStore.ensureUser} for the full resolution semantics.
   * The MySQL implementation persists openid / client_uid into the
   * `users` row, opportunistically backfilling either column when an
   * existing user gains a new identifier.
   */
  async ensureUser(input: UserResolutionInput, now: string) {
    const openid = input.openid?.trim() || null;
    const clientUid = input.clientUid?.trim() || null;
    if (!openid && !clientUid) {
      throw new Error("UserResolutionInput requires openid or clientUid");
    }

    const nowSql = toMySQLDateTimeRequired(now);

    let existing: User | null = null;
    if (openid) {
      existing = await this.getUserByOpenid(openid);
    }
    if (!existing && clientUid) {
      existing = await this.getUserByClientUid(clientUid);
    }

    if (existing) {
      const updates: string[] = ["last_login_at = ?"];
      const params: (string | number | null)[] = [nowSql];
      const merged: User = { ...existing, lastLoginAt: now };
      if (openid && !existing.openid) {
        updates.push("openid = ?");
        params.push(openid);
        merged.openid = openid;
      }
      if (clientUid && !existing.clientUid) {
        updates.push("client_uid = ?");
        params.push(clientUid);
        merged.clientUid = clientUid;
      }
      params.push(existing.id);
      await this.pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

      const publicProfile = (await this.getPublicSettingsByUserId(existing.id))!;
      return { user: merged, publicProfile };
    }

    const id = randomUUID();
    const shareSlug = randomUUID().slice(0, 8);
    await this.pool.execute(
      "INSERT INTO users (id, openid, client_uid, nickname, avatar_url, profile_completed, admin_remark, created_at, last_login_at) VALUES (?, ?, ?, '', '', 0, '', ?, ?)",
      [id, openid, clientUid, nowSql, nowSql]
    );
    await this.pool.execute(
      "INSERT INTO user_public_settings (user_id, share_slug, is_public, require_wechat_auth) VALUES (?, ?, 0, 1)",
      [id, shareSlug]
    );
    return {
      user: {
        id,
        openid,
        clientUid,
        nickname: "",
        avatarUrl: "",
        profileCompleted: false,
        adminRemark: "",
        createdAt: now,
        lastLoginAt: now
      },
      publicProfile: {
        userId: id,
        shareSlug,
        isPublic: false,
        requireWechatAuth: true
      }
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
        u.client_uid,
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
        openid: row.openid ? String(row.openid) : null,
        clientUid: row.client_uid ? String(row.client_uid) : null,
        nickname: String(row.nickname),
        avatarUrl: String(row.avatar_url),
        profileCompleted: Boolean(row.profile_completed),
        adminRemark: String(row.admin_remark ?? ""),
        createdAt: String(row.created_at),
        lastLoginAt: String(row.last_login_at)
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
        toMySQLDateTimeRequired(session.startedAt),
        toMySQLDateTime(session.endedAt),
        toMySQLDateTime(session.currentPauseStartedAt),
        JSON.stringify(session.pauseSegments),
        session.durationMinutes,
        session.summary,
        session.subject,
        JSON.stringify(session.tags),
        toMySQLDateTimeRequired(session.createdAt),
        toMySQLDateTimeRequired(session.updatedAt)
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
          toMySQLDateTimeRequired(photo.createdAt)
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
          toMySQLDateTimeRequired(stat.updatedAt)
        ])
      ]
    );
  }

  async getDailyStats(userId: string) {
    const [rows] = await this.pool.query<DailyStatRow[]>(
      "SELECT user_id, stat_date, total_minutes, session_count, heat_level, streak_snapshot, updated_at FROM daily_stats WHERE user_id = ? ORDER BY stat_date ASC",
      [userId]
    );
    return new Map(
      rows.map((row) => {
        const stat = mapDailyStatRow(row);
        return [stat.date, stat] as const;
      })
    );
  }

  private async getUserByOpenid(openid: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users WHERE openid = ? LIMIT 1", [openid]);
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  private async getUserByClientUid(clientUid: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users WHERE client_uid = ? LIMIT 1", [clientUid]);
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async listAllUsers() {
    // Aggregate per-user metrics in a single round-trip via correlated
    // subqueries. We avoid window functions so this also runs on
    // MySQL 5.7. With proper indexes on daily_stats (user_id, stat_date)
    // and study_sessions (user_id, status, ended_at) this is O(N users)
    // index seeks.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
        u.id, u.openid, u.client_uid, u.nickname, u.avatar_url,
        u.profile_completed, u.created_at, u.last_login_at,
        (SELECT COALESCE(SUM(total_minutes), 0)
           FROM daily_stats WHERE user_id = u.id) AS total_minutes,
        (SELECT COALESCE(SUM(session_count), 0)
           FROM daily_stats WHERE user_id = u.id) AS completed_sessions,
        (SELECT COALESCE(MAX(streak_snapshot), 0)
           FROM daily_stats WHERE user_id = u.id) AS longest_streak,
        (SELECT streak_snapshot
           FROM daily_stats WHERE user_id = u.id
           ORDER BY stat_date DESC LIMIT 1) AS current_streak,
        (SELECT MAX(ended_at)
           FROM study_sessions
           WHERE user_id = u.id AND status = 'completed') AS last_session_at
      FROM users u
      ORDER BY u.last_login_at DESC`
    );
    return rows.map((row) => ({
      user: mapUserRow(row),
      totalMinutes: Number(row.total_minutes ?? 0),
      completedSessions: Number(row.completed_sessions ?? 0),
      currentStreakDays: Number(row.current_streak ?? 0),
      longestStreakDays: Number(row.longest_streak ?? 0),
      lastSessionAt: row.last_session_at ? toIsoString(row.last_session_at) : null
    }));
  }

  async getUserById(userId: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0] ? mapUserRow(rows[0]) : null;
  }

  async setAdminRemark(userId: string, remark: string) {
    const [result] = await this.pool.execute(
      "UPDATE users SET admin_remark = ? WHERE id = ?",
      [remark, userId]
    );
    if ((result as { affectedRows?: number }).affectedRows === 0) return null;
    return this.getUserById(userId);
  }

  // ----------------------------------------------------------------
  // News module
  // ----------------------------------------------------------------

  async listNews(options: NewsListOptions = {}) {
    return this.runNewsQuery({ ...options, includeHidden: options.includeHidden ?? false });
  }

  async listNewsForAdmin(options: NewsListOptions = {}) {
    return this.runNewsQuery({ ...options, includeHidden: options.includeHidden ?? true });
  }

  private async runNewsQuery(options: NewsListOptions): Promise<NewsItem[]> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!options.includeHidden) where.push("hidden = 0");
    if (options.category && options.category !== "all") {
      where.push("category = ?");
      params.push(options.category);
    }
    if (options.before) {
      where.push("published_at < ?");
      params.push(toMySQLDateTimeRequired(options.before));
    }
    const sql =
      `SELECT id, source, category, title, summary, content, url,
              published_at, fetched_at, hidden, manual, pinned
         FROM news_items
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY pinned DESC, published_at DESC, id DESC
        LIMIT ?`;
    params.push(limit);
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
    return rows.map(mapNewsRow);
  }

  async getNewsById(id: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, source, category, title, summary, content, url,
              published_at, fetched_at, hidden, manual, pinned
         FROM news_items WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? mapNewsRow(rows[0]) : null;
  }

  async upsertNewsBatch(items: NewsItem[]): Promise<NewsUpsertResult> {
    if (!items.length) return { inserted: 0, updated: 0 };
    let inserted = 0;
    let updated = 0;
    // We use INSERT ... ON DUPLICATE KEY UPDATE so the (source, url)
    // UNIQUE index drives the merge. Manual rows are preserved by
    // filtering out any incoming item whose existing row has manual=1.
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        const [existingRows] = await conn.query<RowDataPacket[]>(
          "SELECT id, hidden, manual, pinned FROM news_items WHERE source = ? AND url = ? LIMIT 1",
          [item.source, item.url]
        );
        const existing = existingRows[0];
        if (existing?.manual) {
          // Admin-curated: refuse to clobber.
          continue;
        }
        const preservedHidden = existing ? Boolean(existing.hidden) : item.hidden;
        const preservedPinned = existing ? Boolean(existing.pinned) : item.pinned;
        if (existing) {
          await conn.execute(
            `UPDATE news_items
                SET category = ?, title = ?, summary = ?, content = ?,
                    published_at = ?, fetched_at = ?, hidden = ?, pinned = ?
              WHERE id = ?`,
            [
              item.category,
              item.title,
              item.summary,
              item.content,
              toMySQLDateTimeRequired(item.publishedAt),
              toMySQLDateTimeRequired(item.fetchedAt),
              preservedHidden ? 1 : 0,
              preservedPinned ? 1 : 0,
              String(existing.id)
            ]
          );
          updated += 1;
        } else {
          await conn.execute(
            `INSERT INTO news_items
              (id, source, category, title, summary, content, url,
               published_at, fetched_at, hidden, manual, pinned)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
            [
              item.id,
              item.source,
              item.category,
              item.title,
              item.summary,
              item.content,
              item.url,
              toMySQLDateTimeRequired(item.publishedAt),
              toMySQLDateTimeRequired(item.fetchedAt),
              item.pinned ? 1 : 0
            ]
          );
          inserted += 1;
        }
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    return { inserted, updated };
  }

  async putNewsManual(item: NewsItem) {
    await this.pool.execute(
      `INSERT INTO news_items
        (id, source, category, title, summary, content, url,
         published_at, fetched_at, hidden, manual, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         category = VALUES(category),
         title = VALUES(title),
         summary = VALUES(summary),
         content = VALUES(content),
         published_at = VALUES(published_at),
         fetched_at = VALUES(fetched_at),
         hidden = VALUES(hidden),
         pinned = VALUES(pinned),
         manual = 1`,
      [
        item.id,
        item.source,
        item.category,
        item.title,
        item.summary,
        item.content,
        item.url,
        toMySQLDateTimeRequired(item.publishedAt),
        toMySQLDateTimeRequired(item.fetchedAt),
        item.hidden ? 1 : 0,
        item.pinned ? 1 : 0
      ]
    );
    return { ...item, manual: true };
  }

  async setNewsHidden(id: string, hidden: boolean) {
    const [result] = await this.pool.execute(
      "UPDATE news_items SET hidden = ? WHERE id = ?",
      [hidden ? 1 : 0, id]
    );
    if ((result as { affectedRows?: number }).affectedRows === 0) return null;
    return this.getNewsById(id);
  }

  async deleteNewsById(id: string) {
    const [result] = await this.pool.execute("DELETE FROM news_items WHERE id = ?", [id]);
    return ((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async listRecentCompletedSessions(limit: number) {
    const safeLimit = Math.max(0, Math.min(limit | 0, 200));
    if (safeLimit === 0) return [];
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
        s.id, s.user_id, s.status, s.started_at, s.ended_at,
        s.current_pause_started_at, s.pause_segments_json,
        s.duration_minutes, s.summary, s.subject, s.tags_json,
        s.created_at, s.updated_at,
        u.nickname AS u_nickname,
        u.avatar_url AS u_avatar,
        u.openid AS u_openid,
        u.client_uid AS u_client_uid
      FROM study_sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.status = 'completed' AND s.ended_at IS NOT NULL
      ORDER BY s.ended_at DESC
      LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => {
      const session = mapSessionRow(row as SessionRow);
      return {
        session,
        user: {
          id: session.userId,
          nickname: row.u_nickname ? String(row.u_nickname) : "",
          avatarUrl: row.u_avatar ? String(row.u_avatar) : "",
          openid: row.u_openid ? String(row.u_openid) : null,
          clientUid: row.u_client_uid ? String(row.u_client_uid) : null
        }
      };
    });
  }
}

function mapUserRow(row: RowDataPacket): User {
  return {
    id: String(row.id),
    openid: row.openid ? String(row.openid) : null,
    clientUid: row.client_uid ? String(row.client_uid) : null,
    nickname: String(row.nickname ?? ""),
    avatarUrl: String(row.avatar_url ?? ""),
    profileCompleted: Boolean(row.profile_completed),
    adminRemark: String(row.admin_remark ?? ""),
    createdAt: toIsoString(row.created_at),
    lastLoginAt: toIsoString(row.last_login_at)
  };
}

function mapSessionRow(row: SessionRow): StudySession {
  const pauseSegments = row.pause_segments_json
    ? typeof row.pause_segments_json === "string"
      ? JSON.parse(row.pause_segments_json)
      : (row.pause_segments_json as unknown as StudySession["pauseSegments"])
    : [];
  const tags = row.tags_json
    ? typeof row.tags_json === "string"
      ? JSON.parse(row.tags_json)
      : (row.tags_json as unknown as StudySession["tags"])
    : [];
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: row.status,
    startedAt: toIsoString(row.started_at),
    endedAt: toNullableIsoString(row.ended_at),
    currentPauseStartedAt: toNullableIsoString(row.current_pause_started_at),
    pauseSegments,
    durationMinutes: Number(row.duration_minutes ?? 0),
    summary: String(row.summary ?? ""),
    subject: (row.subject as StudySession["subject"]) ?? null,
    tags,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapPhotoRow(row: RowDataPacket): SessionPhoto {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    fileId: String(row.file_id),
    objectKey: String(row.object_key),
    sortOrder: Number(row.sort_order),
    createdAt: toIsoString(row.created_at)
  };
}

function mapNewsRow(row: RowDataPacket): NewsItem {
  return {
    id: String(row.id),
    source: String(row.source),
    category: String(row.category) as NewsCategory,
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    content: row.content === null || row.content === undefined ? null : String(row.content),
    url: String(row.url ?? ""),
    publishedAt: toIsoString(row.published_at),
    fetchedAt: toIsoString(row.fetched_at),
    hidden: Boolean(row.hidden),
    manual: Boolean(row.manual),
    pinned: Boolean(row.pinned)
  };
}

function mapDailyStatRow(row: DailyStatRow): DailyStat {
  return {
    userId: String(row.user_id),
    date: toDateKey(row.stat_date),
    totalMinutes: Number(row.total_minutes ?? 0),
    sessionCount: Number(row.session_count ?? 0),
    heatLevel: Number(row.heat_level ?? 0),
    streakDays: Number(row.streak_snapshot ?? 0),
    updatedAt: toIsoString(row.updated_at)
  };
}

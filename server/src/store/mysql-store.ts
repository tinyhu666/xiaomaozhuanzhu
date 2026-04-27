import { randomUUID } from "node:crypto";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { formatShanghaiDate } from "../domain/date-utils";
import type {
  DailyStat,
  PublicProfileSettings,
  SessionPhoto,
  StudySession,
  User
} from "../types";

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

  async ensureUser(openid: string, now: string) {
    const user = await this.getUserByOpenid(openid);
    if (user) {
      await this.pool.execute("UPDATE users SET last_login_at = ? WHERE id = ?", [now, user.id]);
      const publicProfile = (await this.getPublicSettingsByUserId(user.id))!;
      return {
        user: {
          ...user,
          lastLoginAt: now
        },
        publicProfile
      };
    }

    const id = randomUUID();
    const shareSlug = randomUUID().slice(0, 8);
    await this.pool.execute(
      "INSERT INTO users (id, openid, nickname, avatar_url, profile_completed, created_at, last_login_at) VALUES (?, ?, '', '', 0, ?, ?)",
      [id, openid, now, now]
    );
    await this.pool.execute(
      "INSERT INTO user_public_settings (user_id, share_slug, is_public, require_wechat_auth) VALUES (?, ?, 0, 1)",
      [id, shareSlug]
    );
    return {
      user: {
        id,
        openid,
        nickname: "",
        avatarUrl: "",
        profileCompleted: false,
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
        session.startedAt,
        session.endedAt,
        session.currentPauseStartedAt,
        JSON.stringify(session.pauseSegments),
        session.durationMinutes,
        session.summary,
        session.subject,
        JSON.stringify(session.tags),
        session.createdAt,
        session.updatedAt
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
          photo.createdAt
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
          stat.updatedAt
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
}

function mapUserRow(row: RowDataPacket): User {
  return {
    id: String(row.id),
    openid: String(row.openid),
    nickname: String(row.nickname ?? ""),
    avatarUrl: String(row.avatar_url ?? ""),
    profileCompleted: Boolean(row.profile_completed),
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

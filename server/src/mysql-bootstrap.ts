import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";

type EnvMap = Partial<Record<string, string | undefined>>;

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    openid VARCHAR(128) NULL UNIQUE,
    client_uid VARCHAR(64) NULL UNIQUE,
    nickname VARCHAR(20) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    profile_completed TINYINT(1) NOT NULL DEFAULT 0,
    admin_remark VARCHAR(60) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL,
    last_login_at DATETIME(3) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_public_settings (
    user_id VARCHAR(36) PRIMARY KEY,
    share_slug VARCHAR(32) NOT NULL UNIQUE,
    is_public TINYINT(1) NOT NULL DEFAULT 0,
    require_wechat_auth TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT fk_public_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS study_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    status VARCHAR(16) NOT NULL,
    mode VARCHAR(16) NOT NULL DEFAULT 'free',
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    current_pause_started_at DATETIME(3) NULL,
    pause_segments_json JSON NULL,
    duration_minutes INT NOT NULL DEFAULT 0,
    pomodoro_cycles INT NOT NULL DEFAULT 0,
    summary VARCHAR(80) NOT NULL DEFAULT '',
    subject VARCHAR(16) NULL,
    tags_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_sessions_user_created (user_id, created_at DESC),
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS session_photos (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    file_id VARCHAR(512) NOT NULL,
    object_key VARCHAR(512) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    KEY idx_photos_session_sort (session_id, sort_order ASC),
    CONSTRAINT fk_photo_session FOREIGN KEY (session_id) REFERENCES study_sessions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
    user_id VARCHAR(36) NOT NULL,
    stat_date DATE NOT NULL,
    total_minutes INT NOT NULL DEFAULT 0,
    session_count INT NOT NULL DEFAULT 0,
    heat_level INT NOT NULL DEFAULT 0,
    streak_snapshot INT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, stat_date),
    KEY idx_daily_stats_user_date (user_id, stat_date DESC),
    CONSTRAINT fk_daily_stat_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  // AI-generated practice questions + the user's attempts. One row
  // per question per attempt — a re-attempted question creates a new
  // row so we can see the user's progress curve over time. The
  // `is_mastered` column lets the user (or future spaced-repetition
  // logic) hide questions they've truly internalised.
  //
  // We store the full question, the user's chosen answer, the
  // correct answer, and the AI's explanation. That makes the
  // 错题本 list view a simple SELECT — no need to round-trip back
  // to DeepSeek when the user reopens an old mistake.
  `CREATE TABLE IF NOT EXISTS practice_questions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    subject VARCHAR(16) NOT NULL,
    difficulty VARCHAR(16) NOT NULL,
    question TEXT NOT NULL,
    options_json JSON NOT NULL,
    correct_answer VARCHAR(8) NOT NULL,
    user_answer VARCHAR(8) NULL,
    ai_explanation MEDIUMTEXT NULL,
    is_correct TINYINT(1) NULL,
    is_mastered TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    answered_at DATETIME(3) NULL,
    KEY idx_practice_user_created (user_id, created_at DESC),
    KEY idx_practice_user_mistakes (user_id, is_correct, is_mastered, created_at DESC),
    CONSTRAINT fk_practice_user FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  // Exam-related news / announcements / syllabi. Populated by an
  // asynchronous fetcher (server/src/domain/news.ts) and surfaced in
  // the miniprogram's 「动态」 tab. `manual = 1` rows are admin-curated
  // and never overwritten by the fetcher; `hidden = 1` rows are
  // soft-deleted (kept for audit, hidden from the user-facing list).
  `CREATE TABLE IF NOT EXISTS news_items (
    id VARCHAR(64) PRIMARY KEY,
    source VARCHAR(32) NOT NULL,
    category VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary VARCHAR(1024) NOT NULL DEFAULT '',
    content MEDIUMTEXT NULL,
    url VARCHAR(255) NOT NULL,
    published_at DATETIME(3) NOT NULL,
    fetched_at DATETIME(3) NOT NULL,
    hidden TINYINT(1) NOT NULL DEFAULT 0,
    manual TINYINT(1) NOT NULL DEFAULT 0,
    pinned TINYINT(1) NOT NULL DEFAULT 0,
    KEY idx_news_pin_pub (hidden, pinned DESC, published_at DESC),
    KEY idx_news_category_published (category, hidden, published_at DESC),
    UNIQUE KEY uk_source_url (source, url)
  )`
] as const;

export function parseMysqlAddress(address: string) {
  const value = address.trim();
  if (!value) {
    return null;
  }

  const [host, rawPort] = value.split(":");
  if (!host) {
    return null;
  }

  const port = rawPort ? Number(rawPort) : 3306;
  return {
    host,
    port: Number.isFinite(port) ? port : 3306
  };
}

export function buildBootstrapPlan(env: EnvMap = process.env) {
  const address = parseMysqlAddress(env.MYSQL_ADDRESS ?? "");
  const username = env.MYSQL_USERNAME?.trim();
  const password = env.MYSQL_PASSWORD;
  const databaseName = env.MYSQL_DATABASE?.trim();

  if (!address || !username || password === undefined || !databaseName) {
    return null;
  }

  return {
    adminConfig: {
      host: address.host,
      port: address.port,
      user: username,
      password
    },
    databaseName
  };
}

export async function ensureMySqlSchema(env: EnvMap = process.env) {
  const plan = buildBootstrapPlan(env);
  if (!plan) {
    return false;
  }

  const connection = await createConnection(plan.adminConfig);
  const databaseId = escapeIdentifier(plan.databaseName);

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${databaseId} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE ${databaseId}`);
    for (const statement of TABLE_STATEMENTS) {
      await connection.query(statement);
    }
    await migrateUsersIdentitySchema(connection, plan.databaseName);
    await migrateNewsItemsSchema(connection, plan.databaseName);
    await migrateSessionsModeSchema(connection, plan.databaseName);
  } finally {
    await connection.end();
  }

  return true;
}

/**
 * In-place migration to bring older deployments up to the v0.4.9 identity
 * model. We:
 *   1. Add `client_uid` column (anonymous identifier from miniprogram).
 *   2. Drop the NOT NULL constraint on `openid` so anonymous users can
 *      exist before WeChat ever issues an openid for them.
 * Both steps are idempotent and safe to re-run.
 */
async function migrateUsersIdentitySchema(connection: Connection, dbName: string) {
  const [columns] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
    [dbName]
  );
  const columnMap = new Map(
    columns.map((row) => [String(row.COLUMN_NAME), String(row.IS_NULLABLE).toUpperCase()])
  );

  if (!columnMap.has("client_uid")) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN client_uid VARCHAR(64) NULL AFTER openid"
    );
    // Add a unique index separately so the ADD COLUMN doesn't fail on
    // pre-existing duplicate NULLs (NULLs are allowed under MySQL UNIQUE).
    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_users_client_uid'
        LIMIT 1`,
      [dbName]
    );
    if (!existing.length) {
      await connection.query(
        "ALTER TABLE users ADD UNIQUE KEY uk_users_client_uid (client_uid)"
      );
    }
  }

  if (columnMap.get("openid") === "NO") {
    await connection.query("ALTER TABLE users MODIFY COLUMN openid VARCHAR(128) NULL");
  }

  if (!columnMap.has("admin_remark")) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN admin_remark VARCHAR(60) NOT NULL DEFAULT '' AFTER profile_completed"
    );
  }
}

/**
 * v0.9.0 → v0.9.1 migration: news_items gained a `pinned` flag so
 * authoritative items (官方公告) can sort to the top regardless of date.
 * Safe to re-run.
 */
async function migrateNewsItemsSchema(connection: Connection, dbName: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'news_items'`,
    [dbName]
  );
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  if (columns.size === 0) return; // table doesn't exist yet → CREATE handles it.

  if (!columns.has("pinned")) {
    await connection.query(
      "ALTER TABLE news_items ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER manual"
    );
  }

  const [indexes] = await connection.query<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'news_items' AND INDEX_NAME = 'idx_news_pin_pub'
      LIMIT 1`,
    [dbName]
  );
  if (!indexes.length) {
    await connection.query(
      "ALTER TABLE news_items ADD KEY idx_news_pin_pub (hidden, pinned DESC, published_at DESC)"
    );
  }
}

/**
 * v0.9 → v0.10 migration: study_sessions gained a `mode`
 * ('free' | 'pomodoro') and a `pomodoro_cycles` counter so a single
 * session can record how many 25-min cycles were completed. Both
 * default to neutral values that make old rows look like ordinary
 * free-timer sessions, so no historical interpretation breaks.
 * Safe to re-run.
 */
async function migrateSessionsModeSchema(connection: Connection, dbName: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'study_sessions'`,
    [dbName]
  );
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  if (columns.size === 0) return; // table doesn't exist yet — CREATE handles it.

  if (!columns.has("mode")) {
    await connection.query(
      "ALTER TABLE study_sessions ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'free' AFTER status"
    );
  }
  if (!columns.has("pomodoro_cycles")) {
    await connection.query(
      "ALTER TABLE study_sessions ADD COLUMN pomodoro_cycles INT NOT NULL DEFAULT 0 AFTER duration_minutes"
    );
  }
}

function escapeIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

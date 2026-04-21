import { createConnection } from "mysql2/promise";

type EnvMap = Partial<Record<string, string | undefined>>;

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    openid VARCHAR(128) NOT NULL UNIQUE,
    nickname VARCHAR(20) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    profile_completed TINYINT(1) NOT NULL DEFAULT 0,
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
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    current_pause_started_at DATETIME(3) NULL,
    pause_segments_json JSON NULL,
    duration_minutes INT NOT NULL DEFAULT 0,
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
  `CREATE TABLE IF NOT EXISTS quote_sources (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    base_url VARCHAR(512) NOT NULL,
    fetch_type VARCHAR(32) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_fetched_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_quote_sources_active (is_active, updated_at DESC)
  )`,
  `CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR(64) PRIMARY KEY,
    quote_en VARCHAR(255) NOT NULL,
    quote_zh VARCHAR(255) NOT NULL,
    author VARCHAR(128) NOT NULL DEFAULT '',
    topic VARCHAR(64) NOT NULL DEFAULT '',
    source_id VARCHAR(64) NOT NULL,
    source_url VARCHAR(512) NOT NULL,
    raw_title VARCHAR(255) NOT NULL DEFAULT '',
    fingerprint VARCHAR(128) NOT NULL,
    quality_score INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_quotes_fingerprint (fingerprint),
    KEY idx_quotes_active_score (is_active, quality_score DESC, updated_at DESC),
    CONSTRAINT fk_quote_source FOREIGN KEY (source_id) REFERENCES quote_sources(id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_daily_quotes (
    user_id VARCHAR(36) NOT NULL,
    quote_date DATE NOT NULL,
    slot INT NOT NULL,
    quote_id VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, quote_date, slot),
    KEY idx_user_daily_quotes_lookup (user_id, quote_date, slot),
    CONSTRAINT fk_user_daily_quote_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_user_daily_quote_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_daily_quote_state (
    user_id VARCHAR(36) NOT NULL,
    quote_date DATE NOT NULL,
    visit_count INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, quote_date),
    CONSTRAINT fk_user_daily_quote_state_user FOREIGN KEY (user_id) REFERENCES users(id)
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
  } finally {
    await connection.end();
  }

  return true;
}

function escapeIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

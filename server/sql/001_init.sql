CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  openid VARCHAR(128) NOT NULL UNIQUE,
  nickname VARCHAR(20) NOT NULL DEFAULT '',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  profile_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  last_login_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_public_settings (
  user_id VARCHAR(36) PRIMARY KEY,
  share_slug VARCHAR(32) NOT NULL UNIQUE,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  require_wechat_auth TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_public_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS study_sessions (
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
  subjects_json JSON NULL,
  tags_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_sessions_user_created (user_id, created_at DESC),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS session_photos (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  file_id VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  KEY idx_photos_session_sort (session_id, sort_order ASC),
  CONSTRAINT fk_photo_session FOREIGN KEY (session_id) REFERENCES study_sessions(id)
);

CREATE TABLE IF NOT EXISTS daily_stats (
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
);

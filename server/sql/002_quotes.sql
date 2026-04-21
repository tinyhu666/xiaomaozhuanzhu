CREATE TABLE IF NOT EXISTS quote_sources (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  fetch_type VARCHAR(32) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_fetched_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_quote_sources_active (is_active, updated_at DESC)
);

CREATE TABLE IF NOT EXISTS quotes (
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
);

CREATE TABLE IF NOT EXISTS user_daily_quotes (
  user_id VARCHAR(36) NOT NULL,
  quote_date DATE NOT NULL,
  slot INT NOT NULL,
  quote_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, quote_date, slot),
  KEY idx_user_daily_quotes_lookup (user_id, quote_date, slot),
  CONSTRAINT fk_user_daily_quote_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_daily_quote_quote FOREIGN KEY (quote_id) REFERENCES quotes(id)
);

CREATE TABLE IF NOT EXISTS user_daily_quote_state (
  user_id VARCHAR(36) NOT NULL,
  quote_date DATE NOT NULL,
  visit_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, quote_date),
  CONSTRAINT fk_user_daily_quote_state_user FOREIGN KEY (user_id) REFERENCES users(id)
);

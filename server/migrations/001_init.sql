-- MySQL 8 production schema. Run inside the target database.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  open_id VARCHAR(64) NOT NULL,
  nickname VARCHAR(100) NOT NULL DEFAULT '',
  avatar_url VARCHAR(1024) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_users_open_id (open_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS thoughts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  emotions JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_thoughts_user_status (user_id, status),
  KEY idx_thoughts_user_created (user_id, created_at),
  CONSTRAINT fk_thoughts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_thoughts_status CHECK (status IN ('active','resolved','recurring'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  thought_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  client_request_id VARCHAR(64) NULL,
  version_no INT NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  emotions JSON NULL,
  intensity INT NOT NULL,
  loop_thought VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'registered',
  step INT NOT NULL DEFAULT 0,
  rumination_type VARCHAR(100) NOT NULL DEFAULT '',
  risk_content TEXT,
  probability INT NULL,
  controllable_actions JSON NULL,
  uncontrollable_items JSON NULL,
  scenario_worst TEXT,
  scenario_likely TEXT,
  scenario_best TEXT,
  close_confirmations JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  UNIQUE KEY uk_records_thought_version (thought_id, version_no),
  UNIQUE KEY uk_records_user_client_request (user_id, client_request_id),
  KEY idx_records_user_status (user_id, status),
  KEY idx_records_user_created (user_id, created_at),
  KEY idx_records_thought_id (thought_id),
  CONSTRAINT fk_records_thought FOREIGN KEY (thought_id) REFERENCES thoughts(id) ON DELETE CASCADE,
  CONSTRAINT fk_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_records_intensity CHECK (intensity BETWEEN 1 AND 10),
  CONSTRAINT chk_records_probability CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  CONSTRAINT chk_records_step CHECK (step BETWEEN 0 AND 7),
  CONSTRAINT chk_records_status CHECK (status IN ('registered','evaluating','paused','closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

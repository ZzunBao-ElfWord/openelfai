'use strict';

// 开发者生态表：入驻信息复用 platform_developers，
// 这里只建技能本体的三张表（技能定义 / 版本 / 调试运行记录）。
const DEV_TABLES = [
  `CREATE TABLE IF NOT EXISTS dev_skill_defs (
    id            VARCHAR(40) PRIMARY KEY,
    developer_id  VARCHAR(40) NOT NULL,
    slug          VARCHAR(32) NOT NULL,
    name          VARCHAR(64) NOT NULL,
    track         VARCHAR(24) NOT NULL,
    kind          VARCHAR(16) NOT NULL DEFAULT 'skill',
    summary       VARCHAR(280) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_at    BIGINT NOT NULL,
    updated_at    BIGINT NOT NULL,
    UNIQUE KEY uk_dev_skill_slug (developer_id, slug),
    INDEX idx_dev_skill_dev (developer_id, updated_at),
    INDEX idx_dev_skill_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS dev_skill_versions (
    id           CHAR(36) PRIMARY KEY,
    skill_id     VARCHAR(40) NOT NULL,
    version      INT NOT NULL,
    manifest     LONGTEXT NOT NULL,
    source       LONGTEXT NOT NULL,
    source_hash  CHAR(64) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'draft',
    created_at   BIGINT NOT NULL,
    UNIQUE KEY uk_dev_skill_version (skill_id, version),
    INDEX idx_dev_version_skill (skill_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS dev_skill_runs (
    id           CHAR(36) PRIMARY KEY,
    skill_id     VARCHAR(40) NOT NULL,
    version_id   CHAR(36) NOT NULL,
    developer_id VARCHAR(40) NOT NULL,
    mode         VARCHAR(16) NOT NULL,
    status       VARCHAR(16) NOT NULL,
    input_json   LONGTEXT NULL,
    output_json  LONGTEXT NULL,
    error        VARCHAR(255) NULL,
    llm_calls    INT NOT NULL DEFAULT 0,
    duration_ms  INT NOT NULL DEFAULT 0,
    created_at   BIGINT NOT NULL,
    INDEX idx_dev_run_dev_time (developer_id, created_at),
    INDEX idx_dev_run_skill (skill_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

module.exports = { DEV_TABLES };

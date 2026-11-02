'use strict';

// 开发者生态表：入驻信息复用 platform_developers，
// 这里只建能力本体的表（能力定义 / 版本 / 调试运行记录 / 收益流水）。
const DEV_TABLES = [
  `CREATE TABLE IF NOT EXISTS dev_skill_defs (
    id             VARCHAR(40) PRIMARY KEY,
    developer_id   VARCHAR(40) NOT NULL,
    slug           VARCHAR(32) NOT NULL,
    name           VARCHAR(64) NOT NULL,
    track          VARCHAR(24) NOT NULL,
    kind           VARCHAR(16) NOT NULL DEFAULT 'skill',
    summary        VARCHAR(280) NOT NULL,
    price_diamonds INT NOT NULL DEFAULT 0,
    definition     LONGTEXT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'draft',
    review_note    VARCHAR(255) NULL,
    approved_at    BIGINT NULL,
    install_count  INT NOT NULL DEFAULT 0,
    sales_count    INT NOT NULL DEFAULT 0,
    call_count     INT NOT NULL DEFAULT 0,
    earnings_cents BIGINT NOT NULL DEFAULT 0,
    created_at     BIGINT NOT NULL,
    updated_at     BIGINT NOT NULL,
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

  // 开发者收益流水：与支付钱包的待结算并行记一份，用于控制台对账与提现展示。
  `CREATE TABLE IF NOT EXISTS dev_earnings (
    id             CHAR(36) PRIMARY KEY,
    developer_id   VARCHAR(40) NOT NULL,
    capability_id  VARCHAR(40) NOT NULL,
    book_id        VARCHAR(40) NOT NULL,
    buyer_id       VARCHAR(40) NOT NULL,
    gross_diamonds INT NOT NULL,
    developer_cents BIGINT NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'pending',
    settle_at      BIGINT NOT NULL,
    created_at     BIGINT NOT NULL,
    UNIQUE KEY uk_dev_earning_book (book_id),
    INDEX idx_dev_earning_dev (developer_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// 老库补列：CREATE TABLE IF NOT EXISTS 不会修改已存在的表。
const DEV_COLUMN_MIGRATIONS = {
  dev_skill_defs: [
    ['price_diamonds', 'ALTER TABLE dev_skill_defs ADD COLUMN price_diamonds INT NOT NULL DEFAULT 0'],
    ['definition', 'ALTER TABLE dev_skill_defs ADD COLUMN definition LONGTEXT NULL'],
    ['review_note', 'ALTER TABLE dev_skill_defs ADD COLUMN review_note VARCHAR(255) NULL'],
    ['approved_at', 'ALTER TABLE dev_skill_defs ADD COLUMN approved_at BIGINT NULL'],
    ['install_count', 'ALTER TABLE dev_skill_defs ADD COLUMN install_count INT NOT NULL DEFAULT 0'],
    ['sales_count', 'ALTER TABLE dev_skill_defs ADD COLUMN sales_count INT NOT NULL DEFAULT 0'],
    ['call_count', 'ALTER TABLE dev_skill_defs ADD COLUMN call_count INT NOT NULL DEFAULT 0'],
    ['earnings_cents', 'ALTER TABLE dev_skill_defs ADD COLUMN earnings_cents BIGINT NOT NULL DEFAULT 0'],
  ],
  platform_developers: [
    ['subject_type', "ALTER TABLE platform_developers ADD COLUMN subject_type VARCHAR(16) NOT NULL DEFAULT 'individual'"],
    ['org_name', 'ALTER TABLE platform_developers ADD COLUMN org_name VARCHAR(128) NULL'],
    ['org_license_no', 'ALTER TABLE platform_developers ADD COLUMN org_license_no VARCHAR(32) NULL'],
    ['org_contact', 'ALTER TABLE platform_developers ADD COLUMN org_contact VARCHAR(64) NULL'],
    ['agreement_version', 'ALTER TABLE platform_developers ADD COLUMN agreement_version VARCHAR(32) NULL'],
    ['agreement_at', 'ALTER TABLE platform_developers ADD COLUMN agreement_at BIGINT NULL'],
    ['review_note', 'ALTER TABLE platform_developers ADD COLUMN review_note VARCHAR(255) NULL'],
    ['reviewed_at', 'ALTER TABLE platform_developers ADD COLUMN reviewed_at BIGINT NULL'],
    ['updated_at', 'ALTER TABLE platform_developers ADD COLUMN updated_at BIGINT NULL'],
  ],
};

module.exports = { DEV_TABLES, DEV_COLUMN_MIGRATIONS };

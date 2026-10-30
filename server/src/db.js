'use strict';

const mysql = require('mysql2/promise');
const { PAYMENT_TABLES } = require('./payment_store');
const { PLATFORM_TABLES } = require('./platform/tables');
const { DEV_TABLES } = require('./developer/tables');
const { CHARACTER_TABLES } = require('./character/tables');
const { KNOWLEDGE_TABLES } = require('./knowledge');
const { APP_CONTENT_TABLES } = require('./app_content');
const { COMPLIANCE_TABLES } = require('./compliance');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(40) PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    nickname VARCHAR(64) NOT NULL,
    avatar_initial VARCHAR(8) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at VARCHAR(32) NOT NULL,
    last_login_at VARCHAR(32) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sms_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    consumed_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    ip VARCHAR(64) NULL,
    INDEX idx_sms_phone_created (phone, created_at),
    INDEX idx_sms_ip_created (ip, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS refresh_sessions (
    id CHAR(36) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    device_id VARCHAR(80) NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    rotated_from CHAR(36) NULL,
    revoked_at BIGINT NULL,
    last_used_at BIGINT NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS user_wallets (
    user_id VARCHAR(40) PRIMARY KEY,
    diamonds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_recharged BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at VARCHAR(32) NOT NULL,
    CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS apple_iap_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    product_id VARCHAR(120) NOT NULL,
    diamonds INT UNSIGNED NOT NULL,
    environment VARCHAR(20) NOT NULL,
    purchased_at BIGINT NULL,
    created_at VARCHAR(32) NOT NULL,
    INDEX idx_apple_iap_user (user_id),
    CONSTRAINT fk_apple_iap_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS apple_iap_sandbox_wallets (
    user_id VARCHAR(40) PRIMARY KEY,
    diamonds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_recharged BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at VARCHAR(32) NOT NULL,
    CONSTRAINT fk_sandbox_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS apple_iap_sandbox_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    product_id VARCHAR(120) NOT NULL,
    diamonds INT UNSIGNED NOT NULL,
    environment VARCHAR(20) NOT NULL,
    purchased_at BIGINT NULL,
    created_at VARCHAR(32) NOT NULL,
    INDEX idx_sandbox_iap_user (user_id),
    CONSTRAINT fk_sandbox_iap_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ...PLATFORM_TABLES,
  ...DEV_TABLES,
  ...CHARACTER_TABLES,
  ...KNOWLEDGE_TABLES,
  ...APP_CONTENT_TABLES,
  ...COMPLIANCE_TABLES,
];

// CREATE TABLE IF NOT EXISTS 不会给已存在的生产表补列，这里做幂等迁移。
const PLATFORM_API_KEY_COLUMN_MIGRATIONS = [
  ['key_cipher', 'ALTER TABLE platform_api_keys ADD COLUMN key_cipher TEXT NULL'],
  ['is_default', 'ALTER TABLE platform_api_keys ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0'],
];

// 创作者收益三档余额：老库已有 earnings_fen，补三列即可。
const WALLET_META_COLUMN_MIGRATIONS = [
  ['pending_cents', 'ALTER TABLE payment_wallet_meta ADD COLUMN pending_cents BIGINT UNSIGNED NOT NULL DEFAULT 0'],
  ['available_cents', 'ALTER TABLE payment_wallet_meta ADD COLUMN available_cents BIGINT UNSIGNED NOT NULL DEFAULT 0'],
  ['withdrawn_cents', 'ALTER TABLE payment_wallet_meta ADD COLUMN withdrawn_cents BIGINT UNSIGNED NOT NULL DEFAULT 0'],
];

async function migrateColumns(pool, table, migrations) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table],
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));

  for (const [column, statement] of migrations) {
    if (existing.has(column)) continue;
    try {
      await pool.query(statement);
    } catch (error) {
      // 多实例同时启动时，另一个实例可能已经补过列。
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

async function createPool(config) {
  const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    waitForConnections: true,
    connectionLimit: config.db.poolSize,
    queueLimit: 0,
    charset: 'utf8mb4',
    enableKeepAlive: true,
  });

  for (const statement of [...TABLES, ...PAYMENT_TABLES]) {
    await pool.query(statement);
  }

  await migrateColumns(pool, 'platform_api_keys', PLATFORM_API_KEY_COLUMN_MIGRATIONS);
  await migrateColumns(pool, 'payment_wallet_meta', WALLET_META_COLUMN_MIGRATIONS);

  return pool;
}

module.exports = { createPool };

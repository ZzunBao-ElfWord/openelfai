'use strict';

const mysql = require('mysql2/promise');

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
];

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

  for (const statement of TABLES) {
    await pool.query(statement);
  }

  return pool;
}

module.exports = { createPool };

'use strict';

const PLATFORM_TABLES = [
  `CREATE TABLE IF NOT EXISTS platform_developers (
    user_id      VARCHAR(40) PRIMARY KEY,
    real_name    VARCHAR(64) NOT NULL,
    purpose      VARCHAR(255) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    tier         VARCHAR(16) NOT NULL DEFAULT 'standard',
    created_at   BIGINT NOT NULL,
    approved_at  BIGINT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_api_keys (
    id             CHAR(36) PRIMARY KEY,
    user_id        VARCHAR(40) NOT NULL,
    name           VARCHAR(64) NOT NULL,
    key_prefix     VARCHAR(16) NOT NULL,
    key_hash       CHAR(64) NOT NULL UNIQUE,
    key_cipher     TEXT NULL,
    is_default     TINYINT(1) NOT NULL DEFAULT 0,
    allowed_models VARCHAR(512) NULL,
    monthly_budget_micro BIGINT UNSIGNED NOT NULL DEFAULT 0,
    qps_limit      INT NOT NULL DEFAULT 5,
    ip_allowlist   VARCHAR(512) NULL,
    created_at     BIGINT NOT NULL,
    last_used_at   BIGINT NULL,
    revoked_at     BIGINT NULL,
    INDEX idx_keys_user (user_id),
    CONSTRAINT fk_keys_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_wallets (
    user_id          VARCHAR(40) PRIMARY KEY,
    balance_micro    BIGINT UNSIGNED NOT NULL DEFAULT 0,
    frozen_micro     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_topup_micro BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at       BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_ledger (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id        VARCHAR(40) NOT NULL,
    key_id         CHAR(36) NULL,
    request_id     CHAR(36) NULL,
    type           VARCHAR(16) NOT NULL,
    delta_micro    BIGINT NOT NULL,
    balance_after  BIGINT UNSIGNED NOT NULL,
    note           VARCHAR(255) NULL,
    created_at     BIGINT NOT NULL,
    INDEX idx_ledger_user_time (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_topup_orders (
    id             CHAR(34) PRIMARY KEY,
    user_id        VARCHAR(40) NOT NULL,
    tier_id        VARCHAR(32) NOT NULL,
    amount_fen     BIGINT UNSIGNED NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'pending',
    app_id         VARCHAR(32) NOT NULL,
    seller_id      VARCHAR(32) NOT NULL,
    trade_no       VARCHAR(64) NULL,
    request_id     VARCHAR(100) NOT NULL,
    created_at     BIGINT NOT NULL,
    paid_at        BIGINT NULL,
    expires_at     BIGINT NOT NULL,
    UNIQUE KEY uk_topup_user_request (user_id, request_id),
    INDEX idx_topup_user_status (user_id, status, expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_model_catalog (
    model_id       VARCHAR(64) PRIMARY KEY,
    vendor         VARCHAR(64) NOT NULL,
    display_name   VARCHAR(64) NOT NULL,
    region         VARCHAR(16) NOT NULL,
    capabilities   VARCHAR(128) NOT NULL,
    context_tokens INT NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'active',
    external_only  TINYINT(1) NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_model_price (
    model_id      VARCHAR(64) NOT NULL,
    input_micro_per_1m  BIGINT UNSIGNED NOT NULL,
    output_micro_per_1m BIGINT UNSIGNED NOT NULL,
    markup_bp     INT NOT NULL DEFAULT 1150,
    effective_from BIGINT NOT NULL,
    PRIMARY KEY (model_id, effective_from)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS platform_requests (
    id              CHAR(36) NOT NULL,
    user_id         VARCHAR(40) NOT NULL,
    key_id          CHAR(36) NULL,
    source          VARCHAR(16) NOT NULL,
    requested_model VARCHAR(64) NOT NULL,
    resolved_model  VARCHAR(64) NOT NULL,
    prompt_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
    completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    cost_micro    BIGINT UNSIGNED NOT NULL DEFAULT 0,
    price_micro   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    latency_ms    INT UNSIGNED NOT NULL DEFAULT 0,
    ttft_ms       INT UNSIGNED NOT NULL DEFAULT 0,
    status        VARCHAR(16) NOT NULL,
    error_code    VARCHAR(32) NULL,
    estimated     TINYINT(1) NOT NULL DEFAULT 0,
    created_at    BIGINT NOT NULL,
    PRIMARY KEY (id, created_at),
    INDEX idx_req_model_time (resolved_model, created_at),
    INDEX idx_req_user_time (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

module.exports = { PLATFORM_TABLES };

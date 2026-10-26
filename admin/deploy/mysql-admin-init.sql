-- ============================================================================
-- OpenElf 管理后台 MySQL 初始化脚本
-- 用法（在服务器上以 root 执行一次）：
--   1) 全文替换 '<CHANGE_ME>' 为强密码（建议 32 位随机串）
--   2) mysql -u root -p < mysql-admin-init.sql
-- 注意：本脚本只创建后台自有表与最小权限账号；业务表由 Node server 自行创建。
-- ============================================================================

USE openelf;

-- 后台自有表（与 bff/internal/store/db.go 的兜底 DDL 保持一致）
CREATE TABLE IF NOT EXISTS admin_users (
  id CHAR(32) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(80) NOT NULL,
  role VARCHAR(16) NOT NULL,
  pwd_changed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id CHAR(32) PRIMARY KEY,
  actor_id VARCHAR(40) NOT NULL DEFAULT '',
  actor_name VARCHAR(64) NOT NULL DEFAULT '',
  role VARCHAR(16) NOT NULL DEFAULT '',
  method VARCHAR(8) NOT NULL,
  path VARCHAR(255) NOT NULL,
  status INT NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  ua VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_admin_audit_created (created_at),
  INDEX idx_admin_audit_actor (actor_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 最小权限账号（仅本机回源）
-- !!! 执行前务必把 '<CHANGE_ME>' 替换为强密码 !!!
-- ============================================================================
CREATE USER IF NOT EXISTS 'openelf_admin'@'127.0.0.1' IDENTIFIED BY '<CHANGE_ME>';

-- 业务库名按实际部署修改（默认 openelf）
-- 用户与状态：只读 + 仅允许改 status 列（不含 DELETE）
GRANT SELECT, UPDATE (status) ON openelf.users TO 'openelf_admin'@'127.0.0.1';
-- 会话只读（统计活跃会话数）
GRANT SELECT ON openelf.refresh_sessions TO 'openelf_admin'@'127.0.0.1';
-- 钱包：读写 + INSERT（lockWallet 需 INSERT IGNORE 兜底建行；无 DELETE）
GRANT SELECT, INSERT, UPDATE ON openelf.user_wallets TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON openelf.apple_iap_sandbox_wallets TO 'openelf_admin'@'127.0.0.1';
-- Apple 内购订单：只读
GRANT SELECT ON openelf.apple_iap_transactions TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT ON openelf.apple_iap_sandbox_transactions TO 'openelf_admin'@'127.0.0.1';
-- 支付元数据：读写（无 DELETE）
GRANT SELECT, INSERT, UPDATE ON openelf.payment_wallet_meta TO 'openelf_admin'@'127.0.0.1';
-- 支付对象：读写（无 DELETE；删帖为软删 state='deleted'）
GRANT SELECT, INSERT, UPDATE ON openelf.payment_objects TO 'openelf_admin'@'127.0.0.1';
-- 账本：只读 + 追加（严禁 UPDATE/DELETE，账不可改）
GRANT SELECT, INSERT ON openelf.payment_ledger TO 'openelf_admin'@'127.0.0.1';
-- 后台自有表：全权限
GRANT ALL PRIVILEGES ON openelf.admin_users TO 'openelf_admin'@'127.0.0.1';
GRANT ALL PRIVILEGES ON openelf.admin_audit_logs TO 'openelf_admin'@'127.0.0.1';
-- 开放平台：目录/价格/Key/钱包/账本/请求/开发者（最小权限）
GRANT SELECT, INSERT, UPDATE ON openelf.platform_model_catalog TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT, INSERT ON openelf.platform_model_price TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT, UPDATE ON openelf.platform_api_keys TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON openelf.platform_wallets TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT, INSERT ON openelf.platform_ledger TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT ON openelf.platform_requests TO 'openelf_admin'@'127.0.0.1';
GRANT SELECT ON openelf.platform_developers TO 'openelf_admin'@'127.0.0.1';

-- 上游厂商密钥：仅存 AES-256-GCM 密文，明文永不落库/不回显
CREATE TABLE IF NOT EXISTS platform_vendor_credentials (
  vendor        VARCHAR(32) PRIMARY KEY,
  env_var       VARCHAR(64) NOT NULL,
  key_cipher    TEXT NOT NULL,
  key_hint      VARCHAR(32) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  updated_by    VARCHAR(64) NOT NULL,
  last_test_at  BIGINT NULL,
  last_test_result VARCHAR(16) NULL,
  last_test_message VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
GRANT SELECT, INSERT, UPDATE ON openelf.platform_vendor_credentials TO 'openelf_admin'@'127.0.0.1';

FLUSH PRIVILEGES;

'use strict';

// 形象生产内核的表：角色卡 / 组合预占 / 配件目录 / 生成运行记录。
// 配件只是生成输入，不可换装、不可购买；形象铸造后锁定（P3 才实现铸造）。
const CHARACTER_TABLES = [
  `CREATE TABLE IF NOT EXISTS character_cards (
    id               CHAR(36) PRIMARY KEY,
    user_id          VARCHAR(40) NOT NULL,
    name             VARCHAR(64) NOT NULL,
    source           VARCHAR(16) NOT NULL DEFAULT 'text',
    style            VARCHAR(24) NOT NULL DEFAULT 'general',
    prompt           TEXT NULL,
    persona          TEXT NULL,
    fear             TEXT NULL,
    habit            TEXT NULL,
    traits           LONGTEXT NULL,
    seed             BIGINT NOT NULL DEFAULT 0,
    status           VARCHAR(16) NOT NULL DEFAULT 'draft',
    image_key        VARCHAR(128) NULL,
    thumb_key        VARCHAR(128) NULL,
    composition_hash CHAR(64) NULL,
    rarity_tier      VARCHAR(16) NULL,
    rarity_score     INT NOT NULL DEFAULT 0,
    generated_at     BIGINT NULL,
    created_at       BIGINT NOT NULL,
    updated_at       BIGINT NOT NULL,
    UNIQUE KEY uk_character_composition (composition_hash),
    INDEX idx_character_user (user_id, updated_at),
    INDEX idx_character_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 全平台唯一性预占：同一组合只能产出一份形象。
  `CREATE TABLE IF NOT EXISTS character_compositions (
    composition_hash CHAR(64) PRIMARY KEY,
    card_id          CHAR(36) NOT NULL,
    created_at       BIGINT NOT NULL,
    INDEX idx_character_comp_card (card_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 配件目录（当前代码内置目录，后台可扩展同步）。
  `CREATE TABLE IF NOT EXISTS character_parts (
    id       VARCHAR(64) PRIMARY KEY,
    slot     VARCHAR(24) NOT NULL,
    name     VARCHAR(64) NOT NULL,
    weight   INT NOT NULL DEFAULT 1,
    rarity   VARCHAR(16) NOT NULL DEFAULT 'common',
    draw     LONGTEXT NULL,
    sort     INT NOT NULL DEFAULT 0,
    status   VARCHAR(16) NOT NULL DEFAULT 'active',
    INDEX idx_character_parts_slot (slot, sort)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 运营批量生成批次：清单明细落 assets/characters/batches/<id>.json，此处只存摘要。
  `CREATE TABLE IF NOT EXISTS character_batches (
    id         CHAR(32) PRIMARY KEY,
    name       VARCHAR(64) NOT NULL,
    style      VARCHAR(24) NOT NULL,
    count      INT NOT NULL,
    seed_start BIGINT NOT NULL,
    sheet_key  VARCHAR(128) NULL,
    created_by VARCHAR(40) NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_character_batches_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS character_runs (
    id          CHAR(36) PRIMARY KEY,
    user_id     VARCHAR(40) NOT NULL,
    card_id     CHAR(36) NULL,
    action      VARCHAR(16) NOT NULL,
    status      VARCHAR(16) NOT NULL,
    cost_micro  BIGINT NOT NULL DEFAULT 0,
    duration_ms INT NOT NULL DEFAULT 0,
    error       VARCHAR(255) NULL,
    created_at  BIGINT NOT NULL,
    INDEX idx_character_run_user (user_id, created_at),
    INDEX idx_character_run_card (card_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

module.exports = { CHARACTER_TABLES };

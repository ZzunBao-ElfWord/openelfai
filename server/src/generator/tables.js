'use strict';

// 千人千面生成器：用户权重覆盖 / 批量生成明细 / 作品收单。
const GENERATOR_TABLES = [
  // 每个接入用户（按 API Key 归属）对各配件的权重覆盖；未覆盖的行用目录基础权重。
  `CREATE TABLE IF NOT EXISTS generator_weights (
    user_id    VARCHAR(40) NOT NULL,
    layer_id   VARCHAR(24) NOT NULL,
    trait_id   VARCHAR(24) NOT NULL,
    weight     INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, layer_id, trait_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 批量生成明细：图片落 worldAssetDir，此处只存文件名与特征组合。
  `CREATE TABLE IF NOT EXISTS generator_items (
    id           CHAR(36) PRIMARY KEY,
    user_id      VARCHAR(40) NOT NULL,
    batch_id     CHAR(36) NOT NULL,
    idx          INT NOT NULL,
    seed         VARCHAR(160) NOT NULL,
    traits       LONGTEXT NULL,
    rarity_score DOUBLE NOT NULL DEFAULT 0,
    rarity_tier  VARCHAR(16) NOT NULL DEFAULT 'common',
    image_key    VARCHAR(128) NULL,
    thumb_key    VARCHAR(128) NULL,
    created_at   BIGINT NOT NULL,
    UNIQUE KEY uk_generator_batch_idx (batch_id, idx),
    INDEX idx_generator_item_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 作品信息收单：payload 为统一标准 schema 的 JSON，本平台只收单存证。
  `CREATE TABLE IF NOT EXISTS generator_submissions (
    id         CHAR(36) PRIMARY KEY,
    user_id    VARCHAR(40) NOT NULL,
    payload    LONGTEXT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_generator_sub_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

module.exports = { GENERATOR_TABLES };

'use strict';

// 运营配置：App 文案 / 开关 / 法律政策文档。
//
// 写入口只在管理后台（admin BFF），此处只提供 App 用的公开只读快照。
// 除已发布文档和白名单 app.* 配置外，不向客户端暴露任何字段。

const APP_CONTENT_TABLES = [
  `CREATE TABLE IF NOT EXISTS app_configs (
    cfg_key VARCHAR(64) PRIMARY KEY,
    cfg_group VARCHAR(32) NOT NULL,
    label VARCHAR(64) NOT NULL,
    value_type VARCHAR(16) NOT NULL,
    value_text MEDIUMTEXT NOT NULL,
    remark VARCHAR(255) NOT NULL DEFAULT '',
    updated_by VARCHAR(64) NOT NULL DEFAULT '',
    updated_at BIGINT NOT NULL DEFAULT 0,
    INDEX idx_app_configs_group (cfg_group)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS app_documents (
    id CHAR(32) PRIMARY KEY,
    slug VARCHAR(32) NOT NULL,
    title VARCHAR(64) NOT NULL,
    version INT NOT NULL,
    format VARCHAR(16) NOT NULL DEFAULT 'text',
    content MEDIUMTEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    effective_at BIGINT NULL,
    published_at BIGINT NULL,
    published_by VARCHAR(64) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_app_documents_slug_version (slug, version),
    INDEX idx_app_documents_slug_status (slug, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// 只有 app.* 命名空间允许下发，避免把内部配置误发给客户端。
const PUBLIC_KEY_RE = /^app\.[a-z0-9]+(\.[a-z0-9]+)*$/;

function publicValue(valueType, raw) {
  switch (valueType) {
    case 'bool':
      return raw === 'true' || raw === '1';
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case 'json':
      try {
        return JSON.parse(raw);
      } catch (_) {
        return raw;
      }
    default:
      return raw;
  }
}

function registerAppContentRoutes(app, { db, cacheSeconds = 60 }) {
  app.get('/api/v1/app-content', async (request, reply) => {
    const [[versionRow]] = await db.query(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(updated_at) FROM app_configs), 0),
         COALESCE((SELECT MAX(updated_at) FROM app_documents WHERE status = 'published'), 0)
       ) AS version`,
    );
    const version = String(versionRow.version || 0);
    const etag = `W/"app-content-${version}"`;

    reply.header('Cache-Control', `public, max-age=${cacheSeconds}`);
    reply.header('ETag', etag);
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }

    const [docRows] = await db.query(
      `SELECT slug, title, version, COALESCE(effective_at, 0) AS effective_at, content
         FROM app_documents
        WHERE status = 'published'
        ORDER BY slug ASC, version DESC`,
    );
    const documents = {};
    for (const row of docRows) {
      // 同一 slug 只下发版本号最大的一条
      if (documents[row.slug]) continue;
      documents[row.slug] = {
        title: row.title,
        version: row.version,
        effective_at: Number(row.effective_at) || 0,
        content: row.content,
      };
    }

    const [configRows] = await db.query(
      'SELECT cfg_key, value_type, value_text FROM app_configs',
    );
    const configs = {};
    for (const row of configRows) {
      if (!PUBLIC_KEY_RE.test(row.cfg_key)) continue;
      configs[row.cfg_key] = publicValue(row.value_type, row.value_text);
    }

    return { version, documents, configs };
  });
}

module.exports = { APP_CONTENT_TABLES, registerAppContentRoutes };

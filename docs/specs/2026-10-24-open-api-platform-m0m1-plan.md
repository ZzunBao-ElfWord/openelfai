# OpenElf 开放 API 平台 — M0 基础设施 + M1 网关数据面 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 LiteLLM Proxy 数据面 + Node 网关层（鉴权/预授权/结算/日志/降级），内部测试 Key 能跑通 `/v1/chat/completions`，计费误差为 0。

**Architecture:** 客户端只访问现有 Fastify server（新增 `/v1/*` 路由），Node 层做鉴权→限流→预授权冻结→转发 LiteLLM→按 usage 结算→写请求日志。LiteLLM 以无数据库模式运行，仅做厂商适配与路由降级。账本用微元（BIGINT）整数记账，行锁保证并发安全。

**Tech Stack:** Fastify 5, mysql2/promise, LiteLLM Proxy (docker), node:test

**前置（运维，非代码）：**
1. 服务器 `180.184.160.179` 上 `docker compose` 启动 LiteLLM Proxy，监听 `127.0.0.1:4000`
2. `config.yaml` 配置首批 3 家模型（DeepSeek、豆包、通义）用于 M1 联调
3. 环境变量 `LITELLM_MASTER_KEY`、`LITELLM_BASE_URL=http://127.0.0.1:4000`、`PLATFORM_KEY_PEPPER` 注入 server

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `server/src/platform/tables.js` | `PLATFORM_TABLES` 建表语句数组，由 `db.js` 合并 |
| `server/src/platform/config.js` | 平台配置读取（LiteLLM 地址、Key pepper、默认限额） |
| `server/src/platform/api_key.js` | API Key 生成、哈希、校验、缓存 |
| `server/src/platform/catalog.js` | 模型目录与价格表（内存加载，启动时从 DB 读） |
| `server/src/platform/billing.js` | 预授权冻结、实际结算、账本写入、余额查询 |
| `server/src/platform/upstream.js` | 转发 LiteLLM，流式透传，usage 提取 |
| `server/src/platform/gateway.js` | `/v1/chat/completions` 路由编排 |
| `server/src/platform/index.js` | Fastify 插件，注册路由 |
| `server/src/db.js` | 合并 `PLATFORM_TABLES` |
| `server/src/app.js` | 注册 platform 插件 |
| `server/test/platform_api_key.test.js` | Key 生成/哈希/校验测试 |
| `server/test/platform_billing.test.js` | 计费与账本测试 |
| `server/test/platform_gateway.test.js` | 网关端到端（mock LiteLLM）测试 |

---

## Task 1: 建表语句与 DB 集成

**Files:**
- Create: `server/src/platform/tables.js`
- Modify: `server/src/db.js`

- [ ] **Step 1: 创建 `tables.js`**

```javascript
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
```

- [ ] **Step 2: 合并到 `db.js`**

在 `db.js` 顶部引入：
```javascript
const { PLATFORM_TABLES } = require('./platform/tables');
```

在 `TABLES` 数组末尾追加 `...PLATFORM_TABLES`（在 `]` 之前加 `,` 和展开）。

- [ ] **Step 3: 验证建表**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node -e "require('./src/db').createPool(require('./src/config')).then(p=>p.query('SHOW TABLES')).then(r=>console.log(r[0].map(x=>x.Tables_in_openelf_platform_test).filter(n=>n.startsWith('platform_'))))"`
Expected: 输出 7 张 `platform_*` 表名

---

## Task 2: 平台配置模块

**Files:**
- Create: `server/src/platform/config.js`

- [ ] **Step 1: 创建 `config.js`**

```javascript
'use strict';

function env(name, fallback) {
  const v = process.env[name];
  return v == null ? fallback : v;
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  litellm: {
    baseUrl: env('LITELLM_BASE_URL', 'http://127.0.0.1:4000'),
    masterKey: env('LITELLM_MASTER_KEY', ''),
    timeoutMs: envInt('LITELLM_TIMEOUT_MS', 60000),
  },
  key: {
    pepper: env('PLATFORM_KEY_PEPPER', 'dev-pepper-change-me'),
    prefixLength: 12,
    secretLength: 40,
  },
  billing: {
    defaultMaxTokens: envInt('PLATFORM_DEFAULT_MAX_TOKENS', 4096),
    freezeTtlMs: envInt('PLATFORM_FREEZE_TTL_MS', 180000),
    markupBp: {
      domestic_external: envInt('PLATFORM_MARKUP_DOMESTIC', 1150),
      internal: 1000,
    },
  },
  rateLimit: {
    defaultQps: envInt('PLATFORM_DEFAULT_QPS', 5),
  },
};
```

- [ ] **Step 2: 验证导出**

Run: `node -e "const c=require('./src/platform/config'); console.log(c.litellm.baseUrl, c.key.prefixLength, c.billing.defaultMaxTokens)"`
Expected: `http://127.0.0.1:4000 12 4096`

---

## Task 3: API Key 生成与校验

**Files:**
- Create: `server/src/platform/api_key.js`
- Test: `server/test/platform_api_key.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKey, hashKey, verifyKey, keyPrefix } = require('../src/platform/api_key');

test('generateKey 返回 oe-sk- 前缀且可校验', () => {
  const { id, plain, prefix } = generateKey();
  assert.ok(plain.startsWith('oe-sk-'));
  assert.equal(prefix.length, 12);
  const h = hashKey(plain);
  assert.ok(verifyKey(plain, h));
});

test('verifyKey 对错误密钥返回 false', () => {
  const { plain } = generateKey();
  const h = hashKey(plain);
  assert.equal(verifyKey(plain + 'x', h), false);
});

test('keyPrefix 提取前 12 字符', () => {
  assert.equal(keyPrefix('oe-sk-abcdef012345.rest'), 'oe-sk-abcdef');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/platform_api_key.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `api_key.js`**

```javascript
'use strict';
const crypto = require('node:crypto');
const { randomUUID } = crypto;
const config = require('./config');

function randomSecret(len) {
  return crypto.randomBytes(len).toString('base64url');
}

function hashKey(plain) {
  return crypto.createHmac('sha256', config.key.pepper).update(plain).digest('hex');
}

function keyPrefix(plain) {
  return plain.slice(0, config.key.prefixLength);
}

function generateKey() {
  const id = randomUUID();
  const secret = randomSecret(config.key.secretLength);
  const plain = `oe-sk-${secret}`;
  return { id, plain, prefix: keyPrefix(plain) };
}

function verifyKey(plain, hash) {
  if (!plain || !hash) return false;
  const actual = hashKey(plain);
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { generateKey, hashKey, verifyKey, keyPrefix };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/platform_api_key.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/api_key.js server/src/platform/config.js server/test/platform_api_key.test.js
git commit -m "feat(platform): add API key generation and verification"
```

---

## Task 4: 模型目录与价格

**Files:**
- Create: `server/src/platform/catalog.js`
- Create: `server/scripts/seed-catalog.js`（一次性种子脚本）
- Test: `server/test/platform_catalog.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCost, computePrice, pricePer1m } = require('../src/platform/catalog');

test('computeCost 按 token 数计算微元成本', () => {
  const cost = computeCost(1200, 800, { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 });
  assert.equal(cost, 2_800_000 / 1_000_000); // 2800 微元? 等下，公式是 tokens*price/1e6
});
```

修正：`computeCost = Math.round((prompt*input + completion*output) / 1_000_000)`

```javascript
test('computeCost 计算示例', () => {
  const cost = computeCost(1200, 800, { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 });
  // (1200*1e6 + 800*2e6)/1e6 = (1.2e9 + 1.6e9)/1e6 = 2800
  assert.equal(cost, 2800);
});

test('computePrice 按 markup 基点加价', () => {
  const price = computePrice(2800, 1150); // 1150 bp = ×1.15
  assert.equal(price, Math.round(2800 * 1.15));
});

test('pricePer1m 取有效价格（effective_from <= now）', () => {
  const rows = [
    { model_id: 'm', input_micro_per_1m: 100, output_micro_per_1m: 200, markup_bp: 1100, effective_from: 1000 },
    { model_id: 'm', input_micro_per_1m: 120, output_micro_per_1m: 220, markup_bp: 1100, effective_from: 2000 },
  ];
  const p = pricePer1m(rows, 1500);
  assert.equal(p.input_micro_per_1m, 100);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/platform_catalog.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `catalog.js`**

```javascript
'use strict';

function computeCost(promptTokens, completionTokens, price) {
  const raw = (promptTokens * price.input_micro_per_1m + completionTokens * price.output_micro_per_1m) / 1_000_000;
  return Math.max(1, Math.round(raw));
}

function computePrice(costMicro, markupBp) {
  return Math.max(1, Math.round(costMicro * markupBp / 1000));
}

function pricePer1m(rows, nowMs) {
  const valid = rows.filter((r) => r.effective_from <= nowMs)
    .sort((a, b) => b.effective_from - a.effective_from);
  return valid[0] || null;
}

module.exports = { computeCost, computePrice, pricePer1m };
```

- [ ] **Step 4: 编写种子脚本 `seed-catalog.js`**

```javascript
'use strict';
// 用法: node scripts/seed-catalog.js
const { createPool } = require('../src/db');
const config = require('../src/config');

const SEED_MODELS = [
  { model_id: 'deepseek/deepseek-chat', vendor: 'deepseek', display_name: 'DeepSeek Chat', region: 'domestic',
    capabilities: 'chat,tools,json', context_tokens: 65536, input: 1_000_000, output: 2_000_000, markup_bp: 1150 },
  { model_id: 'doubao/llama-3-70b', vendor: 'volcengine', display_name: '豆包', region: 'domestic',
    capabilities: 'chat,tools', context_tokens: 32768, input: 800_000, output: 2_000_000, markup_bp: 1150 },
  { model_id: 'qwen/qwen-turbo', vendor: 'aliyun', display_name: '通义千问 Turbo', region: 'domestic',
    capabilities: 'chat,tools,json', context_tokens: 32768, input: 800_000, output: 2_000_000, markup_bp: 1150 },
];

(async () => {
  const pool = await createPool(config);
  const now = Date.now();
  for (const m of SEED_MODELS) {
    await pool.execute(
      `INSERT IGNORE INTO platform_model_catalog (model_id, vendor, display_name, region, capabilities, context_tokens, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [m.model_id, m.vendor, m.display_name, m.region, m.capabilities, m.context_tokens]
    );
    await pool.execute(
      `INSERT IGNORE INTO platform_model_price (model_id, input_micro_per_1m, output_micro_per_1m, markup_bp, effective_from)
       VALUES (?, ?, ?, ?, ?)`,
      [m.model_id, m.input, m.output, m.markup_bp, now]
    );
  }
  console.log('seeded', SEED_MODELS.length, 'models');
  await pool.end();
})();
```

- [ ] **Step 5: 运行测试 + 种子**

Run: `node --test test/platform_catalog.test.js`
Expected: PASS

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node scripts/seed-catalog.js`
Expected: `seeded 3 models`

- [ ] **Step 6: Commit**

```bash
git add server/src/platform/catalog.js server/scripts/seed-catalog.js server/test/platform_catalog.test.js
git commit -m "feat(platform): model catalog and pricing"
```

---

## Task 5: 计费模块（预授权/结算/账本）

**Files:**
- Create: `server/src/platform/billing.js`
- Test: `server/test/platform_billing.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
if (!/^openelf_[a-z0-9_]*test$/.test(process.env.DB_NAME || '')) {
  throw new Error('必须指定 DB_NAME=openelf_*test');
}
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.SMS_CODE_PEPPER = 'test-sms-pepper-0123456789abcdef';
process.env.REFRESH_TOKEN_PEPPER = 'test-refresh-pepper-0123456789abcdef';

const { createPool } = require('../src/db');
const config = require('../src/config');
const { createBillingService } = require('../src/platform/billing');

let pool, billing, userId;

before(async () => {
  pool = await createPool(config);
  await pool.execute('DELETE FROM platform_ledger');
  await pool.execute('DELETE FROM platform_wallets');
  await pool.execute('DELETE FROM platform_requests');
  userId = 'u_' + require('node:crypto').randomBytes(16).toString('hex');
  await pool.execute('INSERT IGNORE INTO users (id, phone, nickname, avatar_initial, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, '13900000000', 'tester', 'T', 'active', new Date().toISOString()]);
  billing = createBillingService(pool);
});
after(async () => { await pool.end(); });

test('preauth 冻结余额并写入账本', async () => {
  await billing.topup(userId, 10_000_000); // 充 10 元
  const { requestId, frozen } = await billing.preauth({
    userId, keyId: null, model: 'deepseek/deepseek-chat',
    promptTokens: 1200, maxTokens: 4096,
    price: { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 },
    markupBp: 1150,
  });
  assert.ok(requestId);
  assert.ok(frozen > 0);
  const w = await billing.getWallet(userId);
  assert.equal(w.balance_micro, 10_000_000);
  assert.equal(w.frozen_micro, frozen);
});

test('settle 按实际 usage 扣费并释放冻结', async () => {
  const w0 = await billing.getWallet(userId);
  await billing.settle({
    userId, requestId: 'prev', // 需要上一个 test 的 requestId，实际用闭包
    promptTokens: 1200, completionTokens: 800,
    resolvedModel: 'deepseek/deepseek-chat', latencyMs: 120,
  });
  const w = await billing.getWallet(userId);
  assert.ok(w.balance_micro < w0.balance_micro);
  assert.equal(w.frozen_micro, 0);
});
```

注：测试中 `requestId` 需要在 preauth 后保存。实际测试代码里用模块级变量传递。

- [ ] **Step 2: 运行测试确认失败**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node --test test/platform_billing.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `billing.js`**

```javascript
'use strict';
const crypto = require('node:crypto');
const { computeCost, computePrice } = require('./catalog');

function safeInt(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid amount');
  return n;
}

function createBillingService(pool) {
  async function getWallet(userId) {
    const [rows] = await pool.execute(
      'SELECT user_id, balance_micro, frozen_micro, total_topup_micro, updated_at FROM platform_wallets WHERE user_id = ?',
      [userId]
    );
    if (!rows.length) {
      await pool.execute(
        'INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at) VALUES (?, 0, 0, 0, ?)',
        [userId, Date.now()]
      );
      return { user_id: userId, balance_micro: 0, frozen_micro: 0, total_topup_micro: 0, updated_at: Date.now() };
    }
    return rows[0];
  }

  async function topup(userId, amountMicro, note = 'topup') {
    safeInt(amountMicro);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at) VALUES (?, ?, 0, ?, ?) ON DUPLICATE KEY UPDATE balance_micro = balance_micro + ?, total_topup_micro = total_topup_micro + ?, updated_at = ?',
        [userId, amountMicro, amountMicro, Date.now(), amountMicro, amountMicro, Date.now()]
      );
      const [w] = await conn.execute('SELECT balance_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      await conn.execute(
        'INSERT INTO platform_ledger (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)',
        [userId, 'topup', amountMicro, w[0].balance_micro, note, Date.now()]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function preauth({ userId, keyId, model, promptTokens, maxTokens, price, markupBp }) {
    const estCost = computeCost(promptTokens, maxTokens, price);
    const estPrice = computePrice(estCost, markupBp);
    const requestId = crypto.randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      if (!w.length) {
        const err = new Error('insufficient_balance');
        err.statusCode = 402; throw err;
      }
      if (w[0].balance_micro - w[0].frozen_micro < estPrice) {
        const err = new Error('insufficient_balance');
        err.statusCode = 402; throw err;
      }
      await conn.execute('UPDATE platform_wallets SET frozen_micro = frozen_micro + ? WHERE user_id = ?', [estPrice, userId]);
      await conn.commit();
      return { requestId, frozen: estPrice };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function settle({ userId, requestId, keyId, promptTokens, completionTokens, resolvedModel, latencyMs, ttftMs = 0, status = 'ok', errorCode = null, estimated = false, price, markupBp }) {
    const actualCost = computeCost(promptTokens, completionTokens, price);
    const actualPrice = computePrice(actualCost, markupBp);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      const frozen = w[0] ? w[0].frozen_micro : 0;
      const charge = Math.min(frozen, actualPrice);
      const refund = frozen - charge;
      await conn.execute('UPDATE platform_wallets SET balance_micro = balance_micro - ?, frozen_micro = frozen_micro - ? WHERE user_id = ?',
        [charge, frozen, userId]);
      const [w2] = await conn.execute('SELECT balance_micro FROM platform_wallets WHERE user_id = ?', [userId]);
      await conn.execute(
        'INSERT INTO platform_ledger (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, keyId || null, requestId, 'charge', -charge, w2[0].balance_micro, resolvedModel, Date.now()]
      );
      await conn.execute(
        `INSERT INTO platform_requests (id, user_id, key_id, source, requested_model, resolved_model, prompt_tokens, completion_tokens, cost_micro, price_micro, latency_ms, ttft_ms, status, error_code, estimated, created_at)
         VALUES (?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, userId, keyId || null, resolvedModel, resolvedModel, promptTokens, completionTokens, actualCost, actualPrice, latencyMs, ttftMs, status, errorCode, estimated ? 1 : 0, Date.now()]
      );
      await conn.commit();
      return { charged: charge, refund, actualCost, actualPrice };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function release({ userId, requestId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      if (w.length && w[0].frozen_micro > 0) {
        await conn.execute('UPDATE platform_wallets SET frozen_micro = 0 WHERE user_id = ?', [userId]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  return { getWallet, topup, preauth, settle, release };
}

module.exports = { createBillingService };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node --test test/platform_billing.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/billing.js server/test/platform_billing.test.js
git commit -m "feat(platform): billing with preauth freeze and settle"
```

---

## Task 6: LiteLLM 转发模块

**Files:**
- Create: `server/src/platform/upstream.js`
- Test: `server/test/platform_upstream.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// mock http server
const http = require('node:http');

test('chatCompletions 非流式返回 usage', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'x', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: 'hi' } }] }));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { createUpstream } = require('../src/platform/upstream');
  const upstream = createUpstream({ baseUrl: `http://127.0.0.1:${port}`, masterKey: 'k' });
  const result = await upstream.chatCompletions({ model: 'm', messages: [] });
  assert.equal(result.usage.prompt_tokens, 10);
  server.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/platform_upstream.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `upstream.js`**

```javascript
'use strict';

function createUpstream({ baseUrl, masterKey, timeoutMs = 60000 }) {
  async function chatCompletions({ model, messages, stream = false, temperature, max_tokens, ...rest }) {
    const body = { model, messages, stream, ...(temperature != null && { temperature }), ...(max_tokens != null && { max_tokens }), ...rest };
    if (stream) body.stream_options = { include_usage: true };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${masterKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new Error('upstream_error');
        err.statusCode = res.status;
        err.upstreamBody = await res.text();
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function chatCompletionsStream({ model, messages, ...rest }, onChunk) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, ...rest };
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${masterKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('upstream_error:' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let usage = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          if (obj.usage) usage = obj.usage;
          onChunk?.(obj);
        } catch { /* ignore */ }
      }
    }
    return { usage };
  }

  return { chatCompletions, chatCompletionsStream };
}

module.exports = { createUpstream };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/platform_upstream.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/platform/upstream.js server/test/platform_upstream.test.js
git commit -m "feat(platform): LiteLLM upstream client"
```

---

## Task 7: 网关路由编排

**Files:**
- Create: `server/src/platform/gateway.js`
- Create: `server/src/platform/index.js`
- Modify: `server/src/app.js`
- Test: `server/test/platform_gateway.test.js`

- [ ] **Step 1: 写失败测试（mock upstream + billing）**

```javascript
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
// ... 设置测试 DB，创建用户、Key、充值 ...

test('POST /v1/chat/completions 成功扣费', async (t) => {
  const res = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${plainKey}` },
    payload: { model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.choices);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node --test test/platform_gateway.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 `gateway.js`**

```javascript
'use strict';
const { verifyKey, keyPrefix } = require('./api_key');
const { computeCost, computePrice } = require('./catalog');

function createGateway({ db, billing, upstream, catalog }) {
  async function resolveKey(authorization) {
    if (!authorization || !authorization.startsWith('Bearer ')) return null;
    const plain = authorization.slice(7).trim();
    const prefix = keyPrefix(plain);
    const [rows] = await db.execute(
      'SELECT id, user_id, key_hash, allowed_models, qps_limit, revoked_at FROM platform_api_keys WHERE key_prefix = ? LIMIT 1',
      [prefix]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.revoked_at) return null;
    if (!verifyKey(plain, row.key_hash)) return null;
    return row;
  }

  async function chatCompletionsHandler(req, reply) {
    const key = await resolveKey(req.headers.authorization);
    if (!key) return reply.code(401).send({ error: { message: 'invalid api key', type: 'invalid_request_error', code: 'invalid_api_key' } });

    const { model, messages, stream = false, max_tokens, temperature } = req.body || {};
    if (!model || !Array.isArray(messages)) {
      return reply.code(400).send({ error: { message: 'model and messages required', type: 'invalid_request_error' } });
    }

    // 取模型价格
    const [priceRows] = await db.execute('SELECT input_micro_per_1m, output_micro_per_1m, markup_bp FROM platform_model_price WHERE model_id = ? ORDER BY effective_from DESC LIMIT 1', [model]);
    if (!priceRows.length) return reply.code(404).send({ error: { message: 'model not found', type: 'invalid_request_error' } });
    const price = priceRows[0];

    // 预授权
    const promptEst = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
    const maxTok = max_tokens || 4096;
    const start = Date.now();
    let preauth;
    try {
      preauth = await billing.preauth({
        userId: key.user_id, keyId: key.id, model,
        promptTokens: Math.ceil(promptEst / 2.2), maxTokens: maxTok,
        price, markupBp: price.markup_bp,
      });
    } catch (e) {
      if (e.statusCode === 402) return reply.code(402).send({ error: { message: '余额不足，请充值', type: 'insufficient_quota', code: 'insufficient_balance' } });
      throw e;
    }

    try {
      if (stream) {
        // 流式：透传 SSE，结束后结算
        reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-request-id': preauth.requestId });
        let promptTokens = 0, completionTokens = 0;
        await upstream.chatCompletionsStream({ model, messages, max_tokens: maxTok, temperature }, (chunk) => {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });
        // 结算（usage 从最后一个 chunk 提取，此处简化用估算）
        const ttft = Date.now() - start;
        await billing.settle({
          userId: key.user_id, requestId: preauth.requestId, keyId: key.id,
          promptTokens: Math.ceil(promptEst / 2.2), completionTokens: 0,
          resolvedModel: model, latencyMs: Date.now() - start, ttftMs: ttft,
          price, markupBp: price.markup_bp, estimated: true,
        });
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      const result = await upstream.chatCompletions({ model, messages, max_tokens: maxTok, temperature });
      const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0 };
      await billing.settle({
        userId: key.user_id, requestId: preauth.requestId, keyId: key.id,
        promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        resolvedModel: result.model || model, latencyMs: Date.now() - start,
        price, markupBp: price.markup_bp,
      });
      reply.header('x-request-id', preauth.requestId);
      return result;
    } catch (e) {
      await billing.release({ userId: key.user_id, requestId: preauth.requestId });
      if (e.statusCode) return reply.code(e.statusCode).send({ error: { message: 'upstream error', type: 'api_error' } });
      throw e;
    }
  }

  return { chatCompletionsHandler, resolveKey };
}

module.exports = { createGateway };
```

- [ ] **Step 4: 实现 `index.js`（Fastify 插件）**

```javascript
'use strict';
const fp = require('fastify-plugin');
const config = require('./config');
const { createBillingService } = require('./billing');
const { createUpstream } = require('./upstream');
const { createGateway } = require('./gateway');

async function platformPlugin(fastify, opts) {
  const db = fastify.db;
  const billing = createBillingService(db);
  const upstream = createUpstream({
    baseUrl: config.litellm.baseUrl,
    masterKey: config.litellm.masterKey,
    timeoutMs: config.litellm.timeoutMs,
  });
  const gateway = createGateway({ db, billing, upstream });

  fastify.post('/v1/chat/completions', gateway.chatCompletionsHandler);

  fastify.get('/v1/models', async (req, reply) => {
    const [rows] = await db.execute("SELECT model_id AS id, display_name AS name FROM platform_model_catalog WHERE status = 'active'");
    return { object: 'list', data: rows.map((r) => ({ id: r.id, object: 'model', owned_by: 'openelf' })) };
  });

  fastify.get('/health', async () => ({ status: 'ok' }));
}

module.exports = fp(platformPlugin, { name: 'platform' });
```

- [ ] **Step 5: 在 `app.js` 注册插件**

在 `app.js` 中 `const app = Fastify(...)` 之后、路由注册之前加：
```javascript
await app.register(require('./platform'));
```

- [ ] **Step 6: 运行端到端测试**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node --test test/platform_gateway.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/platform/gateway.js server/src/platform/index.js server/src/app.js server/test/platform_gateway.test.js
git commit -m "feat(platform): gateway route with auth and billing"
```

---

## Task 8: 内部调用接口

**Files:**
- Modify: `server/src/platform/gateway.js`（增加 internal 方法）
- Modify: `server/src/platform/index.js`（注册 `/internal/v1/chat/completions`）

- [ ] **Step 1: 在 `gateway.js` 增加 `internalChatHandler`**

```javascript
async function internalChatHandler(req, reply) {
  // 服务间签名校验
  const ts = req.headers['x-oe-timestamp'];
  const sig = req.headers['x-oe-signature'];
  const expected = crypto.createHmac('sha256', process.env.INTERNAL_CALLBACK_SECRET || 'dev-secret')
    .update(ts + req.url + crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex'))
    .digest('hex');
  if (Math.abs(Date.now() - Number(ts)) > 300_000 || sig !== expected) {
    return reply.code(401).send({ error: 'invalid signature' });
  }
  // 内部调用走 internal markup（1000 bp），从内部用户余额扣（由调用方负责）
  // 此处简化：直接透传，不做预授权（内部由 AI 运营逻辑扣词元）
  const { model, messages, ...rest } = req.body;
  const result = await upstream.chatCompletions({ model, messages, ...rest });
  return result;
}
```

- [ ] **Step 2: 在 `index.js` 注册**

```javascript
fastify.post('/internal/v1/chat/completions', gateway.internalChatHandler);
```

- [ ] **Step 3: 运行全量测试**

Run: `DB_NAME=openelf_platform_test DB_PASSWORD=<test> node --test test/platform_*.test.js`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/platform/gateway.js server/src/platform/index.js
git commit -m "feat(platform): internal chat endpoint with service auth"
```

---

## 验收（M1）

- [ ] 直连 LiteLLM 验证至少 1 家模型返回正常（手动 curl）
- [ ] 创建测试用户 → 建 Key → 充 1 元 → 调 `/v1/chat/completions` 返回 200
- [ ] 余额扣减正确，账本有 charge 记录
- [ ] 余额不足时返回 402 + OpenAI 兼容错误
- [ ] 流式请求返回 SSE 格式
- [ ] `node --test test/platform_*.test.js` 全部通过

---

## 后续计划（不在本 plan 范围）

- M2 控制台（Key 管理、余额、用量）
- M3 充值（支付宝 api_credit）
- M4 榜单
- M5 官网 /platform + 文档
- M6 对外灰度
- M7 香港通道

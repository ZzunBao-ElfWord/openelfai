'use strict';

// UGC 单角色铸造编排：本地校验 → 预检余额 → 占 tokenId → 授权登记 + B2B 铸造 → 扣费建 AI → 落状态。
// 每次铸造前先为作品登记一条一次性授权，再携带 authId 与 workHash 走 B2B 铸造上链；
// 链上凭证（authId / txHash / contractNo）只来自 linksprite 返回值，任何失败都不伪造。
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const { DEFAULT_ASSETS_DIR, publicCard } = require('./store');
const { allocateTokenIdsIn } = require('./token_alloc');
const { cleanupBatchCandidates } = require('./batch_cleanup');
const { CREATE_ELF_COST } = require('../commerce');

const MINT_COST = CREATE_ELF_COST;
const MAX_TOKEN_ATTEMPTS = 20;
const META_FILE_RE = /^meta_[a-f0-9]{64}\.json$/;
// 一次性授权：非独家（scope=1），只能铸 1 次，有效期 10 年。
const AUTH_SCOPE = 1;
const AUTH_MAX_MINT = 1;
const AUTH_WINDOW_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/// 授权登记的 IP 方地址：优先专用配置，缺省回退平台金库地址。
function platformIpOwner() {
  return String(process.env.PLATFORM_IP_OWNER_ADDRESS || '').trim()
    || String(process.env.PLATFORM_TREASURY_ADDRESS || '').trim();
}

/// 一次性授权合同编号：前 8 位卡号 + 毫秒时间戳，长度可控且天然唯一。
function ugcContractNo(cardId, at) {
  return `OPENELF-UGC-${String(cardId).slice(0, 8)}-${at}`;
}

/// 接收地址取用户人类侧链地址：优先轻量读取，其次回退 commerce 快照，均取不到返回 null。
async function humanAddressOf(commerce, actor) {
  if (typeof commerce.characterAddress === 'function') {
    const value = String((await commerce.characterAddress(actor)) || '').trim();
    if (value) return value;
  }
  if (typeof commerce.snapshot === 'function') {
    const snapshot = await commerce.snapshot(actor);
    const value = String(snapshot?.commerce?.humanAddress || '').trim();
    if (value) return value;
  }
  return null;
}

function assetsRoot(assetsDir) {
  return assetsDir || process.env.CHARACTER_ASSETS_DIR || DEFAULT_ASSETS_DIR;
}

function publicBase(value) {
  const raw = value === undefined
    ? process.env.CHARACTER_PUBLIC_ASSET_BASE || 'https://openelfai.com'
    : value || '';
  return String(raw).replace(/\/+$/, '');
}

function assetUrl(base, key) {
  return key ? `${base}/api/v1/character-assets/${key}` : null;
}

/// 真实库用连接开事务；内存/假 DB 没有 getConnection 时退化为直接执行，便于单测。
/// 两条分支的 tx.execute 都只返回 rows，与 token_alloc 的契约保持一致。
async function withTransaction(db, work) {
  if (typeof db.getConnection !== 'function') {
    return work({
      execute: async (sql, params = []) => {
        const result = await db.execute(sql, params);
        return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
      },
    });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work({
      execute: async (sql, params = []) => (await connection.execute(sql, params))[0],
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findMintRow(db, cardId) {
  const [rows] = await db.execute('SELECT * FROM character_mints WHERE card_id = ?', [cardId]);
  return rows[0] || null;
}

async function saveMintRow(db, id, row) {
  await db.execute(
    `UPDATE character_mints SET token_id = ?, work_hash = ?, dci_id = ?, ant_tx_hash = ?,
       auth_id = ?, tx_hash = ?, contract_no = ?, status = ?, error = ?, updated_at = ?
     WHERE id = ?`,
    [
      row.token_id, row.work_hash, row.dci_id, row.ant_tx_hash,
      row.auth_id ?? null, row.tx_hash ?? null, row.contract_no ?? null,
      row.status, row.error, Number(row.updated_at) || Date.now(), id,
    ],
  );
}

/// 链上流程失败/异常：记录状态与已知凭证（dci / ant 列保留但置空，兼容历史数据）。
async function saveChainState(db, mint, { workHash, chain, status, message }) {
  await saveMintRow(db, mint.id, {
    ...mint,
    work_hash: workHash,
    dci_id: null,
    ant_tx_hash: null,
    auth_id: chain.authId,
    tx_hash: chain.txHash,
    contract_no: chain.contractNo,
    status,
    error: message ? String(message).slice(0, 255) : null,
    updated_at: Date.now(),
  });
}

/// 事务内从共享分配器取号预占；唯一索引冲突（并发）时重试。
async function claimTokenId(db, { cardId, userId, workHash }) {
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await withTransaction(db, async (tx) => {
        const rows = await tx.execute('SELECT * FROM character_mints WHERE card_id = ?', [cardId]);
        if (rows[0]) {
          const existing = { ...rows[0] };
          // 上次链调用失败（未扣费）可复用同一 tokenId 重试。
          if (existing.status === 'failed') {
            existing.work_hash = workHash;
            existing.status = 'pending';
            existing.error = null;
            existing.updated_at = Date.now();
            await tx.execute(
              'UPDATE character_mints SET work_hash = ?, status = ?, error = ?, updated_at = ? WHERE id = ?',
              [workHash, 'pending', null, existing.updated_at, existing.id],
            );
          }
          return existing;
        }
        const { start } = await allocateTokenIdsIn(tx, 1);
        const tokenId = start;
        const ts = Date.now();
        const id = crypto.randomUUID();
        await tx.execute(
          `INSERT INTO character_mints
             (id, card_id, user_id, token_id, work_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [id, cardId, userId, tokenId, workHash, ts, ts],
        );
        return {
          id, card_id: cardId, user_id: userId, token_id: tokenId, work_hash: workHash,
          dci_id: null, ant_tx_hash: null, auth_id: null, tx_hash: null, contract_no: null,
          status: 'pending', error: null, created_at: ts, updated_at: ts,
        };
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') continue;
      throw error;
    }
  }
  throw fail(409, 'TOKEN_CONFLICT', '铸造序号分配冲突，请稍后再试');
}

/// 元数据 JSON：不含 NFT 字样，只保留展示与追溯需要的字段。
function metadataOf(card, imageUrl) {
  return {
    name: card.name,
    traits: card.traits || {},
    seed: Number(card.seed || 0),
    rarity: { tier: card.rarity_tier || null, score: Number(card.rarity_score || 0) },
    image: imageUrl,
    generator: 'OpenElf 形象工坊',
  };
}

/// 铸造成功后清理中间候选图：只删同批次未当选候选与联系表，失败只记日志。
async function cleanupAfterMint({ db, dir, card, logger }) {
  try {
    await cleanupBatchCandidates({
      db, assetsDir: dir, imageKey: card.image_key, thumbKey: card.thumb_key, logger,
    });
  } catch (error) {
    logger?.warn?.({ err: error, cardId: card.id }, 'batch candidate cleanup failed');
  }
}

async function settledResult({ db, card, mint, commerce, actor, base, userId, dir, logger }) {
  const imageUrl = assetUrl(base, card.image_key);
  const thumbUrl = assetUrl(base, card.thumb_key);
  const chain = {
    tokenId: Number(mint.token_id),
    workHash: mint.work_hash,
    tokenURI: base + `/api/v1/character-assets/meta_${mint.work_hash}.json`,
    imageUrl, thumbUrl,
    authId: mint.auth_id === null || mint.auth_id === undefined ? null : Number(mint.auth_id),
    txHash: mint.tx_hash || null,
    contractNo: mint.contract_no || null,
  };
  // commerce 侧仍幂等：已存在的 AI 直接返回，不会重复扣费。
  const created = await commerce.createElfFromCharacter(actor, { card, chain });
  const elf = created?.elf || created;
  if (card.status !== 'minted') {
    await db.execute(
      "UPDATE character_cards SET status = 'minted', updated_at = ? WHERE id = ? AND user_id = ?",
      [Date.now(), card.id, userId],
    );
  }
  await cleanupAfterMint({ db, dir, card, logger });
  return {
    elf,
    card: { ...card, status: 'minted' },
    tokenId: chain.tokenId,
    imageUrl,
    thumbUrl,
    chain: { authId: chain.authId, txHash: chain.txHash, contractNo: chain.contractNo },
  };
}

async function prepareAndMint(db, options = {}) {
  const {
    userId, cardId, commerce, client, user, assetsDir, publicAssetBase, logger,
  } = options;
  if (!db) throw fail(500, 'DB_UNAVAILABLE', '数据库未就绪');
  if (!userId) throw fail(400, 'INVALID_USER', '缺少用户');
  if (!cardId) throw fail(400, 'INVALID_CARD', '缺少角色卡');
  if (!commerce) throw fail(503, 'COMMERCE_DISABLED', '消费服务尚未开放');

  const actor = user && user.id ? user : { id: userId, nickname: '' };
  const dir = assetsRoot(assetsDir);
  const base = publicBase(publicAssetBase);

  const [cardRows] = await db.execute('SELECT * FROM character_cards WHERE id = ?', [cardId]);
  const row = cardRows[0];
  if (!row || row.user_id !== userId) throw fail(404, 'CARD_NOT_FOUND', '角色卡不存在');
  const card = publicCard(row);

  const existing = await findMintRow(db, cardId);
  if (existing && existing.status === 'minted') {
    return settledResult({ db, card, mint: existing, commerce, actor, base, userId, dir, logger });
  }
  if (existing && existing.status === 'pending') {
    throw fail(409, 'MINT_IN_PROGRESS', '该角色正在铸造中，请稍后刷新');
  }
  if (existing && existing.status === 'orphan') {
    throw fail(409, 'MINT_ORPHAN_STUCK', '该角色铸造异常，请联系客服处理');
  }
  if (card.status !== 'generated') {
    throw fail(409, 'CARD_NOT_GENERATED', '形象尚未生成，请先生成再铸造');
  }

  // PNG 与缩略图必须真实存在，workHash 取自 PNG 字节。
  let png;
  try {
    png = await fs.readFile(path.join(dir, path.basename(String(card.image_key || ''))));
  } catch (_) {
    throw fail(409, 'CARD_IMAGE_MISSING', '形象文件缺失，请重新生成');
  }
  try {
    await fs.access(path.join(dir, path.basename(String(card.thumb_key || ''))));
  } catch (_) {
    throw fail(409, 'CARD_IMAGE_MISSING', '形象缩略图缺失，请重新生成');
  }

  // 链服务未配置时直接失败，不占 tokenId、不动余额。
  if (!client || client.enabled === false) {
    throw fail(503, 'CHAIN_DISABLED', '链服务未开通');
  }
  // 授权登记需要平台的 IP 方地址，缺失时直接失败，不占 tokenId、不动余额。
  const ipOwner = platformIpOwner();
  if (!ipOwner) throw fail(503, 'IP_OWNER_NOT_CONFIGURED', '未配置授权登记 IP 方地址');

  const wallet = await commerce.characterBalance(actor);
  if (Number(wallet?.diamonds || 0) < MINT_COST) {
    throw fail(409, 'INSUFFICIENT_BALANCE', `钻石余额不足，铸造需要 ${MINT_COST} 钻石`);
  }
  // 铸造接收地址必须是用户真实的人类侧链地址，取不到就不铸造。
  const recipient = await humanAddressOf(commerce, actor);
  // 历史数据里出现过把 userId 写进 humanAddress 的情况，非 0x 地址一律不上链。
  if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw fail(409, 'HUMAN_ADDRESS_MISSING', '用户链上地址缺失');
  }

  const workHash = crypto.createHash('sha256').update(png).digest('hex');
  const imageUrl = assetUrl(base, card.image_key);
  const thumbUrl = assetUrl(base, card.thumb_key);
  const metaKey = `meta_${workHash}.json`;
  const tokenURI = base + `/api/v1/character-assets/${metaKey}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, metaKey), JSON.stringify(metadataOf(card, imageUrl), null, 2), 'utf8');

  const mint = await claimTokenId(db, { cardId, userId, workHash });
  if (mint.status === 'minted') {
    return settledResult({ db, card, mint, commerce, actor, base, userId, dir, logger });
  }

  const issuedAt = Date.now();
  const contractNo = ugcContractNo(card.id, issuedAt);
  const chain = {
    tokenId: Number(mint.token_id), workHash, tokenURI, imageUrl, thumbUrl,
    authId: null, txHash: null, contractNo,
  };

  // 1) 为本次作品登记一次性授权；登记失败按上游异常处理。
  try {
    await client.registerAuth({
      ipOwner,
      contractNo,
      workHash,
      startTime: issuedAt,
      endTime: issuedAt + AUTH_WINDOW_MS,
      scope: AUTH_SCOPE,
      maxMint: AUTH_MAX_MINT,
    });
  } catch (error) {
    await saveChainState(db, mint, { workHash, chain, status: 'failed', message: error.message });
    if (error.statusCode === 503) throw fail(503, 'CHAIN_DISABLED', error.message || '链服务未开通');
    throw fail(502, 'CHAIN_UPSTREAM_ERROR', error.message || '链上授权登记失败');
  }

  // 2) 反查 authId 并校验可用性；无法确认授权可用时一律按 409 拒绝。
  let authId;
  try {
    const found = await client.findAuthId({ contractNo, workHash });
    authId = Number(found?.authId);
    if (!Number.isSafeInteger(authId) || authId <= 0) {
      throw fail(409, 'AUTH_INVALID', '链上未找到对应授权记录');
    }
    if (!(await client.isAuthValid(authId))) {
      throw fail(409, 'AUTH_INVALID', '链上授权不可用');
    }
  } catch (error) {
    await saveChainState(db, mint, { workHash, chain, status: 'failed', message: error.message });
    throw fail(409, 'AUTH_INVALID', error.message || '链上授权不可用');
  }
  chain.authId = authId;

  // 3) 携带 authId 与 workHash 走 B2B 铸造，作品哈希随铸造上链。
  try {
    const receipt = await client.mintB2B({
      to: recipient,
      tokenId: chain.tokenId,
      tokenURI,
      authId,
      workHash,
    });
    if (!receipt?.txHash) throw fail(502, 'CHAIN_UPSTREAM_ERROR', '链上未返回交易哈希');
    chain.txHash = receipt.txHash;
  } catch (error) {
    await saveChainState(db, mint, { workHash, chain, status: 'failed', message: error.message });
    if (error.statusCode === 503) throw fail(503, 'CHAIN_DISABLED', error.message || '链服务未开通');
    throw fail(502, 'CHAIN_UPSTREAM_ERROR', error.message || '链上铸造失败');
  }

  // 链上成功后才扣费建 AI；扣费后任何异常都回滚钻石并标记 orphan。
  let elf;
  try {
    const created = await commerce.createElfFromCharacter(actor, { card, chain });
    elf = created?.elf || created;
  } catch (error) {
    let charged = error?.charged === true;
    if (!charged) {
      try {
        const after = await commerce.characterBalance(actor);
        charged = Number(wallet.diamonds) - Number(after?.diamonds || 0) >= MINT_COST;
      } catch (_) {
        charged = false;
      }
    }
    if (charged) {
      try {
        await commerce.refundCharacterMint(actor, { cardId });
      } catch (_) {
        // 退款失败时保留 orphan，交给对账/人工处理。
      }
    }
    await saveChainState(db, mint, { workHash, chain, status: 'orphan', message: error.message || 'AI 创建失败' });
    throw fail(500, 'MINT_SETTLE_FAILED',
      charged ? '链上铸造已完成但 AI 创建失败，已退回钻石' : '链上铸造已完成但 AI 创建失败');
  }

  await db.execute(
    "UPDATE character_cards SET status = 'minted', updated_at = ? WHERE id = ? AND user_id = ?",
    [Date.now(), cardId, userId],
  );
  await saveChainState(db, mint, { workHash, chain, status: 'minted', message: null });
  await cleanupAfterMint({ db, dir, card, logger });

  const [freshRows] = await db.execute('SELECT * FROM character_cards WHERE id = ?', [cardId]);
  const freshCard = publicCard(freshRows[0]) || { ...card, status: 'minted' };
  return {
    elf,
    card: freshCard,
    tokenId: chain.tokenId,
    imageUrl,
    thumbUrl,
    chain: { authId: chain.authId, txHash: chain.txHash, contractNo: chain.contractNo },
  };
}

module.exports = { prepareAndMint, MINT_COST, META_FILE_RE };

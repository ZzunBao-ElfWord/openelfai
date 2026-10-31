'use strict';

// LinkSprite（KOKO）链上服务客户端：只读参考 external 仓库的真实 DTO，不伪造任何链上凭证。
// API-Key 走 X-API-Key 请求头，baseUrl 需带上 context-path（/api）。
const DEFAULT_TIMEOUT_MS = 60000;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createLinkspriteClient({
  baseUrl,
  apiKey,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const origin = String(baseUrl === undefined ? process.env.LINKSPRITE_BASE_URL || '' : baseUrl)
    .trim().replace(/\/+$/, '');
  const key = String(apiKey === undefined ? process.env.LINKSPRITE_API_KEY || '' : apiKey).trim();
  const request = fetchImpl || globalThis.fetch;
  const enabled = Boolean(origin && key);

  /// 统一请求：非 2xx / 业务 code 非 200 时透出上游中文信息，网络异常映射 502。
  async function send(method, pathname, body) {
    if (!enabled) throw fail(503, 'CHAIN_DISABLED', '链服务未开通');
    const init = {
      method,
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await request(origin + pathname, init);
    } catch (_) {
      throw fail(502, 'CHAIN_UNAVAILABLE', '链服务连接失败，请稍后再试');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    const message = payload?.message || payload?.error?.message || `链服务返回 ${response.status}`;
    if (response.ok === false || Number(response.status) >= 400) {
      throw fail(502, 'CHAIN_UPSTREAM_ERROR', message);
    }
    if (payload && payload.code !== undefined && Number(payload.code) !== 200) {
      throw fail(502, 'CHAIN_UPSTREAM_ERROR', message);
    }
    return payload?.data ?? {};
  }

  async function post(pathname, body) {
    return send('POST', pathname, body);
  }

  async function get(pathname) {
    return send('GET', pathname);
  }

  /// 作品确权组合流程（存证 + DCI）。CopyrightDepositRequest 只有 workHash / ownerInfo，
  /// 因此作品文件 URL 不上传，ownerInfo 使用脱敏的平台用户标识（用户 ID）。
  async function registerUgc({ workHash, fileUrl, ownerName } = {}) {
    const hash = String(workHash || '').trim();
    if (!hash) throw fail(400, 'INVALID_WORK_HASH', '缺少作品哈希');
    const ownerInfo = String(ownerName || '').trim() || hash;
    const data = await post('/copyright/register-ugc', { workHash: hash, ownerInfo });
    if (!data || data.success === false) {
      throw fail(502, 'CHAIN_COPYRIGHT_FAILED', data?.message || '作品确权失败');
    }
    const antTxHash = data.antTxHash || null;
    const dciId = data.dciId || null;
    // 绝不伪造：拿不到存证哈希就无法继续铸造。
    if (!antTxHash) {
      throw fail(502, 'CHAIN_COPYRIGHT_FAILED', data?.message || '未取得蚂蚁链存证哈希，暂不能铸造');
    }
    return { dciId, antTxHash, message: data.message || null };
  }

  /// UGC 铸造：MintUGCRequest 必填 to / tokenId / tokenURI / dciId / antTxHash，
  /// ipfsHash 与 workHash 为可选字段，缺失时直接省略而不是编造。
  async function mintUgc({
    to, tokenId, tokenURI, dciId, antTxHash, ipfsHash = null, workHash = null,
  } = {}) {
    const required = {
      to: String(to || '').trim(),
      tokenURI: String(tokenURI || '').trim(),
      dciId: String(dciId || '').trim(),
      antTxHash: String(antTxHash || '').trim(),
    };
    if (!required.to) throw fail(400, 'INVALID_CHAIN_ARG', '缺少创作者地址');
    if (!required.tokenURI) throw fail(400, 'INVALID_CHAIN_ARG', '缺少 tokenURI');
    if (!required.dciId) throw fail(400, 'INVALID_CHAIN_ARG', '缺少 DCI 标识');
    if (!required.antTxHash) throw fail(400, 'INVALID_CHAIN_ARG', '缺少蚂蚁链存证哈希');
    if (!Number.isSafeInteger(Number(tokenId)) || Number(tokenId) <= 0) {
      throw fail(400, 'INVALID_CHAIN_ARG', '缺少 tokenId');
    }

    const body = {
      to: required.to,
      tokenId: Number(tokenId),
      tokenURI: required.tokenURI,
      dciId: required.dciId,
      antTxHash: required.antTxHash,
      ipfsHash: ipfsHash ? String(ipfsHash) : '',
      workHash: workHash ? String(workHash) : '',
    };

    const data = await post('/nft/mint/ugc', body);
    // ChainTxResult：status 0 成功，非 0 失败。
    if (data.status !== undefined && Number(data.status) !== 0) {
      throw fail(502, 'CHAIN_MINT_FAILED', data.message || '链上铸造失败');
    }
    return {
      txHash: data.txHash || null,
      blockNumber: data.blockNumber === undefined ? null : data.blockNumber,
      status: data.status === undefined ? 0 : data.status,
      message: data.message || null,
    };
  }

  /// 授权登记：AuthorizationRegisterRequest。上游不直接返回 authId，
  /// 调用方必须再用 /auth/list 按 contractNo 反查，绝不编造授权标识。
  async function registerAuth({
    ipOwner, contractNo, workHash, startTime, endTime, scope, maxMint,
  } = {}) {
    const owner = String(ipOwner || '').trim();
    const contract = String(contractNo || '').trim();
    const hash = String(workHash || '').trim();
    if (!owner) throw fail(400, 'INVALID_CHAIN_ARG', '缺少 IP 权利方');
    if (!contract) throw fail(400, 'INVALID_CHAIN_ARG', '缺少授权合同编号');
    if (!hash) throw fail(400, 'INVALID_CHAIN_ARG', '缺少作品哈希');
    const start = Number(startTime);
    const end = Number(endTime);
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= start) {
      throw fail(400, 'INVALID_CHAIN_ARG', '授权时间窗不合法');
    }
    const scopeValue = Number(scope);
    if (![0, 1, 2].includes(scopeValue)) {
      throw fail(400, 'INVALID_CHAIN_ARG', '授权范围只能是 0/1/2');
    }
    const mintLimit = Number(maxMint);
    if (!Number.isSafeInteger(mintLimit) || mintLimit <= 0) {
      throw fail(400, 'INVALID_CHAIN_ARG', '授权铸造上限不合法');
    }

    const data = await post('/auth/register', {
      ipOwner: owner,
      contractNo: contract,
      workHash: hash,
      startTime: start,
      endTime: end,
      scope: scopeValue,
      maxMint: mintLimit,
    });
    // ChainTxResult：status 0 成功，非 0 失败。
    if (data.status !== undefined && Number(data.status) !== 0) {
      throw fail(502, 'CHAIN_AUTH_FAILED', data.message || '链上授权登记失败');
    }
    return {
      txHash: data.txHash || null,
      blockNumber: data.blockNumber === undefined ? null : data.blockNumber,
      status: data.status === undefined ? 0 : data.status,
      message: data.message || null,
      output: data.output === undefined ? null : data.output,
    };
  }

  /// 从 /auth/list 返回的列表里按 contractNo（可叠加 workHash）匹配唯一一条，
  /// 取其中的 authId；找不到就视为失败，不伪造任何 authId。
  async function findAuthId({ contractNo, workHash } = {}) {
    const contract = String(contractNo || '').trim();
    if (!contract) throw fail(400, 'INVALID_CHAIN_ARG', '缺少授权合同编号');
    const hash = workHash === undefined || workHash === null ? '' : String(workHash).trim();

    const data = await get('/auth/list');
    const list = Array.isArray(data)
      ? data
      : (data && typeof data === 'object'
        ? ['list', 'records', 'rows', 'items'].map((key) => data[key]).find(Array.isArray) || []
        : []);
    const matches = list.filter((row) => {
      const value = row?.contractNo ?? row?.contract_no;
      return value !== undefined && String(value) === contract;
    });
    const narrowed = hash
      ? matches.filter((row) => {
        const value = row?.workHash ?? row?.work_hash;
        return value !== undefined && String(value) === hash;
      })
      : matches;
    const hit = narrowed[0];
    const authId = hit?.authId ?? hit?.auth_id;
    if (!hit || authId === undefined || authId === null || authId === '') {
      throw fail(404, 'AUTH_NOT_FOUND', '链上未找到对应授权记录');
    }
    return { authId: Number(authId), record: hit };
  }

  /// 校验授权可用性：/auth/valid/:authId 返回 boolean。
  async function isAuthValid(authId) {
    const id = Number(authId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw fail(400, 'INVALID_CHAIN_ARG', '缺少授权编号');
    }
    const data = await get(`/auth/valid/${id}`);
    if (typeof data === 'boolean') return data;
    if (data && typeof data === 'object') {
      if (data.valid !== undefined) return Boolean(data.valid);
      if (data.isValid !== undefined) return Boolean(data.isValid);
    }
    return Boolean(data);
  }

  /// B2B 系列铸造：tokenId 由平台自行分配并显式传入，便于逐条追溯。
  async function mintB2B({
    to, tokenId, tokenURI, authId, ipfsHash = null, workHash = null,
  } = {}) {
    const target = String(to || '').trim();
    const uri = String(tokenURI || '').trim();
    const auth = Number(authId);
    if (!target) throw fail(400, 'INVALID_CHAIN_ARG', '缺少接收地址');
    if (!uri) throw fail(400, 'INVALID_CHAIN_ARG', '缺少 tokenURI');
    if (!Number.isSafeInteger(auth) || auth <= 0) {
      throw fail(400, 'INVALID_CHAIN_ARG', '缺少授权编号');
    }
    if (!Number.isSafeInteger(Number(tokenId)) || Number(tokenId) <= 0) {
      throw fail(400, 'INVALID_CHAIN_ARG', '缺少 tokenId');
    }

    // 链服务用 Java ABI 编码，可选字段传 null 会导致 encodeMethodFromObject 报错，
    // 因此这里统一补空串而不是省略字段。
    const body = {
      to: target,
      tokenId: Number(tokenId),
      tokenURI: uri,
      authId: auth,
      ipfsHash: ipfsHash ? String(ipfsHash) : '',
      workHash: workHash ? String(workHash) : '',
    };

    const data = await post('/nft/mint/b2b', body);
    if (data.status !== undefined && Number(data.status) !== 0) {
      throw fail(502, 'CHAIN_MINT_FAILED', data.message || '链上铸造失败');
    }
    return {
      txHash: data.txHash || null,
      blockNumber: data.blockNumber === undefined ? null : data.blockNumber,
      status: data.status === undefined ? 0 : data.status,
      message: data.message || null,
    };
  }

  return {
    enabled,
    baseUrl: origin,
    registerUgc,
    mintUgc,
    registerAuth,
    findAuthId,
    isAuthValid,
    mintB2B,
  };
}

module.exports = { createLinkspriteClient, DEFAULT_TIMEOUT_MS };

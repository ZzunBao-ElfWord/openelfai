import axios from 'axios';

// ===== 类型（与后端接口契约保持一致；一个接口一个类型） =====

export type Role = 'super_admin' | 'moderator' | 'operator';

// 运行环境：钱包/订单/精灵等数据按环境隔离，顶栏切换后全站生效
export type Env = 'Production' | 'Sandbox';

export interface Me {
  id: string;
  username: string;
  role: Role;
  created_at?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// 钻石钱包（按环境隔离；金额单位：钻石，创作者收益单位：分）
export interface Wallet {
  diamonds: number;
  total_recharged: number;
  total_spent: number;
  refund_debt: number;
  earnings_fen: number;
  version: number;
}

export interface UserRow {
  id: string;
  phone: string;
  nickname: string;
  avatar_initial: string;
  status: string; // active / banned
  created_at: string;
  last_login_at: string;
  diamonds: number;
}

export interface ElfRow {
  object_id: string;
  owner_id: string;
  state: string;
  updated_at: string;
  name: string;
  /** 官方建档标记（来自 payload.isOfficial） */
  is_official?: boolean;
}

export interface LedgerEntry {
  event_id: string;
  type: string;
  amount: number;
  balance_after: number;
  debt_after: number;
  note: string;
  created_at: string;
}

export interface UserDetail {
  user: {
    id: string;
    phone: string;
    nickname: string;
    avatar_initial: string;
    status: string;
    created_at: string;
    last_login_at: string;
  };
  wallets: { Production?: Wallet; Sandbox?: Wallet };
  elves: { object_id: string; state: string; updated_at: string; name: string }[];
  recent_ledger: LedgerEntry[];
  sessions: number;
}

export interface DailyPoint {
  date: string;
  new_users: number;
  recharge: number;
  tip: number;
}

export interface StatsOverview {
  users_total: number;
  users_new_today: number;
  users_new_7d: number;
  active_today: number;
  elves_total: number;
  recharge_today: number;
  recharge_7d: number;
  tip_7d: number;
  pending_reviews: number;
  daily7: DailyPoint[];
}

// 支付宝订单与异常单共用同一结构（payload 为渠道原始报文）
export interface OrderRow {
  object_id: string;
  owner_id: string;
  state: string;
  ref_id: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

export interface AppleOrder {
  transaction_id: string;
  user_id: string;
  product_id: string;
  diamonds: number;
  environment: string;
  purchased_at: string;
  created_at: string;
}

export interface ElfDetail {
  object_id: string;
  owner_id: string;
  state: string;
  updated_at: string;
  payload: Record<string, unknown>;
  owner: { id: string; nickname: string; phone: string };
}

export interface CatalogModule {
  id: string;
  track: string;
  label: string;
  slot: string;
  token_cost: number;
  price_diamonds: number;
  override: { price_diamonds: number; listed: boolean; updated_at: string } | null;
}

export interface AuditEntry {
  id: string;
  actor_name: string;
  role: string;
  method: string;
  path: string;
  status: number;
  ip: string;
  ua: string;
  created_at: string;
}

// 审计日志筛选条件（空值不传给后端）
export interface AuditFilter {
  method?: string;
  actor?: string;
  q?: string;
}

export interface AdminAccount {
  id: string;
  username: string;
  role: Role;
  created_at: string;
}

export interface SystemHealth {
  mysql: { ok: boolean; latency_ms: number };
  node_api: { ok: boolean; status_code: number; latency_ms: number };
}

export interface AdjustResult {
  event_id: string;
  duplicated: boolean;
  wallet: Wallet;
}

// ===== HTTP 客户端（全应用唯一出口，禁止绕过） =====

export const TOKEN_KEY = 'openelf_admin_token';

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 20000,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// 401 统一回到登录页（登录页自身的 401 由页面自行处理提示）
let redirecting = false;
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      if (!redirecting) {
        redirecting = true;
        localStorage.removeItem(TOKEN_KEY);
        window.location.assign('/login');
      }
    }
    return Promise.reject(err);
  },
);

// 统一错误文案：后端错误体 { error, message }，取中文 message
export function errText(err: unknown, fallback = '请求失败'): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { message?: string } | undefined)?.message ?? fallback;
  }
  return fallback;
}

// ===== 认证 =====

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/login', { username, password });
  localStorage.setItem(TOKEN_KEY, data.token as string);
  return data.user as Me;
}

export const fetchMe = async (): Promise<Me> => (await api.get<Me>('/auth/me')).data;

// 修改自己的密码（需验证旧密码）
export function changePassword(oldPassword: string, newPassword: string) {
  return api.post('/auth/change-password', {
    old_password: oldPassword,
    new_password: newPassword,
  });
}

// ===== 数据看板 =====

export const fetchStats = async (env: Env): Promise<StatsOverview> =>
  (await api.get<StatsOverview>('/stats/overview', { params: { env } })).data;

// ===== 用户管理 =====

export async function fetchUsers(q: string, status: string, page: number): Promise<Page<UserRow>> {
  const { data } = await api.get<Page<UserRow>>('/users', {
    params: { q: q || undefined, status: status || undefined, page, page_size: 20 },
  });
  return data;
}

export const fetchUserDetail = async (id: string): Promise<UserDetail> =>
  (await api.get<UserDetail>(`/users/${id}`)).data;

// 封禁/解封：写 users.status，所有操作记录审计日志
export function setUserStatus(id: string, status: 'active' | 'banned') {
  return api.post(`/users/${id}/status`, { status });
}

// ===== 钱包与流水 =====

export const fetchWallet = async (userId: string, env: Env): Promise<Wallet> =>
  (await api.get<Wallet>(`/wallets/${userId}`, { params: { env } })).data;

export interface LedgerFilter {
  user_id?: string;
  type?: string;
}

export async function fetchLedger(
  env: Env,
  f: LedgerFilter,
  page: number,
): Promise<Page<LedgerEntry>> {
  const { data } = await api.get<Page<LedgerEntry>>('/ledger', {
    params: {
      user_id: f.user_id || undefined,
      type: f.type || undefined,
      env,
      page,
      page_size: 20,
    },
  });
  return data;
}

// 高危调账：client_token 幂等键，同一表单多次提交/重试不重复入账
export async function adjustWallet(body: {
  user_id: string;
  environment: Env;
  amount: number;
  note: string;
  client_token?: string;
}): Promise<AdjustResult> {
  const { data } = await api.post<AdjustResult>('/wallet/adjust', body);
  return data;
}

// ===== 订单 =====

export async function fetchAlipayOrders(
  env: Env,
  state: string,
  page: number,
): Promise<Page<OrderRow>> {
  const { data } = await api.get<Page<OrderRow>>('/orders/alipay', {
    params: { env, state: state || undefined, page, page_size: 20 },
  });
  return data;
}

export async function fetchAppleOrders(env: Env, page: number): Promise<Page<AppleOrder>> {
  const { data } = await api.get<Page<AppleOrder>>('/orders/apple', {
    params: { env, page, page_size: 20 },
  });
  return data;
}

// 异常单队列（结构与支付宝订单一致）
export async function fetchOrderReviews(env: Env, page: number): Promise<Page<OrderRow>> {
  const { data } = await api.get<Page<OrderRow>>('/orders/reviews', {
    params: { env, page, page_size: 20 },
  });
  return data;
}

export function resolveOrderReview(id: string, environment: Env, note?: string) {
  return api.post(`/orders/reviews/${id}/resolve`, { environment, note: note || undefined });
}

// ===== AI 精灵 =====

export interface ElfFilter {
  owner?: string;
  state?: string;
  q?: string;
  official?: boolean;
}

export async function fetchElves(env: Env, f: ElfFilter, page: number): Promise<Page<ElfRow>> {
  const { data } = await api.get<Page<ElfRow>>('/elves', {
    params: {
      env,
      owner: f.owner || undefined,
      state: f.state || undefined,
      q: f.q || undefined,
      official: f.official ? '1' : undefined,
      page,
      page_size: 20,
    },
  });
  return data;
}

// ===== 官方 AI 运营 =====

export interface AssetUploadResult {
  ok: boolean;
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  mime: string;
}

// 素材按内容 SHA256 命名，重复上传不会产生副本
export async function uploadAsset(file: File): Promise<AssetUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<AssetUploadResult>('/assets', form);
  return data;
}

export interface OfficialSeries {
  id: string;
  name: string;
  format: string; // audio / video / text / image
  coverUrl: string;
  cadence: string;
  desc: string;
}

export interface OfficialElfFields {
  name: string;
  nickname: string;
  initial: string;
  tagline: string;
  intro: string;
  persona: string;
  fear: string;
  habit: string;
  generation: number;
  edition: string;
  baseCapacity: number;
  learnedSkills: string[];
  avatarUrl: string;
  portraitUrl: string;
  series: OfficialSeries[];
  officialNote: string;
}

export interface OfficialListingInput {
  enabled: boolean;
  price: number;
  title: string;
  subtitle: string;
  note: string;
}

export interface OfficialElfCreate extends OfficialElfFields {
  environment: Env;
  object_id?: string;
  listing: OfficialListingInput;
}

export interface OfficialElfRow {
  object_id: string;
  owner_id: string;
  state: string;
  updated_at: string;
  payload: Record<string, unknown>;
  listing: Record<string, unknown> | null;
}

export interface OfficialElfCreateResult {
  ok: boolean;
  object_id: string;
  listing_id: string;
  payload: Record<string, unknown>;
  listing?: Record<string, unknown>;
}

export async function fetchOfficialElves(
  env: Env,
): Promise<{ items: OfficialElfRow[]; total: number }> {
  const { data } = await api.get<{ items: OfficialElfRow[]; total: number }>('/official/elves', {
    params: { env },
  });
  return data;
}

export async function createOfficialElf(body: OfficialElfCreate): Promise<OfficialElfCreateResult> {
  const { data } = await api.post<OfficialElfCreateResult>('/official/elves', body);
  return data;
}

// 仅更新官方字段与栏目，不改所有权、状态与挂单
export async function updateOfficialElf(
  id: string,
  body: OfficialElfFields & { environment: Env },
) {
  return api.put(`/official/elves/${id}`, body);
}

export const fetchElfDetail = async (id: string, env: Env): Promise<ElfDetail> =>
  (await api.get<ElfDetail>(`/elves/${id}`, { params: { env } })).data;

// 状态修正（仅 super_admin）
export function setElfState(id: string, environment: Env, state: string) {
  return api.post(`/elves/${id}/state`, { environment, state });
}

// ===== 能力包目录 =====

export const fetchCatalog = async (): Promise<{ modules: CatalogModule[] }> =>
  (await api.get<{ modules: CatalogModule[] }>('/catalog')).data;

// 覆盖定价/上下架：一期仅落库，待服务端接入后生效
export function updateCatalogModule(
  id: string,
  body: { environment: Env; price_diamonds?: number; listed?: boolean },
) {
  return api.put(`/catalog/modules/${id}`, body);
}

// ===== 运营配置：法律与政策文档 =====

export interface AppDocument {
  id: string;
  slug: string;
  title: string;
  version: number;
  format: string;
  status: 'draft' | 'published' | 'archived';
  effective_at: number;
  published_at: number;
  published_by: string;
  created_at: number;
  updated_at: number;
  preview: string;
}

export interface AppDocumentDetail {
  document: AppDocument;
  content: string;
}

export const fetchAppDocuments = async (): Promise<{ items: AppDocument[] }> =>
  (await api.get<{ items: AppDocument[] }>('/app-content/documents')).data;

export const fetchAppDocument = async (id: string): Promise<AppDocumentDetail> =>
  (await api.get<AppDocumentDetail>(`/app-content/documents/${id}`)).data;

export function createAppDocument(body: {
  slug: string;
  title: string;
  content: string;
  effective_at?: number | null;
}) {
  return api.post('/app-content/documents', body);
}

export function updateAppDocument(
  id: string,
  body: { title: string; content: string; effective_at?: number | null },
) {
  return api.put(`/app-content/documents/${id}`, body);
}

// 发布/下线仅 super_admin；发布即新增当前版本，旧版本自动归档
export function publishAppDocument(id: string) {
  return api.post(`/app-content/documents/${id}/publish`);
}

export function archiveAppDocument(id: string) {
  return api.post(`/app-content/documents/${id}/archive`);
}

// ===== 运营配置：应用文案与开关 =====

export interface AppConfigRow {
  key: string;
  group: string;
  label: string;
  value_type: 'text' | 'bool' | 'json' | 'number';
  value: string;
  remark: string;
  updated_by: string;
  updated_at: number;
}

export const fetchAppConfigs = async (): Promise<{ items: AppConfigRow[] }> =>
  (await api.get<{ items: AppConfigRow[] }>('/app-content/configs')).data;

export function updateAppConfig(key: string, value: string) {
  return api.put(`/app-content/configs/${key}`, { value });
}

// 开关类配置仅 super_admin
export function updateAppConfigSwitch(key: string, value: boolean) {
  return api.put(`/app-content/configs/${key}/switch`, { value });
}

// ===== 内容审核：用户举报 =====

export type ModerationReportState = 'open' | 'resolved' | 'dismissed';
export type ModerationTargetType = 'post' | 'comment' | 'elf' | 'user' | 'chat';
export type ModerationAction = 'dismiss' | 'remove_content';

export interface ModerationReport {
  id: string;
  user_id: string;
  target_type: ModerationTargetType;
  target_id: string;
  reason: string;
  detail: string;
  state: ModerationReportState;
  environment: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  note: string | null;
}

export interface ModerationReportFilter {
  state?: string; // open / resolved / dismissed / all
  target_type?: string;
  environment?: string;
}

export async function getReports(
  f: ModerationReportFilter,
  page: number,
): Promise<Page<ModerationReport>> {
  const { data } = await api.get<Page<ModerationReport>>('/moderation/reports', {
    params: {
      state: f.state || undefined,
      target_type: f.target_type || undefined,
      environment: f.environment || undefined,
      page,
      page_size: 20,
    },
  });
  return data;
}

// 处置举报：dismiss=忽略；remove_content=软删动态/评论并关闭举报
export function resolveReport(
  id: string,
  body: { action: ModerationAction; note?: string },
) {
  return api.post(`/moderation/reports/${id}/resolve`, body);
}

// ===== 内容审核：UGC 视频人工前审 =====

export type MediaReviewAction = 'approve' | 'reject';

export interface PendingMedia {
  id: string;
  environment: string;
  elf_id: string;
  elf_name: string;
  body: string;
  video_url: string | null;
  cover_url: string | null;
  uploaded_by: string;
  created_at: string;
  submitted_at: string;
}

export async function getPendingMedia(
  f: { environment?: string },
  page: number,
): Promise<Page<PendingMedia>> {
  const { data } = await api.get<Page<PendingMedia>>('/moderation/pending-media', {
    params: {
      environment: f.environment || undefined,
      page,
      page_size: 20,
    },
  });
  return data;
}

// 审核上传视频：approve=通过并进入信息流；reject=驳回不再展示
export function reviewPendingMedia(
  id: string,
  body: { environment: string; action: MediaReviewAction; note?: string },
) {
  return api.post(`/moderation/pending-media/${id}/review`, body);
}

// ===== 审计日志 =====

export async function fetchAudit(page: number, f: AuditFilter = {}): Promise<Page<AuditEntry>> {
  const { data } = await api.get<Page<AuditEntry>>('/audit', {
    params: { page, page_size: 50, ...f },
  });
  return data;
}

// 通过带认证头的 XHR 拉取 CSV 并触发浏览器下载（window.open 无法带 JWT 头）
export async function downloadCsv(path: string, params?: Record<string, string>): Promise<void> {
  const res = await api.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  const disp = (res.headers['content-disposition'] as string | undefined) ?? '';
  const m = /filename="?([^"]+)"?/.exec(disp);
  a.download = m ? m[1] : 'export.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===== 后台账号 =====

export const fetchAdminUsers = async (): Promise<{ items: AdminAccount[] }> =>
  (await api.get<{ items: AdminAccount[] }>('/admin-users')).data;

export function createAdminUser(body: { username: string; password: string; role: Role }) {
  return api.post('/admin-users', body);
}

// super_admin 重置任意后台账号密码
export function resetAdminPassword(id: string, password: string) {
  return api.put(`/admin-users/${id}/password`, { password });
}

// super_admin 删除后台账号（禁止删自己；至少保留一个 super_admin）
export function deleteAdminUser(id: string) {
  return api.delete(`/admin-users/${id}`);
}

// ===== 系统健康 =====

export const fetchSystemHealth = async (): Promise<SystemHealth> =>
  (await api.get<SystemHealth>('/system/health')).data;

// ===== 开放平台 =====
// 金额一律为「微元」整数：1 元 = 1_000_000 微元；加价率 markup_bp 以千分比表示（1150 = 115%）。

export interface PlatformModel {
  model_id: string;
  vendor: string;
  display_name: string;
  region: string;
  capabilities: string;
  context_tokens: number;
  status: string;
  external_only: boolean;
  input_micro_per_1m: number;
  output_micro_per_1m: number;
  markup_bp: number;
  effective_from: number | string;
}

// 编辑提交体（model_id 与 external_only 不可改）
export interface PlatformModelUpdate {
  vendor: string;
  display_name: string;
  region: string;
  capabilities: string;
  context_tokens: number;
  status: string;
  input_micro_per_1m: number;
  output_micro_per_1m: number;
  markup_bp: number;
}

export interface PlatformDeveloper {
  user_id: string;
  real_name: string;
  purpose: string;
  status: string; // pending / active / suspended
  tier: string;
  created_at: number | string;
  approved_at: number | string | null;
  balance_micro: number;
  frozen_micro: number;
  total_topup_micro: number;
  key_count: number;
}

export interface PlatformKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  allowed_models: string | null;
  monthly_budget_micro: number;
  qps_limit: number;
  ip_allowlist: string | null;
  created_at: number | string;
  last_used_at: number | string | null;
  revoked_at: number | string | null;
}

export interface PlatformKeyUpdate {
  name: string;
  allowed_models: string;
  monthly_budget_micro: number;
  qps_limit: number;
  ip_allowlist: string;
}

export interface PlatformLedgerRow {
  id?: number | string;
  key_id?: string | null;
  request_id?: string | null;
  type: string; // topup / charge / refund / adjust
  delta_micro: number;
  balance_after: number;
  note?: string | null;
  created_at: number | string;
}

export interface PlatformWalletDetail {
  user_id: string;
  balance_micro: number;
  frozen_micro: number;
  total_topup_micro: number;
  updated_at: number | string;
  ledger: PlatformLedgerRow[];
}

export interface PlatformRequestRow {
  id: string;
  user_id: string;
  key_id?: string | null;
  source?: string;
  requested_model: string;
  resolved_model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_micro: number;
  price_micro: number;
  latency_ms: number;
  ttft_ms?: number;
  status: string; // ok / upstream_error / timeout / rejected
  error_code?: string | null;
  estimated: boolean | number;
  created_at: number | string;
}

export interface PlatformRequestFilter {
  model?: string;
  status?: string;
  user_id?: string;
}

export interface PlatformUsageDaily {
  date: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  price_micro: number;
}

export interface PlatformUsageByModel {
  resolved_model: string;
  requests: number;
  price_micro: number;
}

export interface PlatformUsage {
  daily: PlatformUsageDaily[];
  by_model: PlatformUsageByModel[];
}

export async function fetchPlatformModels(): Promise<{ items: PlatformModel[] }> {
  const { data } = await api.get<{ items: PlatformModel[] }>('/platform/models');
  return data;
}

export function updatePlatformModel(body: PlatformModelUpdate & { model_id: string }) {
  return api.post('/platform/models/upsert', body);
}

export async function fetchPlatformDevelopers(
  status: string,
  page: number,
): Promise<Page<PlatformDeveloper>> {
  const { data } = await api.get<Page<PlatformDeveloper>>('/platform/developers', {
    params: { status: status || undefined, page, page_size: 20 },
  });
  return data;
}

export async function fetchPlatformKeys(userId: string, page: number): Promise<Page<PlatformKey>> {
  const { data } = await api.get<Page<PlatformKey>>('/platform/keys', {
    params: { user_id: userId, page, page_size: 20 },
  });
  return data;
}

export function updatePlatformKey(id: string, body: PlatformKeyUpdate) {
  return api.put(`/platform/keys/${id}`, body);
}

// 吊销不可逆：高危操作，前端必须走 ConfirmDialog
export function revokePlatformKey(id: string) {
  return api.post(`/platform/keys/${id}/revoke`);
}

export const fetchPlatformWallet = async (userId: string): Promise<PlatformWalletDetail> =>
  (await api.get<PlatformWalletDetail>(`/platform/wallets/${userId}`)).data;

export function topupPlatformWallet(userId: string, body: { amount_micro: number; note: string }) {
  return api.post(`/platform/wallets/${userId}/topup`, body);
}

export async function fetchPlatformRequests(
  f: PlatformRequestFilter,
  page: number,
): Promise<Page<PlatformRequestRow>> {
  const { data } = await api.get<Page<PlatformRequestRow>>('/platform/requests', {
    params: {
      model: f.model || undefined,
      status: f.status || undefined,
      user_id: f.user_id || undefined,
      page,
      page_size: 20,
    },
  });
  return data;
}

export const fetchPlatformUsage = async (days: number): Promise<PlatformUsage> =>
  (await api.get<PlatformUsage>('/platform/usage', { params: { days } })).data;

// ===== 上游厂商密钥 =====
// 密钥仅以 AES-256-GCM 密文存库，接口只返回掩码 key_hint。

export type VendorTestResult = 'valid' | 'invalid_key' | 'unreachable';

export interface VendorCredential {
  vendor: string;
  display_name: string;
  env_var: string;
  base_url: string;
  configured: boolean;
  key_hint: string | null;
  status: string | null;
  updated_at: number | null;
  updated_by: string | null;
  last_test_at: number | null;
  last_test_result: VendorTestResult | null;
  last_test_message: string | null;
}

export interface VendorSaveResult {
  ok: boolean;
  vendor: string;
  key_hint: string;
  updated_at: number;
}

export interface VendorTestResponse {
  ok: boolean;
  result: VendorTestResult;
  message: string;
}

export async function fetchPlatformVendors(): Promise<{ items: VendorCredential[] }> {
  const { data } = await api.get<{ items: VendorCredential[] }>('/platform/vendors');
  return data;
}

// 保存会重写 LiteLLM 环境文件并重启上游服务（约 2-3 秒中断）
export async function saveVendorCredential(vendor: string, apiKey: string): Promise<VendorSaveResult> {
  const { data } = await api.put<VendorSaveResult>(
    `/platform/vendors/${encodeURIComponent(vendor)}`,
    { api_key: apiKey },
  );
  return data;
}

// 传入 api_key 测试新值；不传则测试库内已保存的密钥
export async function testVendorCredential(
  vendor: string,
  apiKey?: string,
): Promise<VendorTestResponse> {
  const { data } = await api.post<VendorTestResponse>(
    `/platform/vendors/${encodeURIComponent(vendor)}/test`,
    apiKey ? { api_key: apiKey } : {},
  );
  return data;
}

// ===== 形象工坊 =====
// 读写都经 BFF 代理到 openelf-api 内部运营接口；imageUrl/thumbUrl/sheetUrl
// 已由 BFF 拼成绝对地址（OPS_ASSET_BASE_URL），前端直接用作 img src / 下载链接。

export type CharacterRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CharacterPartStatus = 'enabled' | 'disabled';

export interface CharacterPart {
  id: string;
  name: string;
  slot: string;
  weight: number;
  rarity: CharacterRarity;
  status: CharacterPartStatus;
}

export interface CharacterSlot {
  slot: string;
  label: string;
  parts: CharacterPart[];
}

export interface CharacterSlots {
  slots: CharacterSlot[];
  comboSpace: number;
}

export interface CharacterBatchItem {
  index: number;
  seed: number;
  compositionHash: string;
  imageUrl?: string;
  thumbUrl?: string;
  traits?: Record<string, string>;
  rarityScore?: number;
  rarityTier?: string;
  error?: string;
}

export interface CharacterBatch {
  id: string;
  batchId?: string;
  name: string;
  style?: string;
  count: number;
  items?: CharacterBatchItem[];
  sheetUrl: string;
  createdAt: number | string;
}

export interface CharacterPartUpdate {
  weight?: number;
  rarity?: CharacterRarity;
  status?: CharacterPartStatus;
}

export const fetchCharacterSlots = async (): Promise<CharacterSlots> =>
  (await api.get<CharacterSlots>('/character/parts')).data;

// 单条配件覆盖：仅 super_admin；保存后以刷新目录为准
export async function updateCharacterPart(id: string, body: CharacterPartUpdate): Promise<void> {
  await api.put(`/character/parts/${encodeURIComponent(id)}`, body);
}

// 上游可能返回 { items } 或 { batches }，这里统一成数组
export async function fetchCharacterBatches(limit = 20): Promise<CharacterBatch[]> {
  const { data } = await api.get<{ items?: CharacterBatch[]; batches?: CharacterBatch[] }>(
    '/character/batches',
    { params: { limit } },
  );
  return data.items ?? data.batches ?? [];
}

// 批量渲染较慢：BFF 侧超时 90 秒，这里放宽到 100 秒
export async function createCharacterBatch(body: {
  count: number;
  style: string;
  seedStart?: number;
  name?: string;
}): Promise<CharacterBatch> {
  const { data } = await api.post<CharacterBatch>('/character/batches', body, {
    timeout: 100000,
  });
  return data;
}

export const fetchCharacterBatch = async (id: string): Promise<CharacterBatch> =>
  (await api.get<CharacterBatch>(`/character/batches/${encodeURIComponent(id)}`)).data;

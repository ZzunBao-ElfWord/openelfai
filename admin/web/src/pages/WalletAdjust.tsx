import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustWallet,
  errText,
  fetchWallet,
  type AdjustResult,
  type Wallet,
} from '../api/client';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, Input, PageHeader, Textarea } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

// 调整后预估（仅前端展示，实际以后端为准）：
// 正额先还欠额再入余额；负额超出余额部分记欠额。
function estimate(wallet: Wallet, amount: number): { balance: number; debt: number } {
  if (amount >= 0) {
    const repay = Math.min(amount, wallet.refund_debt);
    return { balance: wallet.diamonds + (amount - repay), debt: wallet.refund_debt - repay };
  }
  const deduct = -amount;
  if (deduct <= wallet.diamonds) {
    return { balance: wallet.diamonds - deduct, debt: wallet.refund_debt };
  }
  return { balance: 0, debt: wallet.refund_debt + (deduct - wallet.diamonds) };
}

export default function WalletAdjust() {
  const { env } = useEnv();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<AdjustResult | null>(null);
  // 幂等键：同一张表单重复提交/网络重试共用，成功后换新
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());

  const walletQuery = useQuery({
    queryKey: ['wallet-preview', previewId, env],
    queryFn: () => fetchWallet(previewId, env),
    enabled: !!previewId,
  });

  const amountNum = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum !== 0;
  const wallet = walletQuery.data;
  const preview = wallet && amountValid ? estimate(wallet, amountNum) : null;

  const mutation = useMutation({
    mutationFn: () =>
      adjustWallet({
        user_id: userId.trim(),
        environment: env,
        amount: amountNum,
        note: note.trim(),
        client_token: clientToken,
      }),
    onSuccess: (data) => {
      setResult(data);
      setConfirmOpen(false);
      setClientToken(crypto.randomUUID());
      setPreviewId(userId.trim());
      void queryClient.invalidateQueries({ queryKey: ['wallet-preview', userId.trim(), env] });
    },
  });

  function submit() {
    setResult(null);
    setConfirmOpen(true);
  }

  const canSubmit = !!userId.trim() && amountValid && !!note.trim() && !mutation.isPending;

  return (
    <div>
      <PageHeader
        title="余额调整"
        desc="高危操作：直接变更用户钻石余额，全部记录审计日志；金额单位为钻石（10 钻石 = 1 元）"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">调整表单</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              submit();
            }}
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">用户 ID</label>
              <div className="flex gap-2">
                <Input
                  className="w-full"
                  placeholder="目标用户的完整 ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!userId.trim() || walletQuery.isFetching}
                  onClick={() => setPreviewId(userId.trim())}
                >
                  {walletQuery.isFetching ? '查询中…' : '查询余额'}
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">环境</label>
              <div>
                <Badge tone={env === 'Production' ? 'blue' : 'amber'}>
                  {env === 'Production' ? '生产环境' : '沙箱环境'}
                </Badge>
                <span className="ml-2 text-xs text-gray-400">在顶栏切换环境</span>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                调整金额（钻石，可为负数）
              </label>
              <Input
                type="number"
                step="1"
                className="w-full"
                placeholder="如 100 或 -50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {amount.trim() !== '' && !amountValid ? (
                <div className="mt-1 text-xs text-red-600">金额必须为非零数字</div>
              ) : null}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">备注（必填）</label>
              <Textarea
                className="w-full"
                placeholder="调整原因，将写入流水与审计日志"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end">
              <Button variant="danger" type="submit" disabled={!canSubmit}>
                提交调整
              </Button>
            </div>
          </form>
          {mutation.error ? (
            <div className="mt-3 text-sm text-red-600">{errText(mutation.error, '调整失败')}</div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">当前钱包</h2>
            {!previewId ? (
              <div className="py-4 text-center text-sm text-gray-400">
                输入用户 ID 并点击「查询余额」
              </div>
            ) : walletQuery.isLoading || walletQuery.isFetching ? (
              <div className="py-4 text-center text-sm text-gray-400">查询中…</div>
            ) : walletQuery.error ? (
              <div className="py-4 text-sm text-red-600">
                {errText(walletQuery.error, '钱包查询失败')}
              </div>
            ) : wallet ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-gray-500">钻石余额</span>
                  <span className="text-xl font-semibold tabular-nums text-gray-900">
                    {wallet.diamonds}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-gray-500">退款欠额</span>
                  <span
                    className={`text-xl font-semibold tabular-nums ${
                      wallet.refund_debt > 0 ? 'text-red-600' : 'text-gray-900'
                    }`}
                  >
                    {wallet.refund_debt}
                  </span>
                </div>
                {preview ? (
                  <div className="rounded-lg bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
                    调整后预估：余额 <b>{preview.balance}</b> 钻石，欠额 <b>{preview.debt}</b> 钻石
                    <br />
                    <span className="text-blue-500">
                      正额先还欠额再入余额；负额超出余额部分记欠额（预估仅供参考，以后端为准）
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          {result ? (
            result.duplicated ? (
              <Card className="border-amber-200 bg-amber-50 p-6 ring-amber-200">
                <div className="text-sm font-medium text-amber-800">
                  幂等重复，未重复入账（event_id：{result.event_id}）
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <h2 className="mb-3 text-sm font-semibold text-green-700">调整成功</h2>
                <div className="space-y-1.5 text-sm text-gray-600">
                  <div>
                    事件 ID：<span className="font-mono text-xs">{result.event_id}</span>
                  </div>
                  <div>
                    最新余额：<b className="tabular-nums">{result.wallet.diamonds}</b> 钻石；欠额：
                    <b className="tabular-nums">{result.wallet.refund_debt}</b> 钻石
                  </div>
                </div>
              </Card>
            )
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="确认提交余额调整？"
        description={
          <span>
            用户：<b className="font-mono text-xs">{userId.trim()}</b>
            <br />
            环境：{env === 'Production' ? '生产环境' : '沙箱环境'}
            <br />
            调整金额：<b className={amountNum >= 0 ? 'text-green-600' : 'text-red-600'}>
              {amountNum >= 0 ? `+${amountNum}` : amountNum}
            </b>{' '}
            钻石
            {wallet && preview ? (
              <>
                <br />
                当前余额 {wallet.diamonds} / 欠额 {wallet.refund_debt} → 调整后预估余额{' '}
                <b>{preview.balance}</b> / 欠额 <b>{preview.debt}</b>
              </>
            ) : null}
            <br />
            该操作立即生效并记录审计日志。
          </span>
        }
        confirmText="确认调整"
        loading={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}

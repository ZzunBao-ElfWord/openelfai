import type { ReactNode } from 'react';
import { Button } from './primitives';

interface Props {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

// 全站唯一的高危操作确认组件。封禁/删除/调账/状态修正必须使用。
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认执行',
  cancelText = '取消',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: Props) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onCancel}
    >
      <div
        className="card w-full max-w-md p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description ? (
          <div className="mt-2 text-sm leading-6 text-gray-500">{description}</div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? '执行中…' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

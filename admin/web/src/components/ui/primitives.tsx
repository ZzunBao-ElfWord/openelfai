import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClass: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${variantClass[variant]} ${className}`} {...rest} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`input ${className}`} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`input ${className}`} rows={3} {...rest} />;
}

export function Card({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

type Tone = 'gray' | 'red' | 'amber' | 'green' | 'blue';

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge-${tone}`}>{children}</span>;
}

export function PageHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      {desc ? <p className="mt-1 text-sm text-gray-500">{desc}</p> : null}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-gray-400">{text}</div>;
}

// 通用弹层（只读详情、表单类）；高危确认仍必须用 ConfirmDialog。
export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className={`card w-full ${width} max-h-[85vh] overflow-y-auto p-6`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button className="text-lg leading-none text-gray-400 hover:text-gray-600" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

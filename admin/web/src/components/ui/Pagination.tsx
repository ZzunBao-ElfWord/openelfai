import { Button } from './primitives';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

// 统一分页条：总条数不足一页时不渲染
export default function Pagination({ page, total, pageSize, onChange }: Props) {
  const pages = Math.ceil(total / pageSize);
  if (total <= pageSize) {
    return null;
  }
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-gray-500">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <span>
        第 {page} 页 / 共 {pages} 页
      </span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
    </div>
  );
}

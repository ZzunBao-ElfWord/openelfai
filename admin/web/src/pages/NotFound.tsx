import { Link } from 'react-router-dom';
import { Button } from '../components/ui/primitives';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50">
      <div className="text-4xl font-bold text-gray-300">404</div>
      <div className="text-sm text-gray-500">页面不存在或无权访问</div>
      <Link to="/">
        <Button variant="primary">返回首页</Button>
      </Link>
    </div>
  );
}

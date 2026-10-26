import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input } from '../components/ui/primitives';
import { errText } from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/');
    } catch (err) {
      setError(errText(err, '登录失败'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold text-blue-600">OpenElf</div>
          <div className="mt-1 text-sm text-gray-500">管理后台</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">用户名</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="后台账号"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="至少 10 位"
              required
            />
          </div>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <Button variant="primary" type="submit" className="w-full" disabled={loading}>
            {loading ? '登录中…' : '登 录'}
          </Button>
        </form>
      </div>
    </div>
  );
}

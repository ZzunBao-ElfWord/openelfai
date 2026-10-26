import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../api/client';

// 登录闸门（无角色限制）：包在 AdminLayout 外层。
export function ProtectedRoute() {
  const { me, initializing } = useAuth();
  if (initializing) {
    return <FullPageLoading />;
  }
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

// 角色闸门：每个需要特定角色的页面单独包一层（前端体验层，后端另有 RBAC 兜底）。
export function RoleGate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { me } = useAuth();
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(me.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
      加载中…
    </div>
  );
}

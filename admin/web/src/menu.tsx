import type { ReactNode } from 'react';
import type { Role } from './api/client';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Elves from './pages/Elves';
import ElfDetail from './pages/ElfDetail';
import OfficialElf from './pages/OfficialElf';
import Orders from './pages/Orders';
import Ledger from './pages/Ledger';
import Catalog from './pages/Catalog';
import AppLegalDocs from './pages/AppLegalDocs';
import AppCopyConfig from './pages/AppCopyConfig';
import PlatformModels from './pages/PlatformModels';
import PlatformVendors from './pages/PlatformVendors';
import PlatformDevelopers from './pages/PlatformDevelopers';
import PlatformRequests from './pages/PlatformRequests';
import ModerationReports from './pages/ModerationReports';
import WalletAdjust from './pages/WalletAdjust';
import Audit from './pages/Audit';
import System from './pages/System';
import AdminAccounts from './pages/AdminAccounts';

// 全站唯一的菜单 + 路由清单。
// 新增页面时在此登记：路径、标题、图标、可见角色、页面组件。
// 注意：这里的 roles 只是菜单/前端路由层（体验层），真正的权限闸门在后端。
export interface MenuItem {
  path: string;
  label: string;
  glyph: string;
  roles: Role[];
  element: ReactNode;
  /** 侧边栏分组标题 */
  group?: string;
  /** 详情页等不进侧边栏、仅注册路由的条目 */
  hidden?: boolean;
}

const all: Role[] = ['super_admin', 'moderator', 'operator'];
const mods: Role[] = ['super_admin', 'moderator'];
const ops: Role[] = ['super_admin', 'operator'];

export const menuItems: MenuItem[] = [
  {
    path: '/',
    group: '概览',
    label: '数据看板',
    glyph: '📊',
    roles: all,
    element: <Dashboard />,
  },
  {
    path: '/users',
    group: '运营',
    label: '用户管理',
    glyph: '👥',
    roles: mods,
    element: <Users />,
  },
  {
    path: '/users/:id',
    group: '运营',
    label: '用户详情',
    glyph: '👤',
    roles: mods,
    element: <UserDetail />,
    hidden: true,
  },
  {
    path: '/elves',
    group: '运营',
    label: 'AI 精灵',
    glyph: '🧝',
    roles: mods,
    element: <Elves />,
  },
  {
    path: '/elves/:id',
    group: '运营',
    label: 'AI 精灵详情',
    glyph: '🔍',
    roles: mods,
    element: <ElfDetail />,
    hidden: true,
  },
  {
    path: '/elves/official',
    group: '运营',
    label: '官方 AI 运营',
    glyph: '🐋',
    roles: ['super_admin'],
    element: <OfficialElf />,
  },
  {
    path: '/orders',
    group: '运营',
    label: '订单管理',
    glyph: '🧾',
    roles: mods,
    element: <Orders />,
  },
  {
    path: '/ledger',
    group: '运营',
    label: '钻石流水',
    glyph: '💎',
    roles: mods,
    element: <Ledger />,
  },
  {
    path: '/catalog',
    group: '运营',
    label: '能力包目录',
    glyph: '📦',
    roles: mods,
    element: <Catalog />,
  },
  {
    path: '/moderation/reports',
    group: '内容审核',
    label: '举报审核',
    glyph: '🚨',
    roles: ['super_admin', 'moderator'],
    element: <ModerationReports />,
  },
  {
    path: '/content/legal',
    group: '运营配置',
    label: '法律与政策',
    glyph: '📜',
    roles: mods,
    element: <AppLegalDocs />,
  },
  {
    path: '/content/app',
    group: '运营配置',
    label: '应用文案与开关',
    glyph: '✍️',
    roles: mods,
    element: <AppCopyConfig />,
  },
  {
    path: '/platform/vendors',
    group: '开放平台',
    label: '上游厂商',
    glyph: '🔌',
    roles: mods,
    element: <PlatformVendors />,
  },
  {
    path: '/platform/models',
    group: '开放平台',
    label: '模型与价格',
    glyph: '💹',
    roles: mods,
    element: <PlatformModels />,
  },
  {
    path: '/platform/developers',
    group: '开放平台',
    label: '开发者与 Key',
    glyph: '🔑',
    roles: mods,
    element: <PlatformDevelopers />,
  },
  {
    path: '/platform/requests',
    group: '开放平台',
    label: '调用日志',
    glyph: '📈',
    roles: mods,
    element: <PlatformRequests />,
  },
  {
    path: '/wallet/adjust',
    group: '财务',
    label: '余额调整',
    glyph: '⚖️',
    roles: ['super_admin'],
    element: <WalletAdjust />,
  },
  {
    path: '/audit',
    group: '系统',
    label: '审计日志',
    glyph: '📋',
    roles: ops,
    element: <Audit />,
  },
  {
    path: '/system',
    group: '系统',
    label: '系统健康',
    glyph: '🩺',
    roles: ops,
    element: <System />,
  },
  {
    path: '/settings',
    group: '系统',
    label: '后台账号',
    glyph: '⚙️',
    roles: ['super_admin'],
    element: <AdminAccounts />,
  },
];

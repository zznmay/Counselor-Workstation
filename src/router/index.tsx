import BasicLayout from '@/layouts/BasicLayout';
import AdminLogs from '@/pages/admin/logs';
import AdminUsers from '@/pages/admin/users';
import Approvals from '@/pages/approvals';
import Conversations from '@/pages/conversations';
import Dashboard from '@/pages/dashboard';
import Login from '@/pages/login';
import Notices from '@/pages/notices';
import Students from '@/pages/students';
import Templates from '@/pages/templates';
import TodoList from '@/pages/todos';
import ToolRunner from '@/pages/tools/ToolRunner';
import ToolsIndex from '@/pages/tools';
import Warnings from '@/pages/warnings';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { getToken } from '@/lib/auth';

/** 路由守卫：未登录统一跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * 路由表：登录页独立于工作台布局；业务页面全部挂在 BasicLayout 下。
 * 实用工具由注册表（pages/tools/registry.tsx）驱动：
 *   /tools          工具广场（统一入口）
 *   /tools/:toolKey 工具运行页（iframe 内嵌），新增工具无需改路由
 */
export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <BasicLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'students', element: <Students /> },
      { path: 'conversations', element: <Conversations /> },
      { path: 'warnings', element: <Warnings /> },
      { path: 'notices', element: <Notices /> },
      { path: 'approvals', element: <Approvals /> },
      { path: 'todos', element: <TodoList /> },
      { path: 'templates', element: <Templates /> },
      { path: 'tools', element: <ToolsIndex /> },
      { path: 'tools/:toolKey', element: <ToolRunner /> },
      { path: 'admin/users', element: <AdminUsers /> },
      { path: 'admin/logs', element: <AdminLogs /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

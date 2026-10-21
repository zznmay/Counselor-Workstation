import BasicLayout from '@/layouts/BasicLayout';
import AdminLogs from '@/pages/admin/logs';
import AdminRoles from '@/pages/admin/roles';
import AdminUsers from '@/pages/admin/users';
/* 数据管理（备份 / 恢复 / 迁移）：系统管理菜单第 4 项，与用户/角色/日志同为管理员专属 */
import AdminData from '@/pages/admin/data';
import Classes from '@/pages/classes';
import Grades from '@/pages/classes/grades';
import Conversations from '@/pages/conversations';
import Dashboard from '@/pages/dashboard';
import Dormitories from '@/pages/dormitories';
import Forbidden from '@/pages/forbidden';
import Login from '@/pages/login';
import Mental from '@/pages/mental';
import MorePage from '@/pages/more';
import Students from '@/pages/students';
import StudentDetailMobile from '@/pages/students/mobileDetail';
import Templates from '@/pages/templates';
import TodoList from '@/pages/todos';
import ToolRunner from '@/pages/tools/ToolRunner';
import ToolsIndex from '@/pages/tools';
import Warnings from '@/pages/warnings';
import { Navigate, createBrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { canAccessModule, getStoredUser, getToken, isSystemAdmin } from '@/lib/auth';

/** 路由守卫：未登录统一跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * 模块守卫：与服务端 requirePermission 同口径。
 * 权限来自本地会话（登录/首次 /auth/me 写入），角色权限变更后由 BasicLayout 刷新并即时收敛。
 */
function RequireModule({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  if (!canAccessModule(getStoredUser(), moduleKey)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

/** 系统管理守卫：用户/角色/日志始终仅系统管理员可访问（含多角色集合） */
function RequireAdmin({ children }: { children: ReactNode }) {
  if (!isSystemAdmin(getStoredUser())) return <Navigate to="/forbidden" replace />;
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
      { index: true, element: <RequireModule moduleKey="dashboard"><Dashboard /></RequireModule> },
      { path: 'students', element: <RequireModule moduleKey="students"><Students /></RequireModule> },
      /* 移动端学生详情走全屏页（替代桌面端弹窗）；桌面端仍从列表弹窗进入 */
      { path: 'students/:id', element: <RequireModule moduleKey="students"><StudentDetailMobile /></RequireModule> },
      /* 移动端底部导航第 5 项「更多」收纳页 */
      { path: 'more', element: <MorePage /> },
      { path: 'conversations', element: <RequireModule moduleKey="conversations"><Conversations /></RequireModule> },
      { path: 'warnings', element: <RequireModule moduleKey="warnings"><Warnings /></RequireModule> },
      { path: 'mental', element: <RequireModule moduleKey="mentalHealth"><Mental /></RequireModule> },
      { path: 'todos', element: <RequireModule moduleKey="todos"><TodoList /></RequireModule> },
      { path: 'templates', element: <RequireModule moduleKey="templates"><Templates /></RequireModule> },
      { path: 'tools', element: <RequireModule moduleKey="tools"><ToolsIndex /></RequireModule> },
      { path: 'tools/:toolKey', element: <RequireModule moduleKey="tools"><ToolRunner /></RequireModule> },
      { path: 'classes', element: <RequireModule moduleKey="classes"><Classes /></RequireModule> },
      { path: 'classes/grades', element: <RequireModule moduleKey="classes"><Grades /></RequireModule> },
      { path: 'dormitories', element: <RequireModule moduleKey="dormitories"><Dormitories /></RequireModule> },
      { path: 'admin/users', element: <RequireAdmin><AdminUsers /></RequireAdmin> },
      { path: 'admin/roles', element: <RequireAdmin><AdminRoles /></RequireAdmin> },
      { path: 'admin/logs', element: <RequireAdmin><AdminLogs /></RequireAdmin> },
      { path: 'admin/data', element: <RequireAdmin><AdminData /></RequireAdmin> },
      { path: 'forbidden', element: <Forbidden /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

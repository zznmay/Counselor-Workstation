import { Navigate, createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import RouteFallback from '@/components/RouteFallback';
import { canAccessModule, getStoredUser, getToken, isSystemAdmin } from '@/lib/auth';
import { tryDemoLogin } from '@/lib/demoLogin';
import RouteError from '@/pages/routeError';

/**
 * 路由级按需加载：登录页、工作台外壳与业务页面各自成 chunk。
 * 首屏只解析路由表与守卫，不把 antd / xlsx / 各业务页打进同一个包。
 */
const Login = lazy(() => import('@/pages/login'));
const WorkbenchShell = lazy(() => import('@/layouts/WorkbenchShell'));

const Dashboard = lazy(() => import('@/pages/dashboard'));
const Students = lazy(() => import('@/pages/students'));
const StudentDetailMobile = lazy(() => import('@/pages/students/mobileDetail'));
const MorePage = lazy(() => import('@/pages/more'));
const Conversations = lazy(() => import('@/pages/conversations'));
const Warnings = lazy(() => import('@/pages/warnings'));
const Mental = lazy(() => import('@/pages/mental'));
const TodoList = lazy(() => import('@/pages/todos'));
const Funding = lazy(() => import('@/pages/funding'));
const Templates = lazy(() => import('@/pages/templates'));
const ToolsIndex = lazy(() => import('@/pages/tools'));
const ToolRunner = lazy(() => import('@/pages/tools/ToolRunner'));
const Classes = lazy(() => import('@/pages/classes'));
const Grades = lazy(() => import('@/pages/classes/grades'));
const Dormitories = lazy(() => import('@/pages/dormitories'));
const AdminUsers = lazy(() => import('@/pages/admin/users'));
const AdminRoles = lazy(() => import('@/pages/admin/roles'));
const AdminLogs = lazy(() => import('@/pages/admin/logs'));
const AdminData = lazy(() => import('@/pages/admin/data'));
const Forbidden = lazy(() => import('@/pages/forbidden'));

/** 页面级加载兜底：只替换内容区，侧边栏/顶栏保持可用 */
function page(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

/**
 * 路由守卫：未登录时先尝试演示登录（体验部署 WORKBENCH_DEMO=1 下免口令直通），
 * 失败则跳转常规登录页。演示请求进行中展示整页加载态，避免闪烁跳转。
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const [demoReady, setDemoReady] = useState(false);
  useEffect(() => {
    if (getToken()) return; // 已有会话：直接渲染，不做任何请求
    let cancelled = false;
    tryDemoLogin().finally(() => {
      if (!cancelled) setDemoReady(true);
    });
    return () => { cancelled = true; };
  }, []);
  if (!getToken()) {
    if (!demoReady) return <RouteFallback full />; // 演示登录尝试中
    return <Navigate to="/login" replace />;
  }
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
  {
    path: '/login',
    element: <Suspense fallback={<RouteFallback full />}><Login /></Suspense>,
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Suspense fallback={<RouteFallback full />}>
          <WorkbenchShell />
        </Suspense>
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RequireModule moduleKey="dashboard">{page(<Dashboard />)}</RequireModule> },
      { path: 'students', element: <RequireModule moduleKey="students">{page(<Students />)}</RequireModule> },
      /* 移动端学生详情走全屏页（替代桌面端弹窗）；桌面端仍从列表弹窗进入 */
      { path: 'students/:id', element: <RequireModule moduleKey="students">{page(<StudentDetailMobile />)}</RequireModule> },
      /* 移动端底部导航第 5 项「更多」收纳页 */
      { path: 'more', element: page(<MorePage />) },
      { path: 'conversations', element: <RequireModule moduleKey="conversations">{page(<Conversations />)}</RequireModule> },
      { path: 'warnings', element: <RequireModule moduleKey="warnings">{page(<Warnings />)}</RequireModule> },
      { path: 'mental', element: <RequireModule moduleKey="mentalHealth">{page(<Mental />)}</RequireModule> },
      { path: 'todos', element: <RequireModule moduleKey="todos">{page(<TodoList />)}</RequireModule> },
      { path: 'funding', element: <RequireModule moduleKey="funding">{page(<Funding />)}</RequireModule> },
      { path: 'templates', element: <RequireModule moduleKey="templates">{page(<Templates />)}</RequireModule> },
      { path: 'tools', element: <RequireModule moduleKey="tools">{page(<ToolsIndex />)}</RequireModule> },
      { path: 'tools/:toolKey', element: <RequireModule moduleKey="tools">{page(<ToolRunner />)}</RequireModule> },
      { path: 'classes', element: <RequireModule moduleKey="classes">{page(<Classes />)}</RequireModule> },
      { path: 'classes/grades', element: <RequireModule moduleKey="classes">{page(<Grades />)}</RequireModule> },
      { path: 'dormitories', element: <RequireModule moduleKey="dormitories">{page(<Dormitories />)}</RequireModule> },
      { path: 'admin/users', element: <RequireAdmin>{page(<AdminUsers />)}</RequireAdmin> },
      { path: 'admin/roles', element: <RequireAdmin>{page(<AdminRoles />)}</RequireAdmin> },
      { path: 'admin/logs', element: <RequireAdmin>{page(<AdminLogs />)}</RequireAdmin> },
      { path: 'admin/data', element: <RequireAdmin>{page(<AdminData />)}</RequireAdmin> },
      { path: 'forbidden', element: page(<Forbidden />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

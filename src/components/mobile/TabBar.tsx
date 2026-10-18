import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import { canAccessModule, getStoredUser } from '@/lib/auth';
import type { MIconName } from './icons';
import { MIcon } from './icons';

interface TabItem {
  key: string;
  label: string;
  icon: MIconName;
  /** 角标来源：与桌面端 BasicLayout 保持一致 */
  badge?: 'warnings' | 'approvals' | 'todos';
  /** 所属模块；未配置表示始终展示（如「更多」） */
  module?: string;
}

/** 底部导航：4 常驻 + 1 更多（硬约束 ≤5）。第 4 槽为待办提醒，审批中心在「更多」首位 */
const TABS: TabItem[] = [
  { key: '/', label: '工作台', icon: 'grid4', module: 'dashboard' },
  { key: '/students', label: '学生名册', icon: 'users', module: 'students' },
  { key: '/warnings', label: '预警管理', icon: 'triangle', badge: 'warnings', module: 'warnings' },
  { key: '/todos', label: '待办提醒', icon: 'checksq', badge: 'todos', module: 'todos' },
  { key: '/more', label: '更多', icon: 'grid', badge: 'approvals' },
];

export default function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({ warnings: 0, approvals: 0, todos: 0 });
  const user = getStoredUser();
  const canDashboard = canAccessModule(user, 'dashboard');
  const tabs = TABS.filter((tab) => !tab.module || canAccessModule(user, tab.module));

  // 角标：与桌面端同源（切换页面时刷新；无工作台权限时不请求）
  useEffect(() => {
    if (!canDashboard) {
      setBadges({ warnings: 0, approvals: 0, todos: 0 });
      return undefined;
    }
    let alive = true;
    getDashboardStats()
      .then((stats) => {
        if (!alive) return;
        setBadges({
          warnings: stats.pendingWarningCount,
          approvals: stats.pendingApprovalCount,
          todos: stats.todayTodoCount,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [location.pathname, canDashboard]);

  const activeKey = tabs.some((t) => t.key === location.pathname)
    ? location.pathname
    : tabs.some((t) => location.pathname.startsWith(`${t.key}/`))
      ? tabs.find((t) => location.pathname.startsWith(`${t.key}/`))!.key
      : '';

  return (
    <nav className="m-tabbar" aria-label="底部导航">
      {tabs.map((tab) => {
        const count = tab.badge ? badges[tab.badge] : 0;
        return (
          <button
            key={tab.key}
            type="button"
            className={`m-tab${activeKey === tab.key ? ' on' : ''}`}
            aria-current={activeKey === tab.key ? 'page' : undefined}
            onClick={() => navigate(tab.key)}
          >
            <MIcon name={tab.icon} size={22} />
            {tab.label}
            {count > 0 && <span className="m-badge">{count > 99 ? '99+' : count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

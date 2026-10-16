import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import type { MIconName } from './icons';
import { MIcon } from './icons';

interface TabItem {
  key: string;
  label: string;
  icon: MIconName;
  /** 角标来源：与桌面端 BasicLayout 保持一致 */
  badge?: 'warnings' | 'approvals' | 'todos';
}

/** 底部导航：4 常驻 + 1 更多（硬约束 ≤5）。第 4 槽为待办提醒，审批中心在「更多」首位 */
const TABS: TabItem[] = [
  { key: '/', label: '工作台', icon: 'grid4' },
  { key: '/students', label: '学生管理', icon: 'users' },
  { key: '/warnings', label: '预警管理', icon: 'triangle', badge: 'warnings' },
  { key: '/todos', label: '待办提醒', icon: 'checksq', badge: 'todos' },
  { key: '/more', label: '更多', icon: 'grid', badge: 'approvals' },
];

export default function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({ warnings: 0, approvals: 0, todos: 0 });

  // 角标：与桌面端同源（切换页面时刷新，保证及时性）
  useEffect(() => {
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
  }, [location.pathname]);

  const activeKey = TABS.some((t) => t.key === location.pathname)
    ? location.pathname
    : TABS.some((t) => location.pathname.startsWith(`${t.key}/`))
      ? TABS.find((t) => location.pathname.startsWith(`${t.key}/`))!.key
      : '';

  return (
    <nav className="m-tabbar" aria-label="底部导航">
      {TABS.map((tab) => {
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

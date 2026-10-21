import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { getDashboardStats } from '@/api/dashboard';
import { MIcon } from '@/components/mobile/icons';
import type { MIconName } from '@/components/mobile/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import { canAccessModule, clearAuth, getStoredUser, isSystemAdmin } from '@/lib/auth';

interface MoreItem {
  key: string;
  label: string;
  icon: MIconName;
  /** 所属模块；未配置表示登录即可访问 */
  module?: string;
  adminOnly?: boolean;
  /** 宫格角标来源：与底部 Tab 栏角标同源（切换页面时刷新） */
  badge?: 'warnings';
}

/** 底部导航收纳页：装不下的功能按「业务 / 资料 / 系统」分组呈现 */
const BUSINESS: MoreItem[] = [
  { key: '/conversations', label: '谈心谈话', icon: 'comment', module: 'conversations' },
  /* 预警管理：2026-10-20 由底部 Tab 下撤为二级入口（路由与页面行为不变），角标随之迁移 */
  { key: '/warnings', label: '预警管理', icon: 'triangle', badge: 'warnings', module: 'warnings' },
];

const RESOURCES: MoreItem[] = [
  { key: '/templates', label: '模板汇总库', icon: 'file', module: 'templates' },
  { key: '/tools', label: '实用工具', icon: 'tool', module: 'tools' },
];

const SYSTEM: MoreItem[] = [
  { key: '/classes', label: '班级管理', icon: 'school', module: 'classes' },
  { key: '/dormitories', label: '寝室管理', icon: 'home', module: 'dormitories' },
  { key: '/admin/users', label: '用户管理', icon: 'users', adminOnly: true },
  { key: '/admin/roles', label: '角色管理', icon: 'shield', adminOnly: true },
  { key: '/admin/logs', label: '访问日志', icon: 'clock', adminOnly: true },
];

/**
 * 「更多」页：移动端第 5 个 Tab。
 * 入口按「角色权限 + 是否管理员」过滤。
 */
export default function MorePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const user = getStoredUser();
  const isAdmin = isSystemAdmin(user);
  const roleLabel = user?.roleName ?? (isAdmin ? '管理员' : '辅导员');

  /* 待处理预警角标：预警管理下撤后，原底部 Tab 的角标迁移到此处（与 TabBar 同源、同口径） */
  const [warningCount, setWarningCount] = useState(0);
  const canWarnings = canAccessModule(user, 'warnings');
  useEffect(() => {
    if (!isMobile || !canWarnings) return undefined;
    let alive = true;
    getDashboardStats()
      .then((stats) => {
        if (alive) setWarningCount(stats.pendingWarningCount);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [location.pathname, canWarnings, isMobile]);

  /* 「更多」是移动端专属页；桌面端有完整侧边菜单，直接回工作台 */
  if (!isMobile) return <Navigate to="/" replace />;

  const renderGroup = (title: string, items: MoreItem[]) => {
    const visible = items.filter(
      (i) => (!i.adminOnly || isAdmin) && (!i.module || canAccessModule(user, i.module)),
    );
    if (visible.length === 0) return null;
    return (
      <div className="m-card" key={title}>
        <div className="m-sec-head">
          <span className="m-sec-title">{title}</span>
        </div>
        <div className="m-grid">
          {visible.map((item) => {
            const count = item.badge === 'warnings' ? warningCount : 0;
            return (
              <button key={item.key} type="button" className="m-gcell" onClick={() => navigate(item.key)} aria-label={item.label}>
                <span className="m-gcell-wrap">
                  <MIcon name={item.icon} size={24} />
                  {count > 0 && <span className="m-gbadge m-badge">{count > 99 ? '99+' : count}</span>}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const groups: MoreItem[][] = [BUSINESS, RESOURCES, SYSTEM];
  const hasAnyEntry = groups.some((items) =>
    items.some((i) => (!i.adminOnly || isAdmin) && (!i.module || canAccessModule(user, i.module))),
  );

  return (
    <>
      <div className="m-detail-head">
        <span className="m-ava" style={{ width: 52, height: 52, borderRadius: 14, fontSize: 20 }}>
          {(user?.displayName || '老').slice(0, 1)}
        </span>
        <div className="m-row-main">
          <div className="m-t1" style={{ fontSize: 17 }}>{user?.displayName || '老师'}</div>
          <div className="m-t4" style={{ marginTop: 3 }}>
            {roleLabel} · {user?.username}
          </div>
        </div>
        <button
          type="button"
          className="m-btn m-btn-ghost"
          onClick={() => {
            clearAuth();
            navigate('/login', { replace: true });
          }}
        >
          <MIcon name="logout" size={16} />
          退出
        </button>
      </div>

      {renderGroup('业务办理', BUSINESS)}
      {renderGroup('资料与工具', RESOURCES)}
      {renderGroup('系统管理', SYSTEM)}

      {/* 权限极窄的角色（如仅心理健康）：所有分组都被过滤掉时给出说明，避免空白页 */}
      {!hasAnyEntry && (
        <div className="m-card empty">
          <MIcon name="grid" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>当前角色暂无更多功能入口</div>
          <div className="m-t4" style={{ marginTop: 4 }}>
            已开放的模块可直接从底部导航栏进入
          </div>
        </div>
      )}

      <div className="m-t4" style={{ textAlign: 'center', padding: '4px 0 8px' }}>
        知行辅导员工作台（内网版）
      </div>
    </>
  );
}

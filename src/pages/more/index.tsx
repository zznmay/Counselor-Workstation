import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import { MIcon } from '@/components/mobile/icons';
import type { MIconName } from '@/components/mobile/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import { clearAuth, getStoredUser } from '@/lib/auth';

interface MoreItem {
  key: string;
  label: string;
  icon: MIconName;
  adminOnly?: boolean;
  badge?: 'approvals';
}

/** 底部导航收纳页：装不下的功能按「业务 / 资料 / 系统」分组呈现 */
const BUSINESS: MoreItem[] = [
  { key: '/approvals', label: '审批中心', icon: 'file', badge: 'approvals' },
  { key: '/conversations', label: '谈心谈话', icon: 'comment' },
  { key: '/notices', label: '通知发布', icon: 'bell' },
];

const RESOURCES: MoreItem[] = [
  { key: '/templates', label: '模板汇总库', icon: 'file' },
  { key: '/tools', label: '实用工具', icon: 'tool' },
];

const SYSTEM: MoreItem[] = [
  { key: '/admin/users', label: '用户管理', icon: 'users', adminOnly: true },
  { key: '/admin/logs', label: '访问日志', icon: 'shield', adminOnly: true },
];

/**
 * 「更多」页：移动端第 5 个 Tab。
 * 管理员专属入口按 role 过滤；审批中心带角标且排在业务组首位。
 */
export default function MorePage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const user = getStoredUser();
  const isAdmin = user?.role === 'admin';
  const [approvalCount, setApprovalCount] = useState(0);

  useEffect(() => {
    if (!isMobile) return;
    getDashboardStats()
      .then((s) => setApprovalCount(s.pendingApprovalCount))
      .catch(() => undefined);
  }, [isMobile]);

  /* 「更多」是移动端专属页；桌面端有完整侧边菜单，直接回工作台 */
  if (!isMobile) return <Navigate to="/" replace />;

  const renderGroup = (title: string, items: MoreItem[]) => {
    const visible = items.filter((i) => !i.adminOnly || isAdmin);
    if (visible.length === 0) return null;
    return (
      <div className="m-card" key={title}>
        <div className="m-sec-head">
          <span className="m-sec-title">{title}</span>
        </div>
        <div className="m-grid">
          {visible.map((item) => (
            <button key={item.key} type="button" className="m-gcell" onClick={() => navigate(item.key)} aria-label={item.label}>
              <span className="m-gcell-wrap">
                <MIcon name={item.icon} size={24} />
                {item.badge === 'approvals' && approvalCount > 0 && (
                  <span className="m-badge" style={{ top: -6, left: '100%', marginLeft: -6 }}>
                    {approvalCount > 99 ? '99+' : approvalCount}
                  </span>
                )}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="m-detail-head">
        <span className="m-ava" style={{ width: 52, height: 52, borderRadius: 14, fontSize: 20 }}>
          {(user?.displayName || '老').slice(0, 1)}
        </span>
        <div className="m-row-main">
          <div className="m-t1" style={{ fontSize: 17 }}>{user?.displayName || '老师'}</div>
          <div className="m-t4" style={{ marginTop: 3 }}>
            {isAdmin ? '管理员' : '辅导员'} · {user?.username}
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

      <div className="m-t4" style={{ textAlign: 'center', padding: '4px 0 8px' }}>
        知行辅导员工作台（内网版）
      </div>
    </>
  );
}

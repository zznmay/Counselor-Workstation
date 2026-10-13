import {
  AlertOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  CheckSquareOutlined,
  CommentOutlined,
  DashboardOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuOutlined,
  NotificationOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { App, Avatar, Badge, Dropdown, Drawer, Layout, Menu } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import { useIsMobile } from '@/hooks/useIsMobile';
import DailyGreeting from '@/components/DailyGreeting';
import ProfileModal from '@/components/ProfileModal';
import { TOOLS } from '@/pages/tools/registry';
import { clearAuth, getStoredUser, setStoredUser } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';
import {
  hasGreetedToday,
  markGreetedToday,
  pickEncouragement,
  pickGreetingEmoji,
} from '@/utils/profile';
import type { UserProfile } from '@/utils/profile';
import type { MenuProps } from 'antd';
import type { ReactNode } from 'react';

const { Sider, Header, Content } = Layout;

const TITLES: Record<string, string> = {
  '/': '工作台',
  '/students': '学生信息管理',
  '/conversations': '谈心谈话记录',
  '/warnings': '学业与心理预警',
  '/notices': '通知发布',
  '/approvals': '审批中心',
  '/todos': '待办提醒',
  '/templates': '申请表模板汇总库',
  '/tools': '实用工具',
  '/admin/users': '用户管理',
  '/admin/logs': '访问日志',
};

/** 侧边菜单 + 顶栏 + 内容区；桌面端固定侧边栏，移动端抽屉式导航 */
export default function BasicLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { message, modal } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [badges, setBadges] = useState({ warnings: 0, approvals: 0, todos: 0 });

  /* ---------- 称呼信息与每日问候 ---------- */
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getStoredUser());
  const [profileModal, setProfileModal] = useState<{ open: boolean; isFirst: boolean }>({
    open: false,
    isFirst: false,
  });
  const [greeting, setGreeting] = useState<{ open: boolean; text: string; emoji: string }>({
    open: false,
    text: '',
    emoji: '☀️',
  });

  // 每天首次打开弹出问候（同一天内不重复）；称呼未设置时先引导
  useEffect(() => {
    if (!hasGreetedToday()) {
      setGreeting({ open: true, text: pickEncouragement(), emoji: pickGreetingEmoji() });
      markGreetedToday();
    }
  }, []);

  /** 称呼修改：同步到服务端账号（displayName）并更新本地会话 */
  const handleSaveProfile = (next: UserProfile) => {
    import('@/api/request').then(({ request }) =>
      request<AuthUser>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: next.realName }),
      }),
    ).then((user) => {
      setStoredUser(user);
      setAuthUser(user);
      localStorage.setItem('workbench_nickname', JSON.stringify(next.nickname ?? ''));
      setProfileModal({ open: false, isFirst: false });
      message.success('称呼信息已保存');
      if (!hasGreetedToday()) {
        setGreeting({ open: true, text: pickEncouragement(), emoji: pickGreetingEmoji() });
        markGreetedToday();
      }
    }).catch(() => message.error('称呼保存失败，请稍后重试'));
  };

  const nickname = (() => {
    try {
      return JSON.parse(localStorage.getItem('workbench_nickname') ?? '""') as string;
    } catch {
      return '';
    }
  })();
  const shownName = nickname || authUser?.displayName || '老师';

  const handleLogout = () => {
    modal.confirm({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      okText: '退出',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        clearAuth();
        navigate('/login', { replace: true });
      },
    });
  };

  // 徽标数：未解除预警 / 待审批 / 今日待办（切换页面时刷新，保证及时性）
  useEffect(() => {
    getDashboardStats()
      .then((stats) =>
        setBadges({
          warnings: stats.pendingWarningCount,
          approvals: stats.pendingApprovalCount,
          todos: stats.todayTodoCount,
        }),
      )
      .catch(() => undefined);
  }, [location.pathname]);

  const withBadge = (text: string, count: number): ReactNode =>
    count > 0 ? (
      <span>
        {text}
        <Badge count={count} size="small" style={{ marginLeft: 8 }} />
      </span>
    ) : (
      text
    );

  const menuItems: MenuProps['items'] = useMemo(
    () => [
      { key: '/', icon: <DashboardOutlined />, label: '工作台' },
      { key: '/students', icon: <TeamOutlined />, label: '学生管理' },
      { key: '/conversations', icon: <CommentOutlined />, label: '谈心谈话' },
      { key: '/warnings', icon: <AlertOutlined />, label: withBadge('预警管理', badges.warnings) },
      { key: '/notices', icon: <NotificationOutlined />, label: '通知发布' },
      { key: '/approvals', icon: <AuditOutlined />, label: withBadge('审批中心', badges.approvals) },
      { key: '/todos', icon: <CheckSquareOutlined />, label: withBadge('待办提醒', badges.todos) },
      { key: '/templates', icon: <FolderOpenOutlined />, label: '模板汇总库' },
      {
        key: '/tools',
        icon: <ToolOutlined />,
        label: '实用工具',
        children: [
          { key: '/tools', icon: <AppstoreOutlined />, label: '工具广场' },
          ...TOOLS.map((tool) => ({
            key: tool.path,
            icon: <tool.icon />,
            label: tool.title,
          })),
        ],
      },
      ...(authUser?.role === 'admin'
        ? [
            {
              key: '/admin',
              icon: <SettingOutlined />,
              label: '系统管理',
              children: [
                { key: '/admin/users', icon: <TeamOutlined />, label: '用户管理' },
                { key: '/admin/logs', icon: <AuditOutlined />, label: '访问日志' },
              ],
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [badges],
  );

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
    setMobileOpen(false);
  };

  const renderMenu = (mode: 'inline' | 'vertical') => (
    <Menu
      theme="light"
      mode={mode}
      items={menuItems}
      selectedKeys={[location.pathname]}
      defaultOpenKeys={
        ['tools', 'admin'].filter((prefix) => location.pathname.startsWith(`/${prefix}`))
          .map((prefix) => `/${prefix}`)
      }
      onClick={handleMenuClick}
    />
  );

  const tool = TOOLS.find((t) => t.path === location.pathname);
  const title = TITLES[location.pathname] ?? tool?.title ?? '辅导员工作台';
  const totalAlert = badges.warnings + badges.approvals + badges.todos;
  const roleLabel = authUser?.role === 'admin' ? '管理员' : '辅导员';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          className="app-sider"
          theme="light"
          width={224}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
        >
          <div className="sider-logo">
            <span className="logo-badge">杭</span>
            {!collapsed && <span>杭科院 · 辅导员工作台</span>}
          </div>
          {renderMenu('inline')}
        </Sider>
      )}
      <Layout>
        <Header className="app-header">
          {isMobile && (
            <MenuOutlined className="header-trigger" onClick={() => setMobileOpen(true)} />
          )}
          <div className="header-title">{title}</div>
          <div className="header-right">
            <Badge count={totalAlert} size="small" offset={[2, -2]}>
              <BellOutlined style={{ fontSize: 18, color: 'rgba(0,0,0,0.65)' }} />
            </Badge>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'edit', icon: <EditOutlined />, label: '修改称呼信息' },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'edit') setProfileModal({ open: true, isFirst: false });
                  if (key === 'logout') handleLogout();
                },
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                title="点击修改称呼或退出登录"
              >
                <Avatar style={{ background: 'var(--app-primary)' }}>{shownName.charAt(0)}</Avatar>
                <span className="user-name">{shownName} · {roleLabel}</span>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
      <Drawer
        title="杭科院 · 辅导员工作台"
        placement="left"
        width={248}
        open={isMobile && mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        {renderMenu('vertical')}
      </Drawer>

      {/* 称呼信息修改 */}
      <ProfileModal
        open={profileModal.open}
        isFirst={profileModal.isFirst}
        initial={authUser ? { realName: authUser.displayName } : null}
        onSave={handleSaveProfile}
        onClose={() => setProfileModal({ open: false, isFirst: false })}
      />

      {/* 每日问候 */}
      <DailyGreeting
        open={greeting.open}
        name={shownName}
        encouragement={greeting.text}
        emoji={greeting.emoji}
        onClose={() => setGreeting((g) => ({ ...g, open: false }))}
        onEdit={() => {
          setGreeting((g) => ({ ...g, open: false }));
          setProfileModal({ open: true, isFirst: false });
        }}
      />
    </Layout>
  );
}

/**
 * 可配置权限的模块注册表（前端唯一数据源）。
 * 与 `server/lib/modules.js` 保持同序同名；新增业务模块时两端同步。
 *
 * 系统管理（用户/角色/日志）不在列表内：始终仅 `admin` 角色可访问。
 */
export interface AppModule {
  key: string;
  name: string;
  group: string;
  /** false = 功能级权限，不承载菜单，也不可设为主负责（默认 true） */
  ownerable?: boolean;
}

export const APP_MODULES: AppModule[] = [
  { key: 'dashboard', name: '工作台', group: '业务办理' },
  { key: 'students', name: '学生名册', group: '业务办理' },
  { key: 'conversations', name: '谈心谈话', group: '业务办理' },
  { key: 'warnings', name: '预警管理', group: '业务办理' },
  { key: 'mentalHealth', name: '心理健康', group: '业务办理' },
  { key: 'mentalInterview', name: '心理访谈', group: '业务办理', ownerable: false },
  { key: 'todos', name: '待办提醒', group: '业务办理' },
  { key: 'templates', name: '模板汇总库', group: '资料与工具' },
  { key: 'tools', name: '实用工具', group: '资料与工具' },
  { key: 'classes', name: '班级管理', group: '基础数据' },
  { key: 'dormitories', name: '寝室管理', group: '基础数据' },
];

export const MODULE_GROUPS = ['业务办理', '资料与工具', '基础数据'] as const;

export const MODULE_NAME: Record<string, string> = Object.fromEntries(
  APP_MODULES.map((m) => [m.key, m.name]),
);

/** 模块 → 默认落地路由（登录后 / 无权限跳转用） */
export const MODULE_HOME: Record<string, string> = {
  dashboard: '/',
  students: '/students',
  conversations: '/conversations',
  warnings: '/warnings',
  mentalHealth: '/mental',
  mentalInterview: '/mental',
  todos: '/todos',
  templates: '/templates',
  tools: '/tools',
  classes: '/classes',
  dormitories: '/dormitories',
};

/** 当前路径所属模块；系统管理路由返回 admin.* 标记，用于权限刷新后的即时跳转 */
export function moduleForPath(pathname: string): string | null {
  if (pathname === '/') return 'dashboard';
  if (pathname.startsWith('/students')) return 'students';
  if (pathname.startsWith('/conversations')) return 'conversations';
  if (pathname.startsWith('/warnings')) return 'warnings';
  if (pathname.startsWith('/mental')) return 'mentalHealth';
  if (pathname.startsWith('/todos')) return 'todos';
  if (pathname.startsWith('/templates')) return 'templates';
  if (pathname.startsWith('/tools')) return 'tools';
  if (pathname.startsWith('/classes')) return 'classes';
  if (pathname.startsWith('/dormitories')) return 'dormitories';
  if (pathname.startsWith('/admin/users')) return 'admin.users';
  if (pathname.startsWith('/admin/roles')) return 'admin.roles';
  if (pathname.startsWith('/admin/logs')) return 'admin.logs';
  if (pathname.startsWith('/admin/data')) return 'admin.data';
  return null;
}

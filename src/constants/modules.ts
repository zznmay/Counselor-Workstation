/**
 * 可配置权限的模块注册表（前端唯一数据源）。
 * 与 `server/lib/modules.js` 保持同序同名；新增业务模块时两端同步。
 *
 * 系统管理（用户/角色/日志）不在列表内：始终仅 `admin` 角色可访问。
 *
 * 三级结构与约定（与服务端一致）：
 * - 模块：`permissions` 存模块 key，控制菜单/路由可见；
 * - 页面：模块内路由级页面；`gated: true` 的页面有独立访问权（权限键 `module:page-<key>`）；
 * - 操作：页面内写操作，权限键 `module:<actionKey>`；`module:*` 通配该模块全部操作
 *   （自动继承后续新增操作）。现状即「仅管理员/仅主负责」的高危操作不进注册表。
 * - scopeable 模块支持数据范围配置（all=全量查看/导出，managed=仅带班；写操作仍按带班收口）。
 */
export interface ModuleAction {
  key: string;
  name: string;
}

export interface ModulePage {
  key: string;
  name: string;
  /** gated 页面需独立授权（module:page-<key>），如班级管理下的年级管理页 */
  gated?: boolean;
  actions: ModuleAction[];
}

export interface AppModule {
  key: string;
  name: string;
  group: string;
  /** false = 功能级权限，不承载菜单，也不可设为主负责（默认 true） */
  ownerable?: boolean;
  /** true = 支持数据范围配置（全量/带班） */
  scopeable?: boolean;
  pages: ModulePage[];
}

export const APP_MODULES: AppModule[] = [
  { key: 'dashboard', name: '工作台', group: '业务办理', pages: [{ key: 'main', name: '工作台概览页', actions: [] }] },
  {
    key: 'students',
    name: '学生名册',
    group: '业务办理',
    scopeable: true,
    pages: [{
      key: 'main',
      name: '学生名册页',
      actions: [
        { key: 'create', name: '新增学生' },
        { key: 'edit', name: '编辑学生' },
        { key: 'delete', name: '删除学生' },
        { key: 'import', name: '批量导入' },
        { key: 'export', name: '批量导出' },
      ],
    }],
  },
  {
    key: 'conversations',
    name: '谈心谈话',
    group: '业务办理',
    scopeable: true,
    pages: [{
      key: 'main',
      name: '谈话记录页',
      actions: [
        { key: 'create', name: '新增谈话' },
        { key: 'edit', name: '编辑谈话' },
        { key: 'delete', name: '删除谈话' },
      ],
    }],
  },
  {
    key: 'warnings',
    name: '预警管理',
    group: '业务办理',
    scopeable: true,
    pages: [{
      key: 'main',
      name: '预警列表页',
      actions: [
        { key: 'create', name: '录入预警' },
        { key: 'resolve', name: '处理预警' },
        { key: 'edit', name: '编辑预警' },
        { key: 'delete', name: '删除预警' },
      ],
    }],
  },
  {
    key: 'mentalHealth',
    name: '心理健康',
    group: '业务办理',
    scopeable: true,
    /* 关注标记/导入关注/导出访谈等管理操作随「主负责」开放，不做逐操作勾选 */
    pages: [{ key: 'main', name: '关注列表页', actions: [] }],
  },
  {
    key: 'mentalInterview',
    name: '心理访谈',
    group: '业务办理',
    ownerable: false,
    pages: [{
      key: 'main',
      name: '心理访谈（心理健康页内）',
      actions: [
        { key: 'create', name: '新增访谈' },
        { key: 'edit', name: '编辑访谈' },
        { key: 'void', name: '作废访谈' },
      ],
    }],
  },
  {
    key: 'todos',
    name: '待办提醒',
    group: '业务办理',
    pages: [{
      key: 'main',
      name: '待办列表页',
      actions: [
        { key: 'create', name: '新增待办' },
        { key: 'edit', name: '编辑/完成待办' },
        { key: 'delete', name: '删除待办' },
      ],
    }],
  },
  {
    key: 'funding',
    name: '资助管理',
    group: '业务办理',
    scopeable: true,
    pages: [{
      key: 'main',
      name: '认定名册页',
      actions: [
        { key: 'create', name: '新增认定' },
        { key: 'edit', name: '编辑认定' },
        { key: 'confirm', name: '复核确认' },
        { key: 'cancel', name: '取消认定' },
        { key: 'redo', name: '重新认定' },
        { key: 'batch', name: '批量操作' },
        { key: 'import', name: '批量导入' },
        { key: 'export', name: '导出' },
        { key: 'rollover', name: '学年结转' },
      ],
    }],
  },
  {
    key: 'templates',
    name: '模板汇总库',
    group: '资料与工具',
    pages: [{
      key: 'main',
      name: '模板库页',
      actions: [
        { key: 'upload', name: '上传模板' },
        { key: 'download', name: '下载模板' },
        { key: 'rename', name: '重命名/改说明' },
        { key: 'delete', name: '删除模板' },
      ],
    }],
  },
  { key: 'tools', name: '实用工具', group: '资料与工具', pages: [{ key: 'main', name: '工具广场', actions: [] }] },
  {
    key: 'classes',
    name: '班级管理',
    group: '基础数据',
    pages: [
      {
        key: 'main',
        name: '班级管理页',
        actions: [
          { key: 'create', name: '新增班级' },
          { key: 'edit', name: '编辑班级' },
          { key: 'delete', name: '删除班级' },
          { key: 'import', name: '导入班级名单' },
          { key: 'syncStaff', name: '待同步人员建号' },
        ],
      },
      {
        key: 'grades',
        name: '年级管理页',
        gated: true,
        actions: [
          { key: 'gradeCreate', name: '新增年级' },
          { key: 'gradeEdit', name: '编辑年级' },
          { key: 'gradeDelete', name: '删除年级' },
        ],
      },
    ],
  },
  {
    key: 'dormitories',
    name: '寝室管理',
    group: '基础数据',
    scopeable: true,
    pages: [{
      key: 'main',
      name: '寝室分配页',
      actions: [
        { key: 'create', name: '新增分配' },
        { key: 'edit', name: '编辑分配' },
        { key: 'delete', name: '删除分配' },
        { key: 'export', name: '批量导出' },
      ],
    }],
  },
];

export const MODULE_GROUPS = ['业务办理', '资料与工具', '基础数据'] as const;

export const MODULE_NAME: Record<string, string> = Object.fromEntries(
  APP_MODULES.map((m) => [m.key, m.name]),
);

/** 各模块的模块级元信息索引 */
export const MODULE_INDEX: Record<string, AppModule> = Object.fromEntries(
  APP_MODULES.map((m) => [m.key, m]),
);

/** 各模块全部操作（跨页面展平，含 gated 页面访问键） */
export const ACTIONS_OF_MODULE: Record<string, string[]> = Object.fromEntries(
  APP_MODULES.map((m) => {
    const keys: string[] = [];
    for (const page of m.pages) {
      if (page.gated) keys.push(`page-${page.key}`);
      for (const a of page.actions) keys.push(a.key);
    }
    return [m.key, keys];
  }),
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
  funding: '/funding',
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
  if (pathname.startsWith('/funding')) return 'funding';
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

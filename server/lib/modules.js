/**
 * 可配置权限的模块注册表（服务端唯一数据源）。
 * 与前端 `src/constants/modules.ts` 保持同序同名；新增业务模块时两端同步。
 *
 * 说明：系统管理（用户/角色/日志）不在此列表内 —— 它们始终仅 `admin` 角色可访问，
 * 属于系统级能力，不通过角色权限下发，避免越权。
 */
const MODULES = [
  { key: 'dashboard', name: '工作台', group: '业务办理' },
  { key: 'students', name: '学生名册', group: '业务办理' },
  { key: 'conversations', name: '谈心谈话', group: '业务办理' },
  { key: 'warnings', name: '预警管理', group: '业务办理' },
  { key: 'mentalHealth', name: '心理健康', group: '业务办理' },
  /* 心理访谈：功能级权限，不承载菜单/路由（入口在心理健康页行内） */
  { key: 'mentalInterview', name: '心理访谈', group: '业务办理', ownerable: false },
  { key: 'todos', name: '待办提醒', group: '业务办理' },
  { key: 'templates', name: '模板汇总库', group: '资料与工具' },
  { key: 'tools', name: '实用工具', group: '资料与工具' },
  { key: 'classes', name: '班级管理', group: '基础数据' },
];

const MODULE_KEYS = MODULES.map((m) => m.key);

/** 可设为主负责的模块（ownerable:false 的功能级权限不参与「主负责」配置） */
const OWNERABLE_MODULE_KEYS = MODULES.filter((m) => m.ownerable !== false).map((m) => m.key);

/** 内置「班主任」角色：查看心理健康 + 填写心理访谈 */
const HEAD_TEACHER_DEFAULT_KEYS = ['mentalHealth', 'mentalInterview'];

/** 内置「辅导员」角色的默认权限：与角色化改造前的可见范围保持一致（随新模块扩充） */
const COUNSELOR_DEFAULT_KEYS = [
  'dashboard', 'students', 'conversations', 'warnings', 'mentalHealth', 'todos', 'templates', 'tools',
];

/**
 * 角色化改造时的初始默认集（不含后加模块）。
 * 老库升级时：counselor 角色权限若仍与该集合完全一致（管理员未自定义过），
 * 则自动补上新增模块；一旦管理员调整过权限则保持不动。
 */
const COUNSELOR_LEGACY_KEYS = [
  'dashboard', 'students', 'conversations', 'warnings', 'todos', 'templates', 'tools',
];

module.exports = {
  MODULES,
  MODULE_KEYS,
  OWNERABLE_MODULE_KEYS,
  HEAD_TEACHER_DEFAULT_KEYS,
  COUNSELOR_DEFAULT_KEYS,
  COUNSELOR_LEGACY_KEYS,
};

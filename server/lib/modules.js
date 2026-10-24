/**
 * 可配置权限的模块注册表（服务端唯一数据源）。
 * 与前端 `src/constants/modules.ts` 保持同序同名；新增业务模块时两端同步。
 *
 * 说明：系统管理（用户/角色/日志/数据）不在此列表内 —— 它们始终仅 `admin` 角色可访问，
 * 属于系统级能力，不通过角色权限下发，避免越权。
 *
 * 三级结构与约定：
 * - 模块（module）：业务模块，`permissions` 存模块 key，控制菜单/路由可见；
 * - 页面（page）：模块内的路由级页面。大多数模块单页；`gated: true` 的页面
 *   （如班级管理下的「年级管理页」）有独立访问权，权限键为 `module:page-<key>`；
 * - 操作（action）：页面内的写操作，权限键为 `module:<actionKey>`。
 *   角色的 `actions` 数组存上述键；`module:*` 表示该模块全部操作（含后续新增的操作，
 *   自动继承）；精确键列表则表示按勾选明细生效。现状即「仅管理员 / 仅主负责」的
 *   高危操作（如名册批量删除、模板类别管理、心理关注标记）不进注册表，保持原门禁。
 *
 * 数据范围（scopeable: true 的模块支持在角色上配置 dataScopes）：
 * - 'all'     全量数据（查看/导出覆盖全院学生；写操作仍按带班收口）；
 * - 'managed' 仅带班数据（所辖班级，classCounselors），未配置的模块默认该口径。
 * todos 恒为本人数据、模板/工具/班级为全员共享字典、dashboard 范围由来源模块派生，均不配置。
 */
const MODULES = [
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
    /* 关注标记/导入关注/导出访谈等管理操作随「主负责」开放（现状 owner 门禁），不做逐操作勾选 */
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

const MODULE_KEYS = MODULES.map((m) => m.key);

/** 可设为主负责的模块（ownerable:false 的功能级权限不参与「主负责」配置） */
const OWNERABLE_MODULE_KEYS = MODULES.filter((m) => m.ownerable !== false).map((m) => m.key);

/** 支持数据范围配置（全量/带班）的模块 */
const SCOPEABLE_MODULE_KEYS = MODULES.filter((m) => m.scopeable === true).map((m) => m.key);

/** 各模块页面索引（moduleKey → pages，含 gated 标记），供页面级访问判定使用 */
const PAGES_OF_MODULE = Object.fromEntries(MODULES.map((m) => [m.key, m.pages ?? []]));

/** 各模块全部合法操作键（含 `module:*`、`module:page-<key>` 与 `module:<actionKey>`） */
const ACTIONS_OF_MODULE = {};
for (const m of MODULES) {
  const keys = ['*'];
  for (const page of m.pages ?? []) {
    if (page.gated) keys.push(`page-${page.key}`);
    for (const a of page.actions ?? []) keys.push(a.key);
  }
  ACTIONS_OF_MODULE[m.key] = keys;
}

/** 内置「班主任」角色：查看心理健康 + 填写心理访谈 */
const HEAD_TEACHER_DEFAULT_KEYS = ['mentalHealth', 'mentalInterview'];

/** 内置「辅导员」角色的默认权限：与角色化改造前的可见范围保持一致（随新模块扩充） */
const COUNSELOR_DEFAULT_KEYS = [
  'dashboard', 'students', 'conversations', 'warnings', 'mentalHealth', 'todos', 'funding',
  'templates', 'tools', 'dormitories',
];

/**
 * 角色化改造时的初始默认集（不含后加模块）。
 * 老库升级时：counselor 角色权限若仍与该集合完全一致（管理员未自定义过），
 * 则自动补上新增模块；一旦管理员调整过权限则保持不动。
 */
const COUNSELOR_LEGACY_KEYS = [
  'dashboard', 'students', 'conversations', 'warnings', 'todos', 'templates', 'tools',
];

/** 内置角色的默认操作权限：模块全选（`module:*`，自动继承后续新增操作） */
const COUNSELOR_DEFAULT_ACTIONS = COUNSELOR_DEFAULT_KEYS.map((k) => `${k}:*`);
const HEAD_TEACHER_DEFAULT_ACTIONS = HEAD_TEACHER_DEFAULT_KEYS.map((k) => `${k}:*`);

/**
 * 内置「辅导员」角色的默认数据范围：名册/寝室全量（对应角色化前的名册口径放行），
 * 谈话/预警/心理/资助按带班（未配置即默认 managed，这里显式写出便于播种与展示）。
 */
const COUNSELOR_DEFAULT_SCOPES = {
  students: 'all',
  dormitories: 'all',
  conversations: 'managed',
  warnings: 'managed',
  mentalHealth: 'managed',
  funding: 'managed',
};

/** 自定义角色标识不可占用的保留 key（内置角色 + 演示角色） */
const RESERVED_ROLE_KEYS = ['admin', 'counselor', 'headTeacher', 'demo'];

/** 自定义角色标识格式：小写字母开头，2-30 位小写字母/数字/下划线 */
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,29}$/;

module.exports = {
  MODULES,
  MODULE_KEYS,
  OWNERABLE_MODULE_KEYS,
  SCOPEABLE_MODULE_KEYS,
  PAGES_OF_MODULE,
  ACTIONS_OF_MODULE,
  HEAD_TEACHER_DEFAULT_KEYS,
  COUNSELOR_DEFAULT_KEYS,
  COUNSELOR_LEGACY_KEYS,
  COUNSELOR_DEFAULT_ACTIONS,
  HEAD_TEACHER_DEFAULT_ACTIONS,
  COUNSELOR_DEFAULT_SCOPES,
  RESERVED_ROLE_KEYS,
  ROLE_KEY_PATTERN,
};

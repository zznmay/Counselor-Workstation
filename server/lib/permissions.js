/**
 * 角色权限解析与校验（服务端唯一判定口径）。
 *
 * 多角色模型：users.role 为「主角色」（角色集合含 admin 时主角色即 admin），
 * userRoles 表为完整角色集合。有效权限 = 所有角色权限的并集（取最高）。
 *
 * 判定规则：
 * - 用户角色集合含 `admin`（或主角色为 admin）→ 系统管理员，全部权限（['*']）；
 * - 其他用户：并集包含目标模块 key 即放行；
 * - 操作权限（actions）：模块可访问前提下，任一角色含 `module:*` → 该模块全部操作
 *   （自动继承后续新增操作），否则按 `module:<actionKey>` 精确键并集判定；
 * - 数据范围（dataScopes）：管理员或该模块主负责 → 全量；否则任一角色配 'all' → 全量，
 *   未配置一律按带班（managed）；
 * - 角色被删除或停用（disabled=1）时该角色贡献空权限（停用即时收回授权，不删除分配关系）。
 *
 * 实时性：authMiddleware 每次请求都从数据库重新读取用户与角色集合，因此
 * 角色权限修改、用户角色调整、角色停用在下一次请求即生效，无需重新登录。
 */
const dbx = require('./db');
const {
  MODULE_KEYS,
  OWNERABLE_MODULE_KEYS,
  SCOPEABLE_MODULE_KEYS,
  PAGES_OF_MODULE,
  ACTIONS_OF_MODULE,
} = require('./modules');

/** 解析权限 JSON（容错：脏数据按空数组处理） */
function parsePermissions(raw) {
  try {
    const arr = JSON.parse(raw ?? '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((k) => typeof k === 'string');
  } catch {
    return [];
  }
}

/** 解析数据范围 JSON（容错：脏数据按空对象处理） */
function parseDataScopes(raw) {
  try {
    const obj = JSON.parse(raw ?? '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch {
    return {};
  }
}

/** 角色行（按 key）；含 disabled 供启停用判定 */
function roleByKey(key) {
  if (!key) return null;
  return dbx.get('SELECT * FROM roles WHERE key = ?', [key]);
}

/** 角色的权限列表；admin 恒为 ['*']；角色不存在或已停用 → [] */
function permissionsOfRole(roleKey) {
  if (roleKey === 'admin') return ['*'];
  const role = roleByKey(roleKey);
  if (!role || role.disabled) return [];
  return parsePermissions(role.permissions);
}

/** 用户角色集合（userRoles 表；无记录时回退主角色，兼容未回填数据） */
function roleKeysOfUser(user) {
  if (Array.isArray(user?.roleKeys) && user.roleKeys.length > 0) return user.roleKeys;
  return user?.role ? [user.role] : [];
}

/** 按 userId 查角色集合（登录会话/列表输出用） */
function roleKeysOfUserId(userId) {
  return dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [userId]).map((r) => r.roleKey);
}

/** 系统管理员判定：主角色为 admin，或角色集合包含 admin */
function isSystemAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.roleKeys) && user.roleKeys.includes('admin');
}

/** 用户的有效权限 = 所有角色权限的并集；含 admin 角色则为 ['*'] */
function permissionsOfUser(user) {
  if (!user) return [];
  const keys = roleKeysOfUser(user);
  if (keys.includes('admin')) return ['*'];
  const union = new Set();
  for (const key of keys) {
    for (const perm of permissionsOfRole(key)) union.add(perm);
  }
  if (union.has('*')) return ['*'];
  return MODULE_KEYS.filter((k) => union.has(k)); // 按注册表顺序稳定输出
}

/** 是否可访问某模块 */
function hasPermission(user, moduleKey) {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const perms = permissionsOfUser(user);
  return perms.includes('*') || perms.includes(moduleKey);
}

/** Express 中间件：按模块拦截（需在 authMiddleware 之后使用） */
function requirePermission(moduleKey) {
  return (req, res, next) => {
    if (hasPermission(req.user, moduleKey)) return next();
    res.status(403).json({ message: '当前角色无权访问该模块，请联系管理员调整权限' });
  };
}

/** 角色的操作权限列表；admin 恒为 ['*']；角色不存在或已停用 → [] */
function actionsOfRole(roleKey) {
  if (roleKey === 'admin') return ['*'];
  const role = roleByKey(roleKey);
  if (!role || role.disabled) return [];
  return parsePermissions(role.actions);
}

/** 用户的有效操作权限 = 所有角色 actions 的并集（紧凑形式，含 `module:*` 通配）；admin 为 ['*'] */
function actionsOfUser(user) {
  if (!user) return [];
  const keys = roleKeysOfUser(user);
  if (keys.includes('admin')) return ['*'];
  const union = new Set();
  for (const key of keys) {
    for (const a of actionsOfRole(key)) union.add(a);
  }
  if (union.has('*')) return ['*'];
  return [...union];
}

/**
 * 操作权限判定：模块可访问 + 操作键命中。
 * 操作键为 `module:<actionKey>`；`module:*` 通配该模块全部操作。
 * 未勾选任何操作 = 只读角色（模块可访问但无写操作），是有意支持的状态。
 */
function hasAction(user, moduleKey, actionKey) {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  if (!hasPermission(user, moduleKey)) return false;
  const acts = actionsOfUser(user);
  if (acts.includes('*')) return true;
  return acts.includes(`${moduleKey}:*`) || acts.includes(`${moduleKey}:${actionKey}`);
}

/** Express 中间件：按操作拦截（需在 requirePermission 之后或模块已放行时使用） */
function requireAction(moduleKey, actionKey) {
  return (req, res, next) => {
    if (hasAction(req.user, moduleKey, actionKey)) return next();
    res.status(403).json({ message: '当前角色无权执行该操作，请联系管理员调整权限' });
  };
}

/** 页面访问判定：模块可访问 + 非 gated 页面直接放行，gated 页面需 `module:page-<key>` 权限 */
function canAccessPage(user, moduleKey, pageKey) {
  if (!user) return false;
  if (!hasPermission(user, moduleKey)) return false;
  const page = (PAGES_OF_MODULE[moduleKey] ?? []).find((p) => p.key === pageKey);
  if (!page || !page.gated) return true;
  return hasAction(user, moduleKey, `page-${pageKey}`);
}

/** Express 中间件：按 gated 页面拦截（如 /classes/grades 年级管理页） */
function requirePage(moduleKey, pageKey) {
  return (req, res, next) => {
    if (canAccessPage(req.user, moduleKey, pageKey)) return next();
    res.status(403).json({ message: '当前角色无权访问该页面，请联系管理员调整权限' });
  };
}

/** 规范化权限数组：去重、仅保留合法模块 key；含非法值返回 null */
function normalizePermissions(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (list.some((k) => !MODULE_KEYS.includes(k))) return null;
  return MODULE_KEYS.filter((k) => list.includes(k)); // 按注册表顺序稳定输出
}

/**
 * 规范化操作权限数组：去重、按注册表白名单校验（`module:*` / `module:page-x` / `module:action`）；
 * 含非法值返回 null。输出按模块注册表顺序稳定排列（通配在前）。
 */
function normalizeActions(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  const byModule = new Map();
  for (const item of list) {
    const sep = item.indexOf(':');
    if (sep <= 0) return null;
    const mod = item.slice(0, sep);
    const act = item.slice(sep + 1);
    if (!MODULE_KEYS.includes(mod)) return null;
    const allowed = ACTIONS_OF_MODULE[mod] ?? [];
    if (!allowed.includes(act)) return null;
    if (!byModule.has(mod)) byModule.set(mod, new Set());
    byModule.get(mod).add(act);
  }
  const out = [];
  for (const mod of MODULE_KEYS) {
    const acts = byModule.get(mod);
    if (!acts) continue;
    if (acts.has('*')) out.push(`${mod}:*`);
    for (const a of acts) if (a !== '*') out.push(`${mod}:${a}`);
  }
  return out;
}

/** 规范化数据范围对象：key 限可配范围的模块、值限 all/managed；含非法值返回 null */
function normalizeDataScopes(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of SCOPEABLE_MODULE_KEYS) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (v !== 'all' && v !== 'managed') return null;
    out[k] = v;
  }
  if (Object.keys(raw).some((k) => !SCOPEABLE_MODULE_KEYS.includes(k))) return null;
  return out;
}

/** 角色的主负责模块列表；admin 恒为全模块（不落库，短路语义） */
function ownerModulesOfRole(roleKey) {
  if (roleKey === 'admin') return [...MODULE_KEYS];
  const role = roleByKey(roleKey);
  if (!role || role.disabled) return [];
  const parsed = parsePermissions(role.ownerModules); // 复用容错解析：脏数据按空数组
  return OWNERABLE_MODULE_KEYS.filter((k) => parsed.includes(k)); // 按注册表顺序稳定输出
}

/** 用户的有效主负责模块 = 所有角色 ownerModules 的并集；含 admin 角色则为全模块 */
function ownerModulesOfUser(user) {
  if (!user) return [];
  const keys = roleKeysOfUser(user);
  if (keys.includes('admin')) return [...MODULE_KEYS];
  const union = new Set();
  for (const key of keys) {
    for (const m of ownerModulesOfRole(key)) union.add(m);
  }
  return MODULE_KEYS.filter((k) => union.has(k)); // 按注册表顺序稳定输出
}

/**
 * 是否某模块的主负责（或管理员）——模块级最高权限的唯一判定口径。
 * 实时性：每次调用现查 roles 表，角色主负责配置改动在下一次请求即生效。
 */
function isModuleOwner(user, moduleKey) {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return ownerModulesOfUser(user).includes(moduleKey);
}

/**
 * 用户在某模块的有效数据范围：
 * - 管理员或该模块主负责 → 'all'（主负责=全院数据+全部管理操作，沿用原语义）；
 * - 否则任一启用角色配置 'all' → 'all'（多角色取最宽）；
 * - 未配置/角色均未涉及 → 'managed'（带班：所辖班级 classCounselors）。
 * 全量仅作用于查看/导出；写操作仍由 canManageStudent 按带班收口。
 */
function dataScopeOfUser(user, moduleKey) {
  if (!user) return 'managed';
  if (isModuleAdminWide(user, moduleKey)) return 'all';
  for (const key of roleKeysOfUser(user)) {
    const role = roleByKey(key);
    if (!role || role.disabled) continue;
    if (parseDataScopes(role.dataScopes)[moduleKey] === 'all') return 'all';
  }
  return 'managed';
}

function isModuleAdminWide(user, moduleKey) {
  return isSystemAdmin(user) || isModuleOwner(user, moduleKey);
}

/** 会话下发用：所有可配范围模块的有效范围快照（前端按钮显隐与提示同源消费） */
function dataScopesOfUser(user) {
  const out = {};
  for (const k of SCOPEABLE_MODULE_KEYS) out[k] = dataScopeOfUser(user, k);
  return out;
}

/** 规范化主负责模块数组：去重、白名单校验（仅 ownerable 模块）；含非法值返回 null */
function normalizeOwnerModules(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (list.some((k) => !OWNERABLE_MODULE_KEYS.includes(k))) return null;
  return OWNERABLE_MODULE_KEYS.filter((k) => list.includes(k)); // 按注册表顺序稳定输出
}

module.exports = {
  parsePermissions,
  parseDataScopes,
  roleByKey,
  roleKeysOfUser,
  roleKeysOfUserId,
  isSystemAdmin,
  permissionsOfRole,
  permissionsOfUser,
  hasPermission,
  requirePermission,
  actionsOfRole,
  actionsOfUser,
  hasAction,
  requireAction,
  canAccessPage,
  requirePage,
  normalizePermissions,
  normalizeActions,
  normalizeDataScopes,
  ownerModulesOfRole,
  ownerModulesOfUser,
  isModuleOwner,
  dataScopeOfUser,
  dataScopesOfUser,
  normalizeOwnerModules,
};

/**
 * 角色权限解析与校验（服务端唯一判定口径）。
 *
 * 多角色模型：users.role 为「主角色」（角色集合含 admin 时主角色即 admin），
 * userRoles 表为完整角色集合。有效模块权限 = 所有角色权限的并集（取最高）。
 *
 * 判定规则：
 * - 用户角色集合含 `admin`（或主角色为 admin）→ 系统管理员，全部权限（['*']）；
 * - 其他用户：并集包含目标模块 key 即放行；
 * - 角色被删除/不存在时该角色贡献空权限。
 *
 * 实时性：authMiddleware 每次请求都从数据库重新读取用户与角色集合，因此
 * 角色权限修改、用户角色调整在下一次请求即生效，无需重新登录。
 */
const dbx = require('./db');
const { MODULE_KEYS, OWNERABLE_MODULE_KEYS } = require('./modules');

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

/** 角色行（按 key） */
function roleByKey(key) {
  if (!key) return null;
  return dbx.get('SELECT * FROM roles WHERE key = ?', [key]);
}

/** 角色的权限列表；admin 恒为 ['*'] */
function permissionsOfRole(roleKey) {
  if (roleKey === 'admin') return ['*'];
  const role = roleByKey(roleKey);
  if (!role) return [];
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

/** 规范化权限数组：去重、仅保留合法模块 key；含非法值返回 null */
function normalizePermissions(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (list.some((k) => !MODULE_KEYS.includes(k))) return null;
  return MODULE_KEYS.filter((k) => list.includes(k)); // 按注册表顺序稳定输出
}

/** 角色的主负责模块列表；admin 恒为全模块（不落库，短路语义） */
function ownerModulesOfRole(roleKey) {
  if (roleKey === 'admin') return [...MODULE_KEYS];
  const role = roleByKey(roleKey);
  if (!role) return [];
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

/** 规范化主负责模块数组：去重、白名单校验（仅 ownerable 模块）；含非法值返回 null */
function normalizeOwnerModules(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (list.some((k) => !OWNERABLE_MODULE_KEYS.includes(k))) return null;
  return OWNERABLE_MODULE_KEYS.filter((k) => list.includes(k)); // 按注册表顺序稳定输出
}

module.exports = {
  parsePermissions,
  roleByKey,
  roleKeysOfUser,
  roleKeysOfUserId,
  isSystemAdmin,
  permissionsOfRole,
  permissionsOfUser,
  hasPermission,
  requirePermission,
  normalizePermissions,
  ownerModulesOfRole,
  ownerModulesOfUser,
  isModuleOwner,
  normalizeOwnerModules,
};

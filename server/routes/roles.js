/**
 * 角色管理：选项全员可取；角色列表与增删改仅管理员。
 * 角色字段：名称/标识（key，创建后不可改）/描述/状态（disabled）/可访问模块（permissions）/
 * 操作权限（actions，`module:*` 通配或 `module:<actionKey>` 精确键）/主负责模块（ownerModules）/
 * 数据范围（dataScopes，scopeable 模块配置 all/managed）。
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const {
  parsePermissions,
  parseDataScopes,
  normalizePermissions,
  normalizeOwnerModules,
  normalizeActions,
  normalizeDataScopes,
} = require('../lib/permissions');
const { RESERVED_ROLE_KEYS, ROLE_KEY_PATTERN } = require('../lib/modules');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 角色选项（用户新增/编辑时的下拉；不含权限明细；带 disabled 供前端停选项标注） */
router.get('/options', (req, res) => {
  res.json(
    dbx.all('SELECT key, name, isSystem, disabled FROM roles ORDER BY isSystem DESC, id')
      .map((r) => ({ key: r.key, name: r.name, isSystem: !!r.isSystem, disabled: !!r.disabled })),
  );
});

router.use(auth.adminOnly);

const LIST_SELECT = `
  SELECT r.*,
    (SELECT COUNT(*) FROM users u WHERE u.role = r.key OR EXISTS (
      SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey = r.key)) AS userCount
  FROM roles r`;

/** 输出结构：permissions/ownerModules/actions 反序列化为数组，dataScopes 反序列化为对象，布尔化 */
function toRole(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    isSystem: !!row.isSystem,
    disabled: !!row.disabled,
    permissions: parsePermissions(row.permissions),
    ownerModules: parsePermissions(row.ownerModules),
    actions: parsePermissions(row.actions),
    dataScopes: parseDataScopes(row.dataScopes),
    userCount: row.userCount ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 主负责模块必须落在该角色可访问模块内（不变量 ownerModules ⊆ permissions） */
function assertSubset(owners, perms) {
  const invalid = owners.filter((k) => !perms.includes(k));
  if (invalid.length > 0) {
    return `主负责模块（${invalid.join('、')}）必须在该角色的可访问模块内`;
  }
  return null;
}

/** 操作权限必须落在可访问模块内（不变量 actions ⊆ permissions） */
function assertActionsSubset(actions, perms) {
  const invalid = [...new Set(actions.map((a) => a.slice(0, a.indexOf(':'))))]
    .filter((m) => !perms.includes(m));
  if (invalid.length > 0) {
    return `操作权限所属模块（${invalid.join('、')}）必须在该角色的可访问模块内，请先勾选对应模块`;
  }
  return null;
}

/** 数据范围必须落在可访问模块内（不变式 dataScopes.keys ⊆ permissions） */
function assertScopesSubset(scopes, perms) {
  const invalid = Object.keys(scopes).filter((k) => !perms.includes(k));
  if (invalid.length > 0) {
    return `数据范围所属模块（${invalid.join('、')}）必须在该角色的可访问模块内，请先勾选对应模块`;
  }
  return null;
}

/** 按收窄后的可访问模块裁剪操作权限与数据范围（未显式传入时静默收回，与 ownerModules 同策略） */
function pruneByPermissions(actions, scopes, perms) {
  return {
    actions: actions.filter((a) => perms.includes(a.slice(0, a.indexOf(':')))),
    scopes: Object.fromEntries(Object.entries(scopes).filter(([k]) => perms.includes(k))),
  };
}

/** 角色列表（含用户数，用于删除护栏提示） */
router.get('/', (req, res) => {
  res.json(dbx.all(`${LIST_SELECT} ORDER BY r.isSystem DESC, r.id`).map(toRole));
});

router.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  if (!name || name.length > 20) return res.status(400).json({ message: '角色名称需为 1-20 个字' });
  if (description.length > 100) return res.status(400).json({ message: '角色描述不可超过 100 个字' });
  if (dbx.get('SELECT 1 FROM roles WHERE name = ?', [name])) {
    return res.status(400).json({ message: `角色「${name}」已存在` });
  }

  // 自定义角色标识：可选；通过校验后与展示名解耦，保证改名不影响已分配用户；创建后不可修改
  const rawKey = String(req.body?.key ?? '').trim();
  let key;
  if (rawKey) {
    if (!ROLE_KEY_PATTERN.test(rawKey)) {
      return res.status(400).json({ message: '角色标识需为 2-30 位小写字母、数字或下划线，且以字母开头' });
    }
    if (RESERVED_ROLE_KEYS.includes(rawKey)) {
      return res.status(400).json({ message: `角色标识「${rawKey}」为系统保留字，请更换` });
    }
    if (dbx.get('SELECT 1 FROM roles WHERE key = ?', [rawKey])) {
      return res.status(400).json({ message: `角色标识「${rawKey}」已存在` });
    }
    key = rawKey;
  } else {
    key = `role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  }

  const permissions = normalizePermissions(req.body?.permissions ?? []);
  if (permissions === null) return res.status(400).json({ message: '权限配置含无效模块，请刷新后重试' });

  // 操作权限：未传时默认「可访问模块 = 全部操作」（module:*），与升级前口径一致
  let actions;
  if (req.body?.actions !== undefined) {
    actions = normalizeActions(req.body.actions);
    if (actions === null) return res.status(400).json({ message: '操作权限配置含无效项，请刷新后重试' });
  } else {
    actions = permissions.map((k) => `${k}:*`);
  }
  const actionsErr = assertActionsSubset(actions, permissions);
  if (actionsErr) return res.status(400).json({ message: actionsErr });

  let dataScopes = normalizeDataScopes(req.body?.dataScopes ?? {});
  if (dataScopes === null) return res.status(400).json({ message: '数据范围配置含无效项，请刷新后重试' });
  const scopesErr = assertScopesSubset(dataScopes, permissions);
  if (scopesErr) return res.status(400).json({ message: scopesErr });

  const ownerModules = normalizeOwnerModules(req.body?.ownerModules ?? []);
  if (ownerModules === null) return res.status(400).json({ message: '主负责模块配置含无效模块，请刷新后重试' });
  const subsetErr = assertSubset(ownerModules, permissions);
  if (subsetErr) return res.status(400).json({ message: subsetErr });

  const now = nowStr();
  const info = dbx.run(
    `INSERT INTO roles (key, name, description, isSystem, permissions, ownerModules, actions, dataScopes, disabled, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?)`,
    [
      key, name, description || null,
      JSON.stringify(permissions), JSON.stringify(ownerModules),
      JSON.stringify(actions), JSON.stringify(dataScopes), now, now,
    ],
  );
  logAccess(
    req,
    `新增角色 ${name}（${permissions.length} 个模块权限，操作 ${actions.length} 项${ownerModules.length ? `，主负责 ${ownerModules.length} 个模块` : ''}）`,
  );
  res.json(toRole(dbx.get(`${LIST_SELECT} WHERE r.id = ?`, [info.lastInsertRowid])));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的角色' });
  const target = dbx.get('SELECT * FROM roles WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '角色不存在' });
  if (target.key === 'admin') {
    return res.status(400).json({ message: '内置系统管理员角色不可修改（始终拥有全部权限）' });
  }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : target.name;
  const description = req.body?.description !== undefined
    ? String(req.body.description).trim()
    : (target.description ?? '');
  if (!name || name.length > 20) return res.status(400).json({ message: '角色名称需为 1-20 个字' });
  if (description.length > 100) return res.status(400).json({ message: '角色描述不可超过 100 个字' });
  if (dbx.get('SELECT 1 FROM roles WHERE name = ? AND id <> ?', [name, id])) {
    return res.status(400).json({ message: `角色「${name}」已存在` });
  }

  let permissions = parsePermissions(target.permissions);
  const permsPassed = req.body?.permissions !== undefined;
  if (permsPassed) {
    const next = normalizePermissions(req.body.permissions);
    if (next === null) return res.status(400).json({ message: '权限配置含无效模块，请刷新后重试' });
    permissions = next;
  }

  // 操作权限：显式传入则校验落库；未传但收窄了 permissions 时静默裁掉不再可访问模块的操作
  let actions = parsePermissions(target.actions);
  if (req.body?.actions !== undefined) {
    const next = normalizeActions(req.body.actions);
    if (next === null) return res.status(400).json({ message: '操作权限配置含无效项，请刷新后重试' });
    actions = next;
  } else if (permsPassed) {
    actions = actions.filter((a) => permissions.includes(a.slice(0, a.indexOf(':'))));
  }
  const actionsErr = assertActionsSubset(actions, permissions);
  if (actionsErr) return res.status(400).json({ message: actionsErr });

  // 数据范围：同策略（显式校验 / 收窄裁剪）
  let dataScopes = parseDataScopes(target.dataScopes);
  if (req.body?.dataScopes !== undefined) {
    const next = normalizeDataScopes(req.body.dataScopes);
    if (next === null) return res.status(400).json({ message: '数据范围配置含无效项，请刷新后重试' });
    dataScopes = next;
  } else if (permsPassed) {
    dataScopes = Object.fromEntries(Object.entries(dataScopes).filter(([k]) => permissions.includes(k)));
  }
  const scopesErr = assertScopesSubset(dataScopes, permissions);
  if (scopesErr) return res.status(400).json({ message: scopesErr });

  // 主负责模块：显式传入则校验落库；未传但收窄了 permissions 时静默收回不再可访问模块的主负责
  let ownerModules = parsePermissions(target.ownerModules);
  if (req.body?.ownerModules !== undefined) {
    const next = normalizeOwnerModules(req.body.ownerModules);
    if (next === null) return res.status(400).json({ message: '主负责模块配置含无效模块，请刷新后重试' });
    const subsetErr = assertSubset(next, permissions); // permissions 此时已是最终值
    if (subsetErr) return res.status(400).json({ message: subsetErr });
    ownerModules = next;
  } else if (permsPassed) {
    ownerModules = ownerModules.filter((k) => permissions.includes(k));
  }

  // 状态：内置 counselor/headTeacher 可停用（即时收回授权）；admin 角色已在上方拦截
  let disabled = target.disabled ? 1 : 0;
  if (req.body?.disabled !== undefined) {
    disabled = req.body.disabled ? 1 : 0;
  }

  dbx.run(
    `UPDATE roles SET name = ?, description = ?, permissions = ?, ownerModules = ?, actions = ?, dataScopes = ?, disabled = ?, updatedAt = ?
     WHERE id = ?`,
    [
      name, description || null,
      JSON.stringify(permissions), JSON.stringify(ownerModules),
      JSON.stringify(actions), JSON.stringify(dataScopes), disabled, nowStr(), id,
    ],
  );
  const statusNote = disabled !== (target.disabled ? 1 : 0) ? `，${disabled ? '停用' : '启用'}` : '';
  logAccess(
    req,
    `修改角色 ${target.name} → ${name}（${permissions.length} 个模块权限，操作 ${actions.length} 项${ownerModules.length ? `，主负责 ${ownerModules.length} 个模块` : ''}${statusNote}）`,
  );
  res.json(toRole(dbx.get(`${LIST_SELECT} WHERE r.id = ?`, [id])));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的角色' });
  const target = dbx.get('SELECT * FROM roles WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '角色不存在' });
  if (target.isSystem) return res.status(400).json({ message: '内置角色不可删除' });

  // 引用计数：主角色或角色集合（userRoles）命中均算在用，防止静默收回多角色用户的权限
  const userCount = dbx.get(
    `SELECT COUNT(*) AS c FROM users WHERE role = ? OR EXISTS (
      SELECT 1 FROM userRoles ur WHERE ur.userId = users.id AND ur.roleKey = ?)`,
    [target.key, target.key],
  ).c;
  if (userCount > 0) {
    return res.status(400).json({
      message: `该角色下仍有 ${userCount} 名用户，请先在「用户管理」中调整这些用户的角色后再删除`,
    });
  }

  dbx.run('DELETE FROM roles WHERE id = ?', [id]);
  logAccess(req, `删除角色 ${target.name}`);
  res.json({ ok: true });
});

module.exports = router;

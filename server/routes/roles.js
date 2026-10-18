/** 角色管理：选项全员可取；角色列表与增删改仅管理员 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { parsePermissions, normalizePermissions } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 角色选项（用户新增/编辑时的下拉；不含权限明细） */
router.get('/options', (req, res) => {
  res.json(dbx.all('SELECT key, name, isSystem FROM roles ORDER BY isSystem DESC, id'));
});

router.use(auth.adminOnly);

const LIST_SELECT = `
  SELECT r.*,
    (SELECT COUNT(*) FROM users u WHERE u.role = r.key OR EXISTS (
      SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey = r.key)) AS userCount
  FROM roles r`;

/** 输出结构：permissions 反序列化为数组，isSystem 转布尔 */
function toRole(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    isSystem: !!row.isSystem,
    permissions: parsePermissions(row.permissions),
    userCount: row.userCount ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
  const permissions = normalizePermissions(req.body?.permissions ?? []);
  if (permissions === null) return res.status(400).json({ message: '权限配置含无效模块，请刷新后重试' });

  // 自定义角色标识：与展示名解耦，保证改名不影响已分配用户
  const key = `role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const now = nowStr();
  const info = dbx.run(
    `INSERT INTO roles (key, name, description, isSystem, permissions, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [key, name, description || null, JSON.stringify(permissions), now, now],
  );
  logAccess(req, `新增角色 ${name}（${permissions.length} 个模块权限）`);
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
  if (req.body?.permissions !== undefined) {
    const next = normalizePermissions(req.body.permissions);
    if (next === null) return res.status(400).json({ message: '权限配置含无效模块，请刷新后重试' });
    permissions = next;
  }

  dbx.run(
    'UPDATE roles SET name = ?, description = ?, permissions = ?, updatedAt = ? WHERE id = ?',
    [name, description || null, JSON.stringify(permissions), nowStr(), id],
  );
  logAccess(req, `修改角色 ${target.name} → ${name}（${permissions.length} 个模块权限）`);
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

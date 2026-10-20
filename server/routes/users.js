/**
 * 用户管理（仅管理员）：账号增删改、单条删除、Excel 批量导入、角色与班级分配。
 *
 * 多角色模型：请求可传 roleKeys（角色 key 数组），账号的有效模块权限 = 各角色权限并集；
 * users.role 保留为「主角色」（集合含 admin 时主角色即 admin），兼容全部系统级判定。
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { isSystemAdmin, roleKeysOfUserId } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 批量导入初始密码规则：统一为「Hzpt@」拼接用户名，模板不再提供密码列，首次登录强制修改 */
const IMPORT_PASSWORD_PREFIX = 'Hzpt@';
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/* ---------- 角色集合（userRoles 多对多） ---------- */

/** 校验并稳定排序角色 key：全部存在时按 roles.id 顺序返回，否则 null */
function resolveRoleKeys(raw) {
  const keys = [...new Set((Array.isArray(raw) ? raw : []).map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (keys.length === 0) return null;
  const placeholders = keys.map(() => '?').join(', ');
  const found = dbx.all(`SELECT key FROM roles WHERE key IN (${placeholders}) ORDER BY id`, keys);
  if (found.length !== keys.length) return null;
  return found.map((r) => r.key);
}

/** 主角色：集合含 admin 则 admin，否则按稳定顺序的第一个 */
function primaryRoleOf(keys) {
  return keys.includes('admin') ? 'admin' : keys[0];
}

/** 整体替换用户角色集合 */
function setUserRoles(userId, keys) {
  dbx.run('DELETE FROM userRoles WHERE userId = ?', [userId]);
  for (const key of keys) {
    dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [userId, key]);
  }
}

/** 用户的角色集合信息（key + 展示名，按角色表顺序） */
function roleInfoOf(userId) {
  return dbx.all(
    `SELECT ur.roleKey AS key, r.name AS name FROM userRoles ur
     LEFT JOIN roles r ON r.key = ur.roleKey WHERE ur.userId = ? ORDER BY r.id`,
    [userId],
  );
}

/** 启用状态的系统管理员数（主角色或角色集合含 admin 均计入） */
function enabledAdminCount() {
  return dbx.get(
    `SELECT COUNT(*) AS c FROM users WHERE disabled = 0 AND (role = 'admin' OR EXISTS (
      SELECT 1 FROM userRoles ur WHERE ur.userId = users.id AND ur.roleKey = 'admin'))`,
  ).c;
}

/* ---------- 辅导员所辖班级（classCounselors 多对多） ---------- */

/** 所辖班级 ID 列表（系统管理员返回空数组） */
function classIdsOf(userId) {
  return dbx.all(
    'SELECT classId FROM classCounselors WHERE userId = ? ORDER BY classId',
    [userId],
  ).map((r) => r.classId);
}

/** 所辖班级名称列表 */
function classNamesOf(userId) {
  return dbx.all(
    'SELECT c.name FROM classCounselors cc JOIN classes c ON c.id = cc.classId WHERE cc.userId = ? ORDER BY c.name',
    [userId],
  ).map((r) => r.name);
}

/** 规范化并校验班级 ID 列表（去重、过滤非法值）；包含不存在的班级时返回 null */
function resolveClassIds(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const found = dbx.all(`SELECT id FROM classes WHERE id IN (${placeholders})`, ids);
  return found.length === ids.length ? ids : null;
}

/** 整体替换用户的所辖班级 */
function setClassCounselors(userId, classIds) {
  dbx.run('DELETE FROM classCounselors WHERE userId = ?', [userId]);
  for (const cid of classIds) {
    dbx.run('INSERT INTO classCounselors (classId, userId) VALUES (?, ?)', [cid, userId]);
  }
}

/**
 * 解析导入表格中的班级文本：
 * - 多个班级用「、」「,」「/」「;」分隔
 * - 同名班级跨年级时须写成「2024级·计应2401」
 * 返回 { ids, missing, ambiguous }
 */
function resolveClassNames(raw) {
  const tokens = String(raw ?? '')
    .split(/[、,，/;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [];
  const missing = [];
  const ambiguous = [];

  for (const token of tokens) {
    const parts = token.split(/[·・]/).map((s) => s.trim()).filter(Boolean);
    const rows = parts.length === 2
      ? dbx.all(
        'SELECT c.id FROM classes c JOIN grades g ON g.id = c.gradeId WHERE g.name = ? AND c.name = ?',
        [parts[0], parts[1]],
      )
      : dbx.all('SELECT c.id FROM classes c WHERE c.name = ?', [token]);
    if (rows.length === 0) missing.push(token);
    else if (rows.length > 1) ambiguous.push(token);
    else if (!ids.includes(rows[0].id)) ids.push(rows[0].id);
  }

  return { ids, missing, ambiguous };
}

/** 用户输出：safeUser + 角色集合 + 主角色名 + 所辖班级 */
function toUser(row) {
  const roleInfo = roleInfoOf(row.id);
  return {
    ...auth.safeUser(row),
    roleName: row.roleName ?? row.role,
    roleKeys: roleInfo.map((r) => r.key),
    roleNames: roleInfo.map((r) => r.name ?? r.key),
    classIds: isSystemAdmin(row) ? [] : classIdsOf(row.id),
    classNames: isSystemAdmin(row) ? [] : classNamesOf(row.id),
  };
}

/* ---------- 公共参考数据（所有登录用户可取） ---------- */

/** 在职辅导员精简列表（班级管理/学生表单选择主责/共管用；角色集合含 counselor 即可） */
router.get('/counselors', (req, res) => {
  const rows = dbx.all(
    `SELECT id, displayName FROM users WHERE disabled = 0 AND (role = 'counselor' OR EXISTS (
      SELECT 1 FROM userRoles ur WHERE ur.userId = users.id AND ur.roleKey = 'counselor'))
     ORDER BY displayName`,
  );
  res.json(rows.map((r) => ({ id: r.id, name: r.displayName })));
});

router.use(auth.adminOnly);

/* ---------- 用户列表 ---------- */
router.get('/', (req, res) => {
  const rows = dbx.all(
    `SELECT u.*, r.name AS roleName FROM users u
     LEFT JOIN roles r ON r.key = u.role ORDER BY u.id`,
  );
  res.json(rows.map(toUser));
});

/* ---------- 新增账号 ---------- */
router.post('/', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const displayName = String(req.body?.displayName ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ message: '用户名需为 3-20 位字母/数字/下划线' });
  }
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '姓名需为 1-20 个字' });
  }
  // 角色集合：优先 roleKeys，兼容旧的单一 role 字段
  const roleKeys = resolveRoleKeys(req.body?.roleKeys ?? [req.body?.role]);
  if (!roleKeys) {
    return res.status(400).json({ message: '所选角色不存在（可能已被删除）' });
  }
  const primary = primaryRoleOf(roleKeys);
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ message: '初始密码至少 8 位且包含字母和数字' });
  }
  if (dbx.get('SELECT 1 FROM users WHERE username = ?', [username])) {
    return res.status(400).json({ message: `用户名「${username}」已存在` });
  }

  // 非系统管理员可在创建时分配班级；先校验后落库，避免半成品账号
  let classIds = [];
  if (!roleKeys.includes('admin') && req.body?.classIds !== undefined) {
    classIds = resolveClassIds(req.body.classIds);
    if (classIds === null) return res.status(400).json({ message: '所选班级不存在（可能已被删除）' });
  }

  const info = dbx.run(
    'INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, 1, ?)',
    [username, displayName, primary, auth.hashPassword(password), nowStr()],
  );
  const uid = Number(info.lastInsertRowid);
  setUserRoles(uid, roleKeys);
  if (classIds.length > 0) setClassCounselors(uid, classIds);
  logAccess(req, `新增账号 ${username}（角色：${roleKeys.join('、')}）${classIds.length ? `，分配 ${classIds.length} 个班级` : ''}`);
  res.json(toUser(dbx.get(
    'SELECT u.*, r.name AS roleName FROM users u LEFT JOIN roles r ON r.key = u.role WHERE u.id = ?',
    [uid],
  )));
});

/* ---------- 编辑账号（姓名/角色集合/停用/密码/班级） ---------- */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的用户' });
  const target = dbx.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '用户不存在' });
  const targetRoleKeys = roleKeysOfUserId(id);
  const targetIsAdmin = isSystemAdmin({ role: target.role, roleKeys: targetRoleKeys });

  const displayName = req.body?.displayName !== undefined
    ? String(req.body.displayName).trim()
    : target.displayName;
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '姓名需为 1-20 个字' });
  }

  // 角色集合调整：不能改自己，且系统至少保留一名启用的系统管理员
  let roleKeys = targetRoleKeys.length > 0 ? targetRoleKeys : [target.role];
  if (req.body?.roleKeys !== undefined || req.body?.role !== undefined) {
    const nextKeys = resolveRoleKeys(req.body?.roleKeys ?? [req.body?.role]);
    if (!nextKeys) {
      return res.status(400).json({ message: '所选角色不存在（可能已被删除）' });
    }
    const unchanged = nextKeys.length === roleKeys.length && nextKeys.every((k) => roleKeys.includes(k));
    if (!unchanged) {
      if (id === req.user.id) {
        return res.status(400).json({ message: '不能修改自己的角色' });
      }
      if (targetIsAdmin && !nextKeys.includes('admin') && enabledAdminCount() <= 1) {
        return res.status(400).json({ message: '系统至少需要保留一名启用状态的管理员' });
      }
    }
    roleKeys = nextKeys;
  }
  const nextIsAdmin = roleKeys.includes('admin');
  const primary = primaryRoleOf(roleKeys);

  const disabled = req.body?.disabled !== undefined ? (req.body.disabled ? 1 : 0) : target.disabled;
  if (nextIsAdmin && disabled) {
    return res.status(400).json({ message: '不能停用管理员账号' });
  }

  // 密码先校验后写库，避免出现「资料已更新但密码被驳回」的半成功状态
  const newPassword = req.body?.password ? String(req.body.password) : '';
  if (newPassword && (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword))) {
    return res.status(400).json({ message: '重置密码至少 8 位且包含字母和数字' });
  }

  // 非系统管理员支持分配班级；含 admin 角色时清空所辖班级
  let classIds;
  if (!nextIsAdmin && req.body?.classIds !== undefined) {
    classIds = resolveClassIds(req.body.classIds);
    if (classIds === null) return res.status(400).json({ message: '所选班级不存在（可能已被删除）' });
  }

  dbx.run(
    'UPDATE users SET displayName = ?, role = ?, disabled = ? WHERE id = ?',
    [displayName, primary, disabled, id],
  );
  setUserRoles(id, roleKeys);
  if (nextIsAdmin) setClassCounselors(id, []);
  else if (classIds !== undefined) setClassCounselors(id, classIds);

  if (newPassword) {
    dbx.run('UPDATE users SET passwordHash = ?, mustChangePassword = 1 WHERE id = ?', [
      auth.hashPassword(newPassword), id,
    ]);
    logAccess(req, `重置 ${target.username} 的密码`);
  } else {
    const rolesChanged = roleKeys.join(',') !== targetRoleKeys.join(',');
    logAccess(req, `更新账号 ${target.username}${rolesChanged ? `，角色调整为 ${roleKeys.join('、')}` : ''}${classIds !== undefined ? `，所辖班级调整为 ${classIds.length} 个` : ''}`);
  }

  res.json(toUser(dbx.get(
    'SELECT u.*, r.name AS roleName FROM users u LEFT JOIN roles r ON r.key = u.role WHERE u.id = ?',
    [id],
  )));
});

/* ---------- 删除账号 ---------- */
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的用户' });
  const target = dbx.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '用户不存在' });

  if (id === req.user.id) {
    return res.status(400).json({ message: '不能删除当前登录的账号' });
  }
  const targetIsAdmin = isSystemAdmin({ role: target.role, roleKeys: roleKeysOfUserId(id) });
  if (targetIsAdmin && enabledAdminCount() <= 1) {
    return res.status(400).json({ message: '系统至少需要保留一名启用状态的管理员' });
  }

  // 事务：清理关联关系与登录失败计数后删除账号，任一失败全部回滚
  dbx.db.exec('BEGIN IMMEDIATE');
  try {
    dbx.run('DELETE FROM studentCounselors WHERE userId = ?', [id]);
    dbx.run('DELETE FROM classCounselors WHERE userId = ?', [id]);
    dbx.run('DELETE FROM userRoles WHERE userId = ?', [id]);
    dbx.run('DELETE FROM loginAttempts WHERE username = ?', [target.username]);
    dbx.run('DELETE FROM users WHERE id = ?', [id]);
    dbx.db.exec('COMMIT');
  } catch (e) {
    dbx.db.exec('ROLLBACK');
    console.error('[users/delete] 事务回滚：', e.message);
    return res.status(500).json({ message: '删除失败，已全部回滚，未产生数据变更' });
  }

  logAccess(req, `删除账号 ${target.username}（${target.displayName}）`);
  res.json({ ok: true });
});

/* ---------- 批量导入账号 ---------- */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ message: '没有可导入的数据行' });
  if (rows.length > 2000) return res.status(400).json({ message: '单次最多导入 2000 行，请分批操作' });

  const roleRows = dbx.all('SELECT key, name FROM roles');
  const roleByKey = new Map(roleRows.map((r) => [r.key, r]));
  const roleByName = new Map(roleRows.map((r) => [r.name, r]));
  const existing = new Set(dbx.all('SELECT username FROM users').map((r) => r.username));

  const seenRow = new Map(); // username → 本表首次出现的行号
  const failures = [];
  const pending = [];

  for (const { row, data } of rows) {
    const reasons = [];
    const username = String(data?.username ?? '').trim();
    const displayName = String(data?.displayName ?? '').trim();
    const roleRaw = String(data?.role ?? '').trim();
    const classRaw = String(data?.classNames ?? data?.className ?? '').trim();

    if (!username) reasons.push('用户名为必填项');
    else if (!USERNAME_RE.test(username)) reasons.push('用户名需为 3-20 位字母/数字/下划线');
    else if (existing.has(username)) reasons.push('用户名已存在于系统中');
    else if (seenRow.has(username)) reasons.push(`用户名与本表第 ${seenRow.get(username)} 行重复`);
    if (username) seenRow.set(username, row);

    if (!displayName) reasons.push('姓名为必填项');
    else if (displayName.length > 20) reasons.push('姓名不可超过 20 个字');

    const roleRow = roleByKey.get(roleRaw) ?? roleByName.get(roleRaw);
    if (!roleRaw) reasons.push('角色为必填项');
    else if (!roleRow) reasons.push(`角色「${roleRaw}」不存在，请先在「角色管理」中创建`);

    let classIds = [];
    if (classRaw && roleRow && roleRow.key !== 'admin') {
      const parsed = resolveClassNames(classRaw);
      if (parsed.missing.length > 0) reasons.push(`班级未匹配到班级字典：${parsed.missing.join('、')}`);
      if (parsed.ambiguous.length > 0) reasons.push(`班级名在多个年级重复，请写成「年级·班级」：${parsed.ambiguous.join('、')}`);
      classIds = parsed.ids;
    }

    if (reasons.length > 0) {
      failures.push({ row, username: username || '—', displayName: displayName || '—', reason: reasons.join('；'), data });
      continue;
    }
    pending.push({
      row,
      username,
      displayName,
      roleKey: roleRow.key,
      password: `${IMPORT_PASSWORD_PREFIX}${username}`,
      classIds,
    });
  }

  // 事务写入：单次请求原子生效，中途异常整批回滚
  if (pending.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      const now = nowStr();
      for (const it of pending) {
        const info = dbx.run(
          'INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, 1, ?)',
          [it.username, it.displayName, primaryRoleOf([it.roleKey]), auth.hashPassword(it.password), now],
        );
        const uid = Number(info.lastInsertRowid);
        setUserRoles(uid, [it.roleKey]);
        for (const cid of it.classIds) {
          dbx.run('INSERT INTO classCounselors (classId, userId) VALUES (?, ?)', [cid, uid]);
        }
      }
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[users/import] 事务回滚：', e.message);
      return res.status(500).json({ message: '批量导入失败，已全部回滚，未产生任何账号' });
    }
  }

  logAccess(req, `批量导入用户：成功 ${pending.length} 条，失败 ${failures.length} 条`);
  res.json({ total: rows.length, successCount: pending.length, failures });
});

module.exports = router;

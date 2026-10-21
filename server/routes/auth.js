/** 登录与账号自服务 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { classIdsOfUser } = require('../lib/scope');
const { permissionsOfUser, ownerModulesOfUser, isSystemAdmin, roleKeysOfUserId } = require('../lib/permissions');
const { logAccess } = require('../lib/audit');

const router = express.Router();

/**
 * 会话用户输出：safeUser 白名单 + 所辖班级 + 角色集合 + 主角色名 + 有效权限（并集）
 * + 主负责模块（并集；管理员为 ['*']，与 permissions 口径一致）。
 * 前端菜单与路由守卫直接消费 permissions；权限变更后重新拉取 /auth/me 即可生效。
 */
const withSession = (row) => {
  // 先取角色集合再解析权限/班级（登录行的原始记录不含 roleKeys）
  const roleKeys = roleKeysOfUserId(row.id);
  const rowWithRoles = { ...row, roleKeys };
  const role = dbx.get('SELECT name FROM roles WHERE key = ?', [rowWithRoles.role]);
  return {
    ...auth.safeUser(rowWithRoles),
    classIds: classIdsOfUser(rowWithRoles),
    roleKeys,
    roleName: role?.name ?? (rowWithRoles.role === 'admin' ? '系统管理员' : rowWithRoles.role),
    permissions: permissionsOfUser(rowWithRoles),
    ownerModules: isSystemAdmin(rowWithRoles) ? ['*'] : ownerModulesOfUser(rowWithRoles),
  };
};

router.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!username || !password) {
    return res.status(400).json({ message: '请输入用户名和密码' });
  }

  const row = dbx.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!row || !auth.verifyPassword(password, row.passwordHash)) {
    // 不再记录失败次数、不再锁定账号：连续输错仅返回统一的 401（审计日志仍逐次留痕）
    logAccess(req, '登录失败', '失败');
    return res.status(401).json({ message: '用户名或密码错误' });
  }
  if (row.disabled) {
    logAccess(req, '登录（账号已停用）', '拒绝');
    return res.status(403).json({ message: '账号已停用，请联系管理员' });
  }

  const token = auth.issueToken(row);
  req.user = row;
  logAccess(req, '登录成功');

  res.json({ token, user: withSession(row) });
});

// 以下接口需要登录
router.use(auth.authMiddleware);

router.get('/me', (req, res) => {
  res.json(withSession(req.user));
});

router.patch('/me', (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '称呼需为 1-20 个字' });
  }
  dbx.run('UPDATE users SET displayName = ? WHERE id = ?', [displayName, req.user.id]);
  const row = dbx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(withSession(row));
});

router.post('/change-password', (req, res) => {
  const oldPassword = String(req.body?.oldPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (!auth.verifyPassword(oldPassword, req.user.passwordHash)) {
    return res.status(400).json({ message: '原密码不正确' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: '新密码至少 8 位' });
  }
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ message: '新密码需同时包含字母和数字' });
  }
  if (newPassword === req.user.username) {
    return res.status(400).json({ message: '新密码不能与用户名相同' });
  }
  dbx.run('UPDATE users SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [
    auth.hashPassword(newPassword), req.user.id,
  ]);
  logAccess(req, '修改密码');
  const row = dbx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ token: auth.issueToken(row), user: withSession(row) });
});

module.exports = router;

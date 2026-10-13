/** 登录与账号自服务 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess, clientIp } = require('../lib/audit');

const router = express.Router();

router.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const ip = clientIp(req);

  if (!username || !password) {
    return res.status(400).json({ message: '请输入用户名和密码' });
  }

  const locked = auth.isLocked(username);
  if (locked) {
    logAccess(req, `登录（账号锁定中，解锁时间 ${locked.slice(0, 16)}）`, '拒绝');
    return res.status(423).json({ message: `失败次数过多，账号已锁定，请 ${locked.slice(11, 16)} 后再试` });
  }

  const row = dbx.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!row || !auth.verifyPassword(password, row.passwordHash)) {
    const { fails } = auth.recordFail(username);
    logAccess(req, `登录失败（第 ${fails} 次）`, '失败');
    const remain = Math.max(0, 5 - fails);
    return res.status(401).json({
      message: fails >= 5 ? '失败次数过多，账号已锁定 15 分钟' : `用户名或密码错误（再错 ${remain} 次将锁定）`,
    });
  }
  if (row.disabled) {
    logAccess(req, '登录（账号已停用）', '拒绝');
    return res.status(403).json({ message: '账号已停用，请联系管理员' });
  }

  auth.clearFails(username);
  const token = auth.issueToken(row);
  req.user = row;
  logAccess(req, '登录成功');

  res.json({ token, user: auth.safeUser(row) });
});

// 以下接口需要登录
router.use(auth.authMiddleware);

router.get('/me', (req, res) => {
  res.json(auth.safeUser(req.user));
});

router.patch('/me', (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '称呼需为 1-20 个字' });
  }
  dbx.run('UPDATE users SET displayName = ? WHERE id = ?', [displayName, req.user.id]);
  const row = dbx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(auth.safeUser(row));
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
  dbx.run('UPDATE users SET passwordHash = ?, mustChangePassword = 0 WHERE id = ?', [
    auth.hashPassword(newPassword), req.user.id,
  ]);
  logAccess(req, '修改密码');
  const row = dbx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ token: auth.issueToken(row), user: auth.safeUser(row) });
});

module.exports = router;

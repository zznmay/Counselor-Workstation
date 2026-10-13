/** 用户管理（仅管理员） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess } = require('../lib/audit');

const router = express.Router();

router.use(auth.authMiddleware);
router.use(auth.adminOnly);

router.get('/', (req, res) => {
  const rows = dbx.all('SELECT * FROM users ORDER BY id');
  res.json(rows.map(auth.safeUser));
});

/** 在职辅导员精简列表（学生表单选择主责/共管用，所有登录用户可取） */
router.get('/counselors', (req, res) => {
  const rows = dbx.all(
    "SELECT id, displayName FROM users WHERE role = 'counselor' AND disabled = 0 ORDER BY displayName",
  );
  res.json(rows.map((r) => ({ id: r.id, name: r.displayName })));
});

router.post('/', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const displayName = String(req.body?.displayName ?? '').trim();
  const role = req.body?.role === 'admin' ? 'admin' : 'counselor';
  const password = String(req.body?.password ?? '');

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ message: '用户名需为 3-20 位字母/数字/下划线' });
  }
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '姓名需为 1-20 个字' });
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ message: '初始密码至少 8 位且包含字母和数字' });
  }
  const exists = dbx.get('SELECT 1 FROM users WHERE username = ?', [username]);
  if (exists) {
    return res.status(400).json({ message: `用户名「${username}」已存在` });
  }

  const info = dbx.run(
    'INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, 1, ?)',
    [username, displayName, role, auth.hashPassword(password), new Date().toISOString().slice(0, 16).replace('T', ' ')],
  );
  const row = dbx.get('SELECT * FROM users WHERE id = ?', [info.lastInsertRowid]);
  logAccess(req, `新增账号 ${username}（${role}）`);
  res.json(auth.safeUser(row));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的用户' });
  const target = dbx.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '用户不存在' });

  const displayName = req.body?.displayName !== undefined
    ? String(req.body.displayName).trim()
    : target.displayName;
  if (!displayName || displayName.length > 20) {
    return res.status(400).json({ message: '姓名需为 1-20 个字' });
  }
  if (target.role === 'admin' && req.body?.disabled) {
    return res.status(400).json({ message: '不能停用管理员账号' });
  }

  const disabled = req.body?.disabled !== undefined ? (req.body.disabled ? 1 : 0) : target.disabled;
  dbx.run('UPDATE users SET displayName = ?, disabled = ? WHERE id = ?', [displayName, disabled, id]);

  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ message: '重置密码至少 8 位且包含字母和数字' });
    }
    dbx.run('UPDATE users SET passwordHash = ?, mustChangePassword = 1 WHERE id = ?', [
      auth.hashPassword(password), id,
    ]);
    logAccess(req, `重置 ${target.username} 的密码`);
  } else {
    logAccess(req, `更新账号 ${target.username}`);
  }

  const row = dbx.get('SELECT * FROM users WHERE id = ?', [id]);
  res.json(auth.safeUser(row));
});

module.exports = router;

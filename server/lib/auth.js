/** 鉴权：JWT 签发/校验、登录失败锁定、路由守卫中间件 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { ensureJwtSecret } = require('./config');
const dbx = require('./db');

const JWT_SECRET = ensureJwtSecret();
const TOKEN_EXPIRES = '8h';
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// JWT 形态预校验：三段式 base64url，先行拦截畸形输入
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** 登录失败锁定（loginAttempts 表持久化，重启不清零） */
function isLocked(username) {
  const row = dbx.get('SELECT fails, lockedUntil FROM loginAttempts WHERE username = ?', [username]);
  if (!row || !row.lockedUntil) return null;
  if (new Date(row.lockedUntil).getTime() > Date.now()) return row.lockedUntil;
  dbx.run('UPDATE loginAttempts SET fails = 0, lockedUntil = NULL WHERE username = ?', [username]);
  return null;
}

function getFailCount(username) {
  return dbx.get('SELECT fails FROM loginAttempts WHERE username = ?', [username])?.fails ?? 0;
}

function recordFail(username) {
  const fails = getFailCount(username) + 1;
  const lockedUntil = fails >= MAX_FAILS
    ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
    : null;
  dbx.run(`INSERT INTO loginAttempts (username, fails, lockedUntil) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET fails = excluded.fails, lockedUntil = excluded.lockedUntil`,
    [username, fails, lockedUntil]);
  return { fails, lockedUntil };
}

function clearFails(username) {
  dbx.run('UPDATE loginAttempts SET fails = 0, lockedUntil = NULL WHERE username = ?', [username]);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function issueToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES },
  );
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: !!row.mustChangePassword,
    disabled: !!row.disabled,
    createdAt: row.createdAt,
  };
}

function findActiveUser(uid) {
  const id = Number(uid);
  if (!Number.isInteger(id) || id <= 0) return null;
  return dbx.get('SELECT * FROM users WHERE id = ? AND disabled = 0', [id]);
}

/** 解析并校验 token，返回负载；失败返回 null */
function decodeToken(token) {
  if (typeof token !== 'string' || !JWT_SHAPE.test(token)) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** 路由守卫：校验 Bearer token 并挂载 req.user */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = decodeToken(token);
  if (!payload) return res.status(401).json({ message: '未登录或登录已过期' });
  const user = findActiveUser(payload.uid);
  if (!user) return res.status(401).json({ message: '账号已失效或被停用' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: '需要管理员权限' });
  next();
}

module.exports = {
  isLocked,
  recordFail,
  clearFails,
  verifyPassword,
  hashPassword,
  issueToken,
  safeUser,
  authMiddleware,
  adminOnly,
  JWT_SECRET,
  TOKEN_EXPIRES,
};

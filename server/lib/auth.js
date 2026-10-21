/** 鉴权：JWT 签发/校验、路由守卫中间件 */
/* 登录失败锁定（loginAttempts 表）已移除：连续输错密码不再锁定账号。
   loginAttempts 表保留不删除 —— 历史数据包仍含该表，恢复老备份需要它（见 lib/datamgmt.js）。 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { ensureJwtSecret } = require('./config');
const dbx = require('./db');
const { isSystemAdmin } = require('./permissions');

const JWT_SECRET = ensureJwtSecret();
const TOKEN_EXPIRES = '8h';
// JWT 形态预校验：三段式 base64url，先行拦截畸形输入
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

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
  const user = dbx.get('SELECT * FROM users WHERE id = ? AND disabled = 0', [id]);
  if (!user) return null;
  // 角色集合：多角色权限并集解析依赖（每次请求实时读取，改角色即时生效）
  user.roleKeys = dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [id]).map((r) => r.roleKey);
  return user;
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
/** 收集候选令牌：优先 X-Auth-Token，其次 Authorization
 *（部分反向代理会覆盖 Authorization，故自定义头优先） */
function candidateTokens(req) {
  const list = [];
  const custom = req.headers['x-auth-token'];
  if (custom) list.push(Array.isArray(custom) ? custom[0] : String(custom));
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) list.push(header.slice(7));
  return list;
}

function authMiddleware(req, res, next) {
  let payload = null;
  for (const token of candidateTokens(req)) {
    payload = decodeToken(token);
    if (payload) break;
  }
  if (!payload) return res.status(401).json({ message: '未登录或登录已过期' });
  const user = findActiveUser(payload.uid);
  if (!user) return res.status(401).json({ message: '账号已失效或被停用' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  // 角色集合含 admin（或主角色为 admin）即系统管理员
  if (!isSystemAdmin(req.user)) return res.status(403).json({ message: '需要管理员权限' });
  next();
}

module.exports = {
  verifyPassword,
  hashPassword,
  issueToken,
  safeUser,
  authMiddleware,
  adminOnly,
  JWT_SECRET,
  TOKEN_EXPIRES,
};

/** 访问审计：自动记录所有写操作与登录事件 */
const dbx = require('./db');

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '-';
}

/** 写入一条访问记录 */
function logAccess(req, action, status = '成功') {
  try {
    dbx.run(
      'INSERT INTO accessLogs (ts, username, userId, ip, method, path, action, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        nowStr(),
        req.user?.username ?? '未登录',
        req.user?.id ?? null,
        clientIp(req),
        req.method,
        req.originalUrl,
        action,
        status,
      ],
    );
  } catch (e) {
    console.error('[audit] 写入访问日志失败:', e.message);
  }
}

/** 中间件：自动记录所有非 GET 请求 */
function auditWrite(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    const action = `${req.method} ${req.originalUrl}`;
    logAccess(req, action, res.statusCode < 400 ? '成功' : `失败(${res.statusCode})`);
  });
  next();
}

module.exports = { logAccess, auditWrite, clientIp, nowStr };

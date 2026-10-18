/** 服务端路径与运行时配置 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER_ROOT = __dirname ? path.join(__dirname, '..') : process.cwd();
/** 数据目录：默认项目内 data/；可用 WORKBENCH_DATA_DIR 覆盖（隔离测试库用，生产不设即默认） */
const DATA_DIR = process.env.WORKBENCH_DATA_DIR
  ? path.resolve(process.env.WORKBENCH_DATA_DIR)
  : path.join(SERVER_ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CERT_DIR = path.join(SERVER_ROOT, 'certs');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const JWT_SECRET_FILE = path.join(DATA_DIR, 'jwt.secret');
const DIST_DIR = path.join(SERVER_ROOT, '..', 'dist');

const PORT = Number(process.env.PORT || 8443);

/** 确保运行时目录存在 */
function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, CERT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/** JWT 密钥：首次启动随机生成并持久化 */
function ensureJwtSecret() {
  if (!fs.existsSync(JWT_SECRET_FILE)) {
    const secret = require('crypto').randomBytes(48).toString('hex');
    fs.writeFileSync(JWT_SECRET_FILE, secret, { mode: 0o600 });
  }
  return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
}

/** 本机内网 IP（用于证书 SAN 与部署提示） */
function lanIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

module.exports = {
  SERVER_ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  BACKUP_DIR,
  CERT_DIR,
  DB_PATH,
  JWT_SECRET_FILE,
  DIST_DIR,
  PORT,
  ensureDirs,
  ensureJwtSecret,
  lanIps,
};

/** 知行辅导员工作台本地化服务端入口：HTTPS + 静态托管 + REST API */
const fs = require('fs');
const https = require('https');
const path = require('path');

const express = require('express');

const config = require('./lib/config');
const auth = require('./lib/auth');
const { ensureEntryHtml, assetSnapshot } = require('./lib/entryHtml');
const { auditWrite } = require('./lib/audit');

config.ensureDirs();

/**
 * SPA 入口自愈（启动时执行一次）：
 * dist/index.html 可能仍指向旧构建（发布链路不更新该文件），按 dist/assets 中最新资产
 * 改写出 dist/entry.html 作为实际入口，避免线上一直加载旧包。
 */
const entryFile = fs.existsSync(config.DIST_DIR) ? ensureEntryHtml() : null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));

// ---- REST API ----
const api = express.Router();
api.use('/auth', require('./routes/auth'));
api.use('/users', require('./routes/users'));
api.use('/roles', require('./routes/roles'));
api.use('/students', require('./routes/students'));
api.use('/grades', require('./routes/grades'));
/* 班级管理 → 教师名单（辅导员/班主任唯一来源）：必须挂在 /classes 之前，
   否则会被 /classes 的 /:id 路由吞掉 */
api.use('/classes/teachers', require('./routes/teachers'));
api.use('/classes', require('./routes/classes'));
/* 寝室管理：学生宿舍分配（名册「宿舍」列的唯一数据来源） */
api.use('/dormitories', require('./routes/dormitories'));
api.use('/conversations', require('./routes/conversations'));
api.use('/warnings', require('./routes/warnings'));
api.use('/mental', require('./routes/mental'));
api.use('/notices', require('./routes/notices'));
api.use('/approvals', require('./routes/approvals'));
api.use('/todos', require('./routes/todos'));
api.use('/templates', require('./routes/templates'));
api.use('/scheduler', require('./routes/scheduler'));
api.use('/dashboard', require('./routes/dashboard'));
api.use('/logs', require('./routes/logs'));
/* 数据管理（备份 / 恢复 / 迁移）：仅管理员，业务逻辑在 lib/datamgmt.js */
api.use('/data', require('./routes/data'));

// ---- 数据管理：按持久化的策略启动定时自动备份（链式 setTimeout + unref，不阻塞退出）----
try {
  const dm = require('./lib/datamgmt');
  const delayMs = dm.scheduleAuto();
  if (delayMs) console.error(`[datamgmt] 自动备份已启用：每 ${Math.round(delayMs / 3600000)} 小时执行一次`);
} catch (e) {
  console.error('[datamgmt] 自动备份调度启动失败:', e && e.message);
}

// ---- 健康检查（免鉴权）：排查「改了代码线上没生效」用，只回构建指纹，不含业务数据 ----
api.get('/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    entrySelfHeal: true,
    servedEntry: entryFile ? path.basename(entryFile) : 'index.html',
    assets: assetSnapshot(),
  });
});

api.use((req, res) => res.status(404).json({ message: '接口不存在' }));
api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[api]', err.message);
  res.status(err.status || 500).json({ message: err.message || '服务内部错误' });
});
app.use('/api', api);

// ---- 静态托管前端构建产物（SPA 回退） ----
if (fs.existsSync(config.DIST_DIR)) {
  if (entryFile) {
    console.error(`[entry] SPA 入口: ${path.basename(entryFile)}（${path.dirname(entryFile)}）`);
  }
  const sendEntry = (res) => res.sendFile(
    entryFile && fs.existsSync(entryFile) ? entryFile : path.join(config.DIST_DIR, 'index.html'),
  );
  /**
   * 判断请求路径是否命中 dist 内真实存在的静态 HTML（实用工具页 /tools/*.html 等）。
   * 先按 dist 根解析绝对路径，再校验结果仍位于 dist 之内（防目录穿越）且是普通文件。
   */
  const isRealDistHtml = (reqPath) => {
    if (!reqPath || reqPath === '/' || !reqPath.endsWith('.html')) return false;
    const distRoot = path.resolve(config.DIST_DIR);
    const target = path.resolve(distRoot, `.${reqPath}`);
    if (target !== distRoot && !target.startsWith(distRoot + path.sep)) return false;
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  };
  app.use((req, res, next) => {
    // 根路径与 *.html 走自愈入口（必须在 express.static 之前，否则 / 会被 dist/index.html 抢先命中）
    // 例外：dist 中真实存在的静态 HTML（实用工具 /tools/*.html 等）直接放行，
    // 否则 iframe 内嵌工具页会被改写成工作台 SPA 入口，表现为「实用工具内容缺失」。
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
      if (isRealDistHtml(req.path)) return next();
      return sendEntry(res);
    }
    return next();
  });
  app.use(express.static(config.DIST_DIR));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) return sendEntry(res);
    return next();
  });
} else {
  console.warn('[warn] 未找到前端构建目录 dist/，请先在项目根目录执行 npm run build');
}

// ---- 监听层：默认 HTTPS（内网自签证书）；ENABLE_HTTPS=0 时走 HTTP（云平台反向代理场景） ----
const useTls = String(process.env.ENABLE_HTTPS ?? '1') !== '0';
const scheme = useTls ? 'https' : 'http';

let server;
if (useTls) {
  const keyPath = path.join(config.CERT_DIR, 'key.pem');
  const certPath = path.join(config.CERT_DIR, 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('[cert] 未发现证书，正在生成自签证书…');
    require('./scripts/gen-cert').generate();
  }
  server = https.createServer(
    { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
    app,
  );
} else {
  console.log('[net] ENABLE_HTTPS=0，以 HTTP 模式监听（适用于反向代理/云平台部署）');
  server = require('http').createServer(app);
}

server.on('error', (err) => {
  console.error('[net] 监听失败:', err && err.message);
});

server.listen(config.PORT, '0.0.0.0', () => {
  const ips = config.lanIps();
  console.error(`[net] 已监听 0.0.0.0:${config.PORT} (${scheme})`);
  console.log('==============================================');
  console.log('  知行辅导员工作台 · 本地化服务端已启动');
  console.log(`  本机访问:    ${scheme}://localhost:${config.PORT}`);
  ips.forEach((ip) => console.log(`  局域网访问:  ${scheme}://${ip}:${config.PORT}`));
  if (useTls) console.log('  首次访问浏览器会提示证书不受信任，属自签证书正常现象');
  console.log('  数据目录:   ', config.DATA_DIR);
  console.log('==============================================');
});

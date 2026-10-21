/** 知行辅导员工作台本地化服务端入口：HTTPS + 静态托管 + REST API */
const fs = require('fs');
const https = require('https');
const path = require('path');

const express = require('express');

const config = require('./lib/config');
const auth = require('./lib/auth');
const { ensureEntryHtml, assetSnapshot } = require('./lib/entryHtml');
const { auditWrite } = require('./lib/audit');
const { responseCompression } = require('./lib/compress');
const { compressDir, servePrecompressed } = require('./lib/precompress');

config.ensureDirs();

/**
 * SPA 入口自愈（启动时执行一次）：
 * dist/index.html 可能仍指向旧构建（发布链路不更新该文件），按 dist/assets 中最新资产
 * 改写出 dist/entry.html 作为实际入口，避免线上一直加载旧包。
 */
let entryFile = null;
if (fs.existsSync(config.DIST_DIR)) {
  try {
    entryFile = ensureEntryHtml();
  } catch (e) {
    // 只读发布目录等场景：入口自愈失败不应阻断服务启动，回退原 index.html
    console.warn('[entry] 入口自愈失败，回退 index.html:', e && e.message);
    entryFile = path.join(config.DIST_DIR, 'index.html');
  }
}

// 预压缩旁路文件：构建期已生成；若发布链路只上传了原始 dist，则在启动时补做一次。
// 失败不阻塞启动，后续由 express.static 回退未压缩文件。
if (fs.existsSync(config.DIST_DIR)) {
  try {
    const result = compressDir(config.DIST_DIR);
    if (result.compressed > 0) {
      console.error(`[static] 预压缩完成：${result.compressed}/${result.files} 个文件，节省约 ${Math.round(result.bytesSaved / 1024)} KB`);
    }
    if (result.errors.length > 0) {
      console.warn(`[static] 预压缩部分失败（${result.errors.length} 个）：${result.errors[0]}`);
    }
  } catch (e) {
    console.warn('[static] 预压缩不可用，将回退未压缩资源:', e && e.message);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
app.use(responseCompression());

// ---- REST API ----
const api = express.Router();
// 接口响应含账号/学生数据，禁止浏览器与中间代理缓存；压缩由 responseCompression 处理。
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');
  next();
});
api.use('/auth', require('./routes/auth'));
api.use('/users', require('./routes/users'));
api.use('/roles', require('./routes/roles'));
api.use('/students', require('./routes/students'));
api.use('/grades', require('./routes/grades'));
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
    // 入口 HTML 每次协商缓存：构建自愈后必须让浏览器立刻拿到新资产引用
    { headers: { 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' } },
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
    // 根路径、*.html 与「无扩展名的前端路由」走自愈入口（必须在 express.static 之前，
    // 否则 / 会被 dist/index.html 抢先命中）。
    // 例外：dist 中真实存在的静态 HTML（实用工具 /tools/*.html 等）直接放行，
    // 否则 iframe 内嵌工具页会被改写成工作台 SPA 入口，表现为「实用工具内容缺失」。
    //
    // 无扩展名路径必须在此拦下：/templates、/tools、/tools/counselor-scheduler 这类前端路由
    // 与 public 下同名静态目录重合，交给 express.static 会被当成目录请求，
    // 301 重定向到带尾斜杠的地址且 Location 丢弃 sharecode 等查询参数，
    // 线上表现为「直接访问或刷新实用工具页后返回 403 链接不完整」。
    // 真实静态资源（js/css/图片/docx）都带扩展名，不受此分支影响。
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    if (path.extname(req.path) === '') return sendEntry(res);
    if (req.path.endsWith('.html') && !isRealDistHtml(req.path)) return sendEntry(res);
    return next();
  });
  // 预压缩文件优先：哈希资产一年 immutable，HTML 协商，其余按小时缓存
  app.use(servePrecompressed(config.DIST_DIR));
  app.use(express.static(config.DIST_DIR, {
    setHeaders: (res, filePath) => {
      res.setHeader('Vary', 'Accept-Encoding');
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }));
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

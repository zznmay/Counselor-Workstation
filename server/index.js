/** 知行辅导员工作台本地化服务端入口：HTTPS + 静态托管 + REST API */
const fs = require('fs');
const https = require('https');
const path = require('path');

const express = require('express');

const config = require('./lib/config');
const auth = require('./lib/auth');
const { auditWrite } = require('./lib/audit');

config.ensureDirs();

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
api.use('/classes', require('./routes/classes'));
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

api.use((req, res) => res.status(404).json({ message: '接口不存在' }));
api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[api]', err.message);
  res.status(err.status || 500).json({ message: err.message || '服务内部错误' });
});
app.use('/api', api);

// ---- 静态托管前端构建产物（SPA 回退） ----
if (fs.existsSync(config.DIST_DIR)) {
  app.use(express.static(config.DIST_DIR));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(config.DIST_DIR, 'index.html'));
    }
    next();
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

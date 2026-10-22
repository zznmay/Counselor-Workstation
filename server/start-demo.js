/**
 * 体验/演示部署启动入口：WORKBENCH_SEED=demo + WORKBENCH_DEMO=1，
 * 强制 HTTP 模式（TLS 由平台边缘终止），监听 PORT。
 *
 * 与生产入口（start-cloud.js）的差异：
 *   - 数据库写入完整演示数据（seed-data.js，全部虚构）；
 *   - 种子管理员口令随机化并禁用登录，访客仅可通过 GET /api/auth/demo-login 进入；
 *   - 自动创建体验账号 demo（辅导员全业务角色 + 全班带班）。
 *
 * 用法：node --experimental-sqlite start-demo.js
 */
process.env.ENABLE_HTTPS = '0';
process.env.WORKBENCH_SEED = 'demo';
process.env.WORKBENCH_DEMO = '1';
// 沙箱未必注入 PORT，显式兜底为平台探测端口
process.env.PORT = process.env.PORT || '3000';

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[fatal] unhandledRejection:', err && err.stack ? err.stack : err);
  process.exit(1);
});

console.error('[boot] demo node=%s pid=%s PORT=%s cwd=%s', process.version, process.pid, process.env.PORT, process.cwd());

// 演示站固定重置数据目录：每次容器启动都按演示种子重建（体验数据被改乱后重启即恢复），
// 同时保证复用旧实例数据盘时不会带入历史真实数据——演示站只允许虚构演示数据存在。
const fs = require('fs');
const { DATA_DIR } = require('./lib/config');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.error('[boot] demo 数据目录已重置，将按演示种子重新初始化');

require('./index.js');

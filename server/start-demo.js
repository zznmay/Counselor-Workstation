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

// 一次性重置开关: RESET_DB=1 时清空数据目录, 强制按演示种子重新初始化
// (演示站日常无需该变量；数据被体验者改乱后重建容器/重置盘即可恢复)
if (process.env.RESET_DB === '1') {
  const fs = require('fs');
  const { DATA_DIR } = require('./lib/config');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.error('[boot] RESET_DB=1 → 已清空数据目录, 将按演示种子重新初始化');
}

require('./index.js');

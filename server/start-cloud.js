/**
 * 云平台/沙箱启动入口：强制 HTTP 模式（TLS 由平台边缘终止），监听 PORT。
 * 用法：node --experimental-sqlite start-cloud.js
 */
process.env.ENABLE_HTTPS = '0';
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

console.error('[boot] node=%s pid=%s PORT=%s cwd=%s', process.version, process.pid, process.env.PORT, process.cwd());

// 一次性重置开关: RESET_DB=1 时清空数据目录, 强制按种子重新初始化
// (用于云端数据不可用/密码遗忘的恢复; 日常启动不要带该变量, 否则每次重启都会清空数据)
if (process.env.RESET_DB === '1') {
  const fs = require('fs');
  const { DATA_DIR } = require('./lib/config');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.error('[boot] RESET_DB=1 → 已清空数据目录, 将按种子重新初始化');
}

require('./index.js');

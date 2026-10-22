/**
 * 云端启动前置检查：确保前端产物存在。
 *
 * 背景：原 start:cloud:prod = `npm run build:web && node ...`，容器每次启动都重跑
 * 一次完整 vite build —— 冷启动要等构建完成，且产物哈希每次漂移，浏览器/边缘缓存
 * 全部作废（用户侧表现为「首访极慢、每次都要重新下载全部 chunk」）。
 *
 * 现改为：构建只在部署阶段（installCmd）执行一次；启动时此脚本仅做存在性检查，
 * 命中则直接跳过（毫秒级）。若沙箱重建导致 dist 丢失，这里补一次构建自愈，
 * 避免因缺产物而白屏。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'dist', 'index.html');

if (fs.existsSync(entry)) {
  console.error('[boot] dist/index.html 已存在 → 跳过构建');
  process.exit(0);
}

console.error('[boot] 未找到 dist/index.html → 执行一次 vite build 自愈');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!fs.existsSync(viteBin)) {
  console.error('[boot][fatal] 未找到 vite，可执行文件不存在:', viteBin);
  process.exit(1);
}
execFileSync(process.execPath, [viteBin, 'build'], { cwd: root, stdio: 'inherit' });

/**
 * 开发辅助：用 esbuild 把 scripts/ 下的 TS 验证脚本打包成 CJS 后执行。
 * 直接 require('esbuild') 调用，避免依赖 node_modules/.bin 里是否存在 esbuild 命令。
 * 用法：node scripts/run-ts-script.cjs scripts/verify-import-fields.ts
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const esbuild = require('esbuild');

const entry = process.argv[2];
if (!entry) {
  console.error('用法：node scripts/run-ts-script.cjs <相对仓库根目录的 .ts 文件>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'node_modules', '.tmp');
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, `${path.basename(entry).replace(/\.ts$/, '')}.cjs`);

esbuild.buildSync({
  entryPoints: [path.join(root, entry)],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'warning',
});

execFileSync(process.execPath, [outfile], { stdio: 'inherit' });

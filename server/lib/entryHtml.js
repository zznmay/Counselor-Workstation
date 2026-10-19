/**
 * SPA 入口自愈：dist/index.html 在部分发布链路上不会随构建更新（可能仍是旧构建的引用），
 * 导致线上一直加载旧 JS 资产——表现为「改了代码但线上没生效」。
 *
 * 做法：启动时扫描 dist/assets，取 mtime 最新的 index-*.js / index-*.css，
 * 把入口 HTML 里的资产引用改写为最新构建，另存为 dist/entry.html 供静态托管使用。
 * 不修改 index.html 本身（可能被发布链路覆盖），也不改变前端构建流程。
 */
const fs = require('fs');
const path = require('path');

const { DIST_DIR } = require('./config');

const ENTRY_FILE = 'entry.html';
/** 与 vite 默认命名一致；文件名形如 index-<hash>.js / index-<hash>.css */
const ASSET_RE = /^index-[A-Za-z0-9_-]+\.(js|css)$/;

/** dist/assets 下每种扩展名的最新资产（按 mtime，取不到 mtime 时按文件名兜底） */
function newestAssets(assetsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(assetsDir, { withFileTypes: true });
  } catch {
    return {};
  }
  const best = {};
  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    const m = ASSET_RE.exec(dirent.name);
    if (!m) continue;
    const ext = m[1];
    const file = path.join(assetsDir, dirent.name);
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      mtime = 0;
    }
    const prev = best[ext];
    if (!prev || mtime > prev.mtime || (mtime === prev.mtime && dirent.name > prev.name)) {
      best[ext] = { name: dirent.name, mtime };
    }
  }
  return best;
}

/**
 * 生成（并返回）自愈后的入口 HTML 路径；dist 缺失或无资产时返回 null，调用方回退原逻辑。
 * 幂等：内容不变则不重复写盘。
 */
function ensureEntryHtml() {
  const sourceHtml = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(sourceHtml)) return null;

  const assets = newestAssets(path.join(DIST_DIR, 'assets'));
  if (!assets.js && !assets.css) return null;

  let html = fs.readFileSync(sourceHtml, 'utf8');
  if (assets.js) {
    html = html.replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/g, `/assets/${assets.js.name}`);
  }
  if (assets.css) {
    html = html.replace(/\/assets\/index-[A-Za-z0-9_-]+\.css/g, `/assets/${assets.css.name}`);
  }

  const entryPath = path.join(DIST_DIR, ENTRY_FILE);
  let previous = null;
  try {
    previous = fs.readFileSync(entryPath, 'utf8');
  } catch {
    previous = null;
  }
  if (previous !== html) fs.writeFileSync(entryPath, html);

  const stale = assets.js && !html.includes(`/assets/${assets.js.name}`);
  if (stale) {
    console.warn('[entry] 入口资产改写异常，已回退 dist/index.html');
    return sourceHtml;
  }
  return entryPath;
}

/**
 * 资产快照（供 /api/health 自检）：线上「改了代码没生效」时，先看这个判断是
 * - newest.js 与 index.html 引用不一致 → 入口陈旧（由 ensureEntryHtml 自愈）
 * - newest.js 缺失新构建 → 发布链路没把 dist 上传到沙箱（需改构建输出目录或云端构建）
 */
function assetSnapshot() {
  const assets = newestAssets(path.join(DIST_DIR, 'assets'));
  let entryRef = null;
  try {
    const html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
    entryRef = (/\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html) || [])[1] ?? null;
  } catch {
    entryRef = null;
  }
  return {
    newestJs: assets.js?.name ?? null,
    newestCss: assets.css?.name ?? null,
    indexHtmlRef: entryRef,
    entryHtmlExists: fs.existsSync(path.join(DIST_DIR, ENTRY_FILE)),
  };
}

module.exports = { ensureEntryHtml, newestAssets, assetSnapshot, ENTRY_FILE };

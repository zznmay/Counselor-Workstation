/**
 * SPA 入口自愈：dist/index.html 在部分发布链路上不会随构建更新（可能仍是旧构建的引用），
 * 导致线上一直加载旧 JS 资产——表现为「改了代码但线上没生效」。
 *
 * 做法：优先读取 Vite manifest（dist/manifest.json，兼容 dist/.vite/manifest.json）中的真实 entry，
 * 把入口 HTML 里的资产引用改写为当前构建，另存为 dist/entry.html 供静态托管使用。
 * 代码分割后 dist/assets 下会有多个 index-*.js 懒加载块，不能再按「最新 mtime」猜入口；
 * manifest 缺失时才回退旧的 mtime 逻辑（仅适用于单包构建）。
 * 不修改 index.html 本身（可能被发布链路覆盖），也不改变前端构建流程。
 */
const fs = require('fs');
const path = require('path');

const { DIST_DIR } = require('./config');

const ENTRY_FILE = 'entry.html';
/** Vite 5 默认写 .vite/manifest.json；项目配置为 dist/manifest.json，两种都兼容 */
const MANIFEST_FILES = [
  path.join(DIST_DIR, 'manifest.json'),
  path.join(DIST_DIR, '.vite', 'manifest.json'),
];
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

/** 从 Vite manifest 读取真实入口：返回 { js, css[] }，缺失或格式异常返回 null */
function manifestEntry() {
  for (const file of MANIFEST_FILES) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entry = manifest['index.html'];
      if (!entry || typeof entry.file !== 'string' || !entry.file.endsWith('.js')) continue;
      return {
        js: path.basename(entry.file),
        css: Array.isArray(entry.css) ? entry.css.filter((f) => typeof f === 'string').map((f) => path.basename(f)) : [],
      };
    } catch {
      // 尝试下一个 manifest 位置
    }
  }
  return null;
}

/** 用 manifest 入口替换 HTML 中的入口 script / stylesheet 引用 */
function rewriteFromManifest(html, entry) {
  let next = html.replace(
    /(<script\b[^>]*\bsrc=")\/assets\/[^"]+\.js("[^>]*>)/i,
    `$1/assets/${entry.js}$2`,
  );
  if (entry.css.length > 0) {
    next = next.replace(
      /[ \t]*<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/[^"]+\.css"[^>]*>\s*/gi,
      '',
    );
    const tags = entry.css
      .map((file) => `    <link rel="stylesheet" crossorigin href="/assets/${file}">`)
      .join('\n');
    next = next.replace(/\s*<\/head>/i, `\n${tags}\n  </head>`);
  }
  return next;
}

/** 旧逻辑：单包构建下按最新 index-*.js/css 改写 */
function rewriteLegacy(html, assets) {
  let next = html;
  if (assets.js) {
    next = next.replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/g, `/assets/${assets.js.name}`);
  }
  if (assets.css) {
    next = next.replace(/\/assets\/index-[A-Za-z0-9_-]+\.css/g, `/assets/${assets.css.name}`);
  }
  return next;
}

/**
 * 生成（并返回）自愈后的入口 HTML 路径；dist 缺失或无资产时返回 null，调用方回退原逻辑。
 * 幂等：内容不变则不重复写盘。
 */
function ensureEntryHtml() {
  const sourceHtml = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(sourceHtml)) return null;

  const manifest = manifestEntry();
  const assetsDir = path.join(DIST_DIR, 'assets');
  const legacyAssets = manifest ? null : newestAssets(assetsDir);
  if (!manifest && !legacyAssets?.js && !legacyAssets?.css) return null;

  // 代码分割后 assets 下会有多个 index-*.js（懒加载块）。缺少 manifest 时按 mtime 猜入口
  // 可能把某个路由块当成入口；此时宁可保留原 index.html，也不写坏入口。
  if (!manifest && legacyAssets?.js) {
    let indexChunks = [];
    try {
      indexChunks = fs.readdirSync(assetsDir).filter((name) => /^index-.*\.js$/.test(name));
    } catch {
      indexChunks = [];
    }
    if (indexChunks.length > 1) {
      console.warn('[entry] 缺少 manifest 且存在多个 index-*.js，无法安全判定入口，保留原 index.html');
      return sourceHtml;
    }
  }

  let html = fs.readFileSync(sourceHtml, 'utf8');
  html = manifest ? rewriteFromManifest(html, manifest) : rewriteLegacy(html, legacyAssets);

  const entryPath = path.join(DIST_DIR, ENTRY_FILE);
  let previous = null;
  try {
    previous = fs.readFileSync(entryPath, 'utf8');
  } catch {
    previous = null;
  }
  if (previous !== html) fs.writeFileSync(entryPath, html);

  const expected = manifest ? manifest.js : legacyAssets?.js?.name;
  const stale = expected && !html.includes(`/assets/${expected}`);
  if (stale) {
    console.warn('[entry] 入口资产改写异常，已回退 dist/index.html');
    return sourceHtml;
  }
  return entryPath;
}

/**
 * 资产快照（供 /api/health 自检）：线上「改了代码没生效」时，先看这个判断
 * - newest.js 与 index.html 引用不一致 → 入口陈旧（由 ensureEntryHtml 自愈）
 * - newest.js 缺失新构建 → 发布链路没把 dist 上传到沙箱（需改构建输出目录或云端构建）
 */
function assetSnapshot() {
  const assets = newestAssets(path.join(DIST_DIR, 'assets'));
  const manifest = manifestEntry();
  let entryRef = null;
  try {
    const html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
    entryRef = (/\/assets\/([^"]+\.js)/.exec(html) || [])[1] ?? null;
  } catch {
    entryRef = null;
  }
  return {
    // 有 manifest 时以真实 entry 为准；newest* 仅作旧构建兜底信息
    newestJs: manifest?.js ?? assets.js?.name ?? null,
    newestCss: manifest?.css?.[0] ?? assets.css?.name ?? null,
    manifestEntry: manifest?.js ?? null,
    indexHtmlRef: entryRef,
    entryHtmlExists: fs.existsSync(path.join(DIST_DIR, ENTRY_FILE)),
  };
}

module.exports = { ensureEntryHtml, newestAssets, manifestEntry, assetSnapshot, ENTRY_FILE };

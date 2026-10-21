/**
 * 构建产物预压缩：为可压缩的静态文件生成 .br / .gz 旁路文件。
 * 由 Vite closeBundle 与服务端启动时各调用一次（幂等，按源文件 mtime 判断是否需要重做）。
 * 不引入第三方依赖，Node 内置 zlib 即可。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COMPRESSIBLE_EXT = new Set([
  '.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.xml', '.map',
]);

/** 低于该体积的响应压缩收益有限，直接跳过 */
const MIN_BYTES = 1024;

function isFresh(compressedPath, sourceStat) {
  try {
    const stat = fs.statSync(compressedPath);
    return stat.isFile() && stat.size > 0 && stat.mtimeMs >= sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

function compressFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < MIN_BYTES) return false;
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESSIBLE_EXT.has(ext)) return false;

  const gzPath = `${file}.gz`;
  const brPath = `${file}.br`;
  const needGzip = !isFresh(gzPath, stat);
  const needBrotli = typeof zlib.brotliCompressSync === 'function' && !isFresh(brPath, stat);
  if (!needGzip && !needBrotli) return false;

  const source = fs.readFileSync(file);
  if (needGzip) fs.writeFileSync(gzPath, zlib.gzipSync(source, { level: 9 }));
  if (needBrotli) {
    fs.writeFileSync(
      brPath,
      zlib.brotliCompressSync(source, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
    );
  }
  return true;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.vite') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * 压缩目录下所有符合条件的文件。
 * @returns {{files:number, compressed:number, bytesSaved:number, errors:string[]}}
 */
function compressDir(dir) {
  const files = [];
  walk(dir, files);
  const result = { files: files.length, compressed: 0, bytesSaved: 0, errors: [] };
  for (const file of files) {
    try {
      const before = fs.statSync(file).size;
      if (compressFile(file)) {
        result.compressed += 1;
        const gz = `${file}.gz`;
        const br = `${file}.br`;
        let best = before;
        if (fs.existsSync(gz)) best = Math.min(best, fs.statSync(gz).size);
        if (fs.existsSync(br)) best = Math.min(best, fs.statSync(br).size);
        result.bytesSaved += before - best;
      }
    } catch (e) {
      result.errors.push(`${file}: ${e && e.message ? e.message : e}`);
    }
  }
  return result;
}

/** 根据原始文件扩展名返回静态资源 Content-Type（预压缩文件本身没有业务扩展名） */
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** 静态资源缓存策略：Vite 哈希资产可长期缓存，HTML 每次协商，其余按小时缓存 */
function cacheControlOf(urlPath) {
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (urlPath.endsWith('.html')) return 'no-cache';
  return 'public, max-age=3600';
}

function acceptsEncoding(req, encoding) {
  const raw = req.headers['accept-encoding'];
  if (!raw) return false;
  for (const part of String(raw).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (name !== encoding) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) !== 0;
  }
  return false;
}

/**
 * 预压缩静态资源中间件：命中 .br/.gz 时直接回放，未命中交给 express.static。
 * 必须挂在 SPA 入口处理之后、express.static 之前。
 */
function servePrecompressed(distDir) {
  const root = path.resolve(distDir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.path || req.path.startsWith('/api')) return next();

    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const target = path.resolve(root, `.${rel}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return next();

    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

    let encoding = null;
    let file = target;
    if (acceptsEncoding(req, 'br') && isFresh(`${target}.br`, stat)) {
      encoding = 'br';
      file = `${target}.br`;
    } else if (acceptsEncoding(req, 'gzip') && isFresh(`${target}.gz`, stat)) {
      encoding = 'gzip';
      file = `${target}.gz`;
    }
    if (!encoding) return next();

    res.sendFile(file, {
      headers: {
        'Content-Type': contentTypeOf(target),
        'Content-Encoding': encoding,
        'Cache-Control': cacheControlOf(req.path),
        Vary: 'Accept-Encoding',
      },
    }, (err) => {
      if (!err) return;
      if (!res.headersSent) next();
      else next(err);
    });
  };
}

module.exports = {
  compressDir,
  compressFile,
  servePrecompressed,
  contentTypeOf,
  cacheControlOf,
  COMPRESSIBLE_EXT,
};

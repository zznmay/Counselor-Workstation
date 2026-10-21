/**
 * 轻量响应压缩：只包装 res.send，压缩 JSON/HTML/文本等可压缩响应。
 * 静态文件由 lib/precompress.js 的预压缩中间件处理，这里不重复压缩。
 */
const zlib = require('zlib');

const COMPRESSIBLE_TYPE = /^(application\/(json|javascript|xml)|text\/|image\/svg\+xml)/i;
const MIN_BYTES = 1024;

function accepts(req, encoding) {
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

function appendVary(res, value) {
  const prev = res.getHeader('Vary');
  if (!prev) {
    res.setHeader('Vary', value);
    return;
  }
  const parts = String(prev).split(',').map((p) => p.trim().toLowerCase());
  if (!parts.includes(value.toLowerCase())) res.setHeader('Vary', `${prev}, ${value}`);
}

function responseCompression() {
  return (req, res, next) => {
    const canBrotli = typeof zlib.brotliCompressSync === 'function' && accepts(req, 'br');
    const canGzip = !canBrotli && accepts(req, 'gzip');
    if (!canBrotli && !canGzip) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      if (req.method === 'HEAD' || res.headersSent) return originalSend(body);
      if (res.statusCode < 200 || res.statusCode >= 300 || res.statusCode === 204) {
        return originalSend(body);
      }
      if (res.getHeader('Content-Encoding')) return originalSend(body);
      const type = String(res.getHeader('Content-Type') || '');
      if (!COMPRESSIBLE_TYPE.test(type)) return originalSend(body);
      const cacheControl = String(res.getHeader('Cache-Control') || '');
      if (cacheControl.includes('no-transform')) return originalSend(body);

      let raw;
      if (typeof body === 'string') raw = Buffer.from(body);
      else if (Buffer.isBuffer(body)) raw = body;
      else return originalSend(body);
      if (raw.length < MIN_BYTES) return originalSend(body);

      const out = canBrotli
        ? zlib.brotliCompressSync(raw, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
        })
        : zlib.gzipSync(raw, { level: 6 });

      res.setHeader('Content-Encoding', canBrotli ? 'br' : 'gzip');
      appendVary(res, 'Accept-Encoding');
      res.removeHeader('Content-Length');
      return originalSend(out);
    };
    next();
  };
}

module.exports = { responseCompression };

/**
 * 极简 ZIP 读写（deflate / store + UTF-8 文件名），零第三方依赖。
 *
 * 仅覆盖迁移包场景：少量文件、无加密、非 ZIP64。生成的文件为标准 ZIP，
 * Windows 资源管理器 / macOS 归档工具 / unzip 均可直接解压。
 */
const zlib = require('zlib');

const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data ?? ''), 'utf8');
}

function isZip(buf) {
  if (!buf || buf.length < 4) return false;
  return (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06) || (buf[2] === 0x07 && buf[3] === 0x08))
  );
}

/**
 * 生成 ZIP Buffer。
 * @param {{ name: string, data: Buffer|string }[]} entries
 * @param {Date} [date] 统一写入的修改时间
 */
function createZip(entries, date = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('ZIP 至少需要一个文件');
  if (entries.length > 0xffff) throw new Error('ZIP 文件数量超出上限');
  const { time, date: dosDate } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name || ''), 'utf8');
    if (!nameBuf.length) throw new Error('ZIP 文件名不能为空');
    const raw = toBuffer(entry.data);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    if (raw.length > 0xffffffff || payload.length > 0xffffffff) throw new Error('单个文件超过 4GB，暂不支持');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** 查找 EOCD（兼容末尾 zip 注释） */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * 解包 ZIP，返回 Map<文件名, Buffer>。
 * @param {Buffer} buf
 * @param {{ maxUncompressedBytes?: number }} [options]
 */
function readZipEntries(buf, options = {}) {
  const maxBytes = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  if (!isZip(buf)) throw new Error('不是合法的 ZIP 文件');
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 结构不完整（缺少目录结束记录）');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error('暂不支持 ZIP64 格式');

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error(`ZIP 内文件「${name}」已加密，暂不支持`);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 格式');
    }
    if (uncompSize > maxBytes) throw new Error(`ZIP 内文件「${name}」解压后超出限制`);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP 内文件「${name}」的本地头损坏`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) throw new Error(`ZIP 内文件「${name}」数据不完整`);
    const payload = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = Buffer.from(payload);
    } else if (method === 8) {
      data = zlib.inflateRawSync(payload, { maxOutputLength: maxBytes });
    } else {
      throw new Error(`ZIP 内文件「${name}」使用了不支持的压缩算法`);
    }
    if (data.length !== uncompSize) throw new Error(`ZIP 内文件「${name}」解压长度不一致`);
    if (crc32(data) !== crc) throw new Error(`ZIP 内文件「${name}」校验失败`);
    entries.set(name, data);
  }
  return entries;
}

/** 取第一个匹配的条目（优先精确名，其次后缀匹配，跳过 macOS 元数据目录） */
function pickEntry(entries, predicate) {
  for (const [name, data] of entries) {
    if (name.startsWith('__MACOSX/') || name.endsWith('/')) continue;
    if (predicate(name)) return { name, data };
  }
  return null;
}

module.exports = { createZip, readZipEntries, isZip, pickEntry, crc32, MAX_UNCOMPRESSED_BYTES };

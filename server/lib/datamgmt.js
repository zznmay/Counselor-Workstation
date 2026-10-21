/**
 * 数据管理（备份 / 恢复 / 迁移）核心能力。
 *
 * 设计沿用「学生考勤平台 · 数据管理技术架构」的可复用范式，并按本平台的
 * Express + SQLite（node:sqlite）实现落地：
 *   1. 统一 Bundle 格式 + manifest 逐表「条数 + 内容 sha256」强校验，缺一即拒；
 *   2. 恢复三段式：预检（不落盘）→ 确认短语「恢复」→ 恢复前自动快照（可整体回滚）；
 *   3. 自动备份：内容签名去重（签名未变则跳过写包）+ 环形保留 + setTimeout 链式调度；
 *   4. oplog 环形保留最近 500 条操作；
 *   5. 数据安全铁律：任何逻辑都不得清空业务数据，恢复前必留快照。
 *
 * 本模块只承载业务与存储逻辑，不接触 req/res（HTTP 层见 routes/data.js）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const dbx = require('./db');
const zip = require('./zip');
const { BACKUP_DIR, DATA_DIR, DB_PATH } = require('./config');

/** 数据包结构版本：结构变更（增删表 / 改字段语义）时才递增 */
const SCHEMA_VERSION = 2;
const APP_VERSION = '1.0';
const SOURCE = 'counselor-workbench';

/** 数据包类型字典（与前端 src/constants 的 BUNDLE_KINDS 保持一致） */
const BUNDLE_KINDS = ['手动备份', '自动备份', '恢复前快照', '迁移包', '上传包'];

/** 迁移包类型：落盘为 ZIP（bundle.json + README.txt），其余类型仍为 JSON */
const MIGRATION_KIND = '迁移包';

/** 数据表中文名（数据总览卡片 / 恢复预检展示用，避免界面出现英文表名） */
const TABLE_LABELS = {
  users: '登录账号',
  roles: '角色权限',
  userRoles: '账号角色',
  students: '学生名单',
  studentCounselors: '学生辅导员',
  grades: '年级管理',
  classes: '班级管理',
  classCounselors: '班级教师',
  classPendingStaff: '待同步教师',
  dormitories: '寝室管理',
  conversations: '谈心谈话',
  mentalHealth: '心理关注',
  mentalInterviews: '心理访谈',
  mentalInterviewTemplates: '访谈模板',
  mentalLevelLogs: '等级变更记录',
  warnings: '预警记录',
  notices: '通知公告',
  approvals: '请假审批',
  todos: '待办事项',
  templateCategories: '模板分类',
  templateFiles: '模板文件',
  csScheduler: '值班排班',
  accessLogs: '访问日志',
  loginAttempts: '登录尝试',
};

/** 计算「更新时间」时优先参考的日期列（按顺序 coalesce） */
const TIME_COLUMNS = [
  'updatedAt', 'createdAt', 'ts', 'talkTime', 'submittedAt', 'raisedAt',
  'publishAt', 'interviewDate', 'signedAt', 'uploadedAt', 'handledAt',
  'approvedAt', 'completedAt', 'dueDate', 'enrollDate', 'lockedUntil',
];

/** 自动备份间隔可选值（小时）与保留份数区间 */
const INTERVAL_OPTIONS = [1, 2, 4, 6, 12, 24];
const KEEP_MIN = 3;
const KEEP_MAX = 30;

/** 恢复确认短语：必须原样输入，防误操作 */
const RESTORE_PHRASE = '恢复';

/** 上传包体积上限（base64 解码后字节）：受 express.json 20mb 限制 */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** 操作日志环形保留条数 */
const OPLOG_KEEP = 500;

/** 参与导出/恢复的业务表（顺序 = 导入时的写入顺序；删除时倒序） */
const EXPORT_TABLES = [
  'users', 'roles', 'userRoles', 'students', 'studentCounselors',
  'grades', 'classes', 'classCounselors', 'classPendingStaff', 'dormitories',
  'conversations', 'mentalHealth', 'mentalInterviews', 'mentalInterviewTemplates', 'mentalLevelLogs',
  'warnings', 'notices', 'approvals', 'todos',
  'templateCategories', 'templateFiles', 'csScheduler',
  'accessLogs', 'loginAttempts',
];

/** 数据管理自身的表：不进数据包（避免恢复时自引用覆盖） */
const MANAGED_TABLES = ['dataBundles', 'dataSettings', 'dataOplog'];

function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 文件时间戳片段：用于生成不重复的文件名 */
function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sha256(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

/** 表名白名单校验（SQL 拼接只接受白名单内的表名） */
function assertTable(table) {
  if (![...EXPORT_TABLES, ...MANAGED_TABLES].includes(table)) {
    const err = new Error(`未知数据表：${table}`);
    err.status = 400;
    throw err;
  }
  return table;
}

function columnsOf(table) {
  return dbx.all(`PRAGMA table_info(${assertTable(table)})`).map((c) => c.name);
}

/* ==================================================================
   一、Bundle 构建
   ================================================================== */

/** 读取全库快照并按表生成 manifest（count + sha256） */
function buildBundle({ kind, label, note, actor }) {
  const tables = {};
  const counts = {};
  const manifest = [];
  for (const table of EXPORT_TABLES) {
    const rows = dbx.all(`SELECT * FROM ${assertTable(table)}`);
    tables[table] = rows;
    counts[table] = rows.length;
    manifest.push({ table, count: rows.length, sha256: sha256(JSON.stringify(rows)) });
  }
  const bundle = {
    kind,
    label,
    note: note ?? null,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: actor ?? null,
    source: SOURCE,
    counts,
    manifest,
    tables,
  };
  return bundle;
}

/** 迁移包内附的中文说明（解压后可直接阅读） */
function migrationReadme(bundle) {
  const total = Object.values(bundle.counts ?? {}).reduce((a, b) => a + b, 0);
  return [
    '知行辅导员工作台 · 数据迁移包',
    '',
    `标签：${bundle.label ?? '未命名'}`,
    `导出时间：${bundle.exportedAt ?? '—'}`,
    `数据包结构版本：${bundle.schemaVersion ?? '—'}`,
    `业务记录总数：${total} 条`,
    '',
    '压缩包内容：',
    '  bundle.json  全库业务数据（导入时使用此文件或整个 ZIP 包）',
    '  README.txt   本说明文件',
    '',
    '导入方式：',
    '  1. 登录目标环境的辅导员工作台；',
    '  2. 进入「数据管理 → 迁移助手」，上传本 ZIP 迁移包；',
    '  3. 通过恢复预检后输入确认短语「恢复」即可完整导入。',
    '',
    '提示：导入前系统会自动生成恢复前快照，误操作可再次恢复该快照回滚。',
  ].join('\n');
}

/** 生成迁移 ZIP：bundle.json + README.txt */
function buildMigrationZip(bundle) {
  return zip.createZip([
    { name: 'bundle.json', data: JSON.stringify(bundle, null, 2) },
    { name: 'README.txt', data: migrationReadme(bundle) },
  ]);
}

/** 原子写盘（tmp + rename），迁移包写 ZIP，其余写 JSON，返回落盘信息 */
function writeBundleFile(bundle) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const safeLabel = String(bundle.label || 'bundle').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40);
  const ext = bundle.kind === MIGRATION_KIND ? '.zip' : '.json';
  // 同一秒内连续创建同名包会撞文件名（fileName 唯一），补 4 位随机后缀保证不冲突
  const rand = crypto.randomBytes(2).toString('hex');
  let fileName = `bundle-${stamp()}-${rand}-${safeLabel}${ext}`;
  while (fs.existsSync(path.join(BACKUP_DIR, fileName))) {
    fileName = `bundle-${stamp()}-${crypto.randomBytes(3).toString('hex')}-${safeLabel}${ext}`;
  }
  const target = path.join(BACKUP_DIR, fileName);
  const tmp = `${target}.tmp`;
  const payload = bundle.kind === MIGRATION_KIND
    ? buildMigrationZip(bundle)
    : Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, target);
  const buf = fs.readFileSync(target);
  return { fileName, filePath: target, sizeBytes: buf.length, sha256: sha256(buf) };
}

/** 解析任意来源的包体：ZIP（bundle.json）/ gzip JSON / 纯 JSON */
function parseBundleBuffer(raw) {
  let buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? '');
  if (zip.isZip(buf)) {
    const entries = zip.readZipEntries(buf);
    const exact = entries.get('bundle.json');
    const picked = exact ? { name: 'bundle.json', data: exact } : zip.pickEntry(entries, (name) => name.toLowerCase().endsWith('.json'));
    if (!picked) {
      const err = new Error('ZIP 迁移包中未找到 bundle.json');
      err.status = 400;
      throw err;
    }
    buf = picked.data;
  } else if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let bundle;
  try {
    bundle = JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('迁移包内容不是合法 JSON');
    err.status = 400;
    throw err;
  }
  return bundle;
}

function registerBundle({ kind, label, note, actor, file, counts }) {
  return dbx.run(
    `INSERT INTO dataBundles (kind, label, note, fileName, sizeBytes, sha256, schemaVersion, counts, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      kind,
      label,
      note ?? null,
      file.fileName,
      file.sizeBytes,
      file.sha256,
      SCHEMA_VERSION,
      JSON.stringify(counts ?? {}),
      actor ?? null,
      nowStr(),
    ],
  );
}

/** 创建一份数据包（手动备份 / 自动备份 / 恢复前快照 / 迁移包通用） */
function createBackup({ kind = '手动备份', label, note, actor }) {
  const finalLabel = String(label || '').trim() || `${kind}-${stamp()}`;
  const bundle = buildBundle({ kind, label: finalLabel, note, actor });
  const file = writeBundleFile(bundle);
  const info = registerBundle({ kind, label: finalLabel, note, actor, file, counts: bundle.counts });
  const id = Number(info.lastInsertRowid);
  logOp(actor, '创建备份', `${kind}「${finalLabel}」共 ${Object.values(bundle.counts).reduce((a, b) => a + b, 0)} 条`);
  return getBundle(id);
}

/* ==================================================================
   二、校验与恢复
   ================================================================== */

/** 逐表复核「条数 + 内容 sha256」；缺表按 0 条宽松处理（历史包兼容） */
function verifyBundle(bundle) {
  const checks = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { ok: false, checks: [{ item: '包结构', ok: false, detail: '不是合法的数据包对象' }] };
  }
  if (!bundle.tables || typeof bundle.tables !== 'object') {
    return { ok: false, checks: [{ item: 'tables', ok: false, detail: '缺少数据表内容' }] };
  }
  const manifest = Array.isArray(bundle.manifest) ? bundle.manifest : [];
  checks.push({
    item: '数据包结构版本',
    ok: Number(bundle.schemaVersion) === SCHEMA_VERSION,
    detail: `包内 ${bundle.schemaVersion ?? '未声明'} / 当前 ${SCHEMA_VERSION}`,
  });
  for (const table of EXPORT_TABLES) {
    const rows = bundle.tables[table] ?? [];
    const label = TABLE_LABELS[table] ?? '未知数据表';
    if (!Array.isArray(rows)) {
      checks.push({ item: label, table, ok: false, detail: '内容不是数组' });
      continue;
    }
    const declared = manifest.find((m) => m && m.table === table);
    const actualSha = sha256(JSON.stringify(rows));
    const ok = !declared || (declared.count === rows.length && declared.sha256 === actualSha);
    checks.push({
      item: label,
      table,
      ok,
      detail: declared
        ? `${rows.length} 条 · 内容校验${ok ? '一致' : '不一致'}`
        : `${rows.length} 条 · 无校验记录（按宽松处理）`,
    });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** 与当前库逐表对比条数（用于恢复预检展示，不落盘） */
function diffCounts(bundle) {
  const diff = [];
  for (const table of EXPORT_TABLES) {
    const incoming = (bundle.tables?.[table] ?? []).length;
    const current = dbx.get(`SELECT COUNT(*) AS c FROM ${assertTable(table)}`).c;
    if (incoming !== current) {
      diff.push({ table, name: TABLE_LABELS[table] ?? '未知数据表', current, incoming, delta: incoming - current });
    }
  }
  return diff;
}

function previewRestore(bundle) {
  const verify = verifyBundle(bundle);
  return {
    ok: verify.ok,
    checks: verify.checks,
    diff: diffCounts(bundle),
    meta: {
      kind: bundle.kind ?? null,
      label: bundle.label ?? null,
      exportedAt: bundle.exportedAt ?? null,
      source: bundle.source ?? null,
      schemaVersion: bundle.schemaVersion ?? null,
    },
  };
}

/**
 * 事务化整体替换：先倒序清空，再按表写入。
 * 外键在事务外临时关闭（PRAGMA foreign_keys 在事务内无效），结束后恢复。
 */
function applyBundle(bundle) {
  const rowsByTable = {};
  for (const table of EXPORT_TABLES) {
    const rows = bundle.tables?.[table];
    rowsByTable[table] = Array.isArray(rows) ? rows : [];
  }
  /**
   * 旧数据包兼容（教师唯一来源改造前导出的包）：classCounselors 行没有 roleType 列。
   * 该列 NOT NULL，直接写入会整包失败，故按「历史关联一律视为辅导员」的迁移语义回填默认值。
   */
  for (const row of rowsByTable.classCounselors ?? []) {
    if (row && (row.roleType === undefined || row.roleType === null || row.roleType === '')) {
      row.roleType = 'counselor';
    }
  }
  const colsByTable = {};
  for (const table of EXPORT_TABLES) colsByTable[table] = columnsOf(table);

  dbx.db.exec('PRAGMA foreign_keys = OFF');
  try {
    dbx.withTransaction(() => {
      for (const table of [...EXPORT_TABLES].reverse()) {
        dbx.run(`DELETE FROM ${assertTable(table)}`);
        try {
          dbx.run('DELETE FROM sqlite_sequence WHERE name = ?', [table]);
        } catch {
          /* 无 AUTOINCREMENT 的表没有该记录，忽略 */
        }
      }
      for (const table of EXPORT_TABLES) {
        const cols = colsByTable[table];
        if (cols.length === 0) continue;
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        const stmt = dbx.db.prepare(sql);
        for (const row of rowsByTable[table]) {
          stmt.run(...cols.map((c) => (row && row[c] !== undefined ? row[c] : null)));
        }
      }
    });
  } finally {
    dbx.db.exec('PRAGMA foreign_keys = ON');
  }
}

/** 恢复：确认短语校验 → 恢复前快照 → 整体替换 → 记日志 */
function restore({ bundle, confirm, actor }) {
  if (String(confirm || '').trim() !== RESTORE_PHRASE) {
    const err = new Error(`请输入确认短语「${RESTORE_PHRASE}」以继续恢复`);
    err.status = 400;
    throw err;
  }
  const verify = verifyBundle(bundle);
  if (!verify.ok) {
    const bad = verify.checks.filter((c) => !c.ok).map((c) => c.item).join('、');
    const err = new Error(`数据包校验未通过（${bad}），已中止恢复`);
    err.status = 400;
    throw err;
  }
  // 恢复前自动快照：任何情况下都能整体回滚
  const snap = createBackup({ kind: '恢复前快照', label: `恢复前快照-${stamp()}`, note: '系统在执行恢复前自动创建', actor });
  const before = diffCounts(bundle);
  applyBundle(bundle);
  logOp(actor, '恢复数据', `从「${bundle.label ?? '未命名包'}」恢复，前快照 #${snap.id}，涉及 ${before.length} 张表变化`);
  return { ok: true, snapshotId: snap.id, changes: before };
}

/* ==================================================================
   三、数据包查询 / 下载 / 上传 / 删除
   ================================================================== */

function getBundle(id) {
  return dbx.get('SELECT * FROM dataBundles WHERE id = ?', [Number(id)]) ?? null;
}

function bundleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    note: row.note ?? null,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    schemaVersion: row.schemaVersion,
    counts: safeJson(row.counts, {}),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

function safeJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** 列表：关键词（标签/备注）+ 类型 + 时间区间 + 分页 + 排序 */
function listBundles({ keyword = '', kind, startDate, endDate, page = 1, pageSize = 10, sortBy = 'createdAt', sortOrder = 'desc' } = {}) {
  const p = Math.max(1, parseInt(page) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
  const kw = String(keyword).trim();
  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(label LIKE ? OR note LIKE ? OR fileName LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (kind) { conds.push('kind = ?'); params.push(kind); }
  if (startDate) { conds.push('substr(createdAt, 1, 10) >= ?'); params.push(startDate); }
  if (endDate) { conds.push('substr(createdAt, 1, 10) <= ?'); params.push(endDate); }
  const where = conds.join(' AND ');

  const sortWhitelist = { createdAt: 'createdAt', sizeBytes: 'sizeBytes', id: 'id' };
  const sortCol = sortWhitelist[sortBy] ?? 'createdAt';
  const dir = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const total = dbx.get(`SELECT COUNT(*) AS c FROM dataBundles WHERE ${where}`, params).c;
  const rows = dbx.all(
    `SELECT * FROM dataBundles WHERE ${where} ORDER BY ${sortCol} ${dir}, id DESC LIMIT ? OFFSET ?`,
    [...params, size, (p - 1) * size],
  );
  return { list: rows.map(bundleRow), total, page: p, pageSize: size };
}

function bundleFilePath(id) {
  const row = getBundle(id);
  if (!row) {
    const err = new Error('数据包不存在');
    err.status = 404;
    throw err;
  }
  const filePath = path.join(BACKUP_DIR, row.fileName);
  if (!fs.existsSync(filePath)) {
    const err = new Error('数据包文件已丢失（可能被手工清理）');
    err.status = 404;
    throw err;
  }
  return { row, filePath };
}

function readBundleById(id) {
  const { row, filePath } = bundleFilePath(id);
  const bundle = parseBundleBuffer(fs.readFileSync(filePath));
  bundle.label = bundle.label ?? row.label;
  return bundle;
}

function updateBundle(id, { label, note }, actor) {
  const row = getBundle(id);
  if (!row) {
    const err = new Error('数据包不存在');
    err.status = 404;
    throw err;
  }
  const nextLabel = String(label ?? row.label).trim();
  if (!nextLabel) {
    const err = new Error('数据包标签不能为空');
    err.status = 400;
    throw err;
  }
  dbx.run('UPDATE dataBundles SET label = ?, note = ? WHERE id = ?', [nextLabel, note ?? null, Number(id)]);
  logOp(actor, '编辑数据包', `#${id} 标签更新为「${nextLabel}」`);
  return getBundle(Number(id));
}

function deleteBundle(id, actor) {
  const row = getBundle(id);
  if (!row) {
    const err = new Error('数据包不存在');
    err.status = 404;
    throw err;
  }
  const filePath = path.join(BACKUP_DIR, row.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  dbx.run('DELETE FROM dataBundles WHERE id = ?', [Number(id)]);
  logOp(actor, '删除数据包', `#${id}「${row.label}」（${row.fileName}）`);
  return { ok: true };
}

/** 上传数据包：base64（可 gzip）→ 校验 → 落盘登记 */
function saveUploadedBundle({ fileName, contentBase64, actor, label, note }) {
  const raw = Buffer.from(String(contentBase64 || ''), 'base64');
  if (raw.length === 0) {
    const err = new Error('上传内容为空');
    err.status = 400;
    throw err;
  }
  if (raw.length > MAX_UPLOAD_BYTES) {
    const err = new Error(`上传内容超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`);
    err.status = 413;
    throw err;
  }
  const bundle = parseBundleBuffer(raw);
  const verify = verifyBundle(bundle);
  if (!verify.ok) {
    const bad = verify.checks.filter((c) => !c.ok).map((c) => c.item).join('、');
    const err = new Error(`数据包校验未通过（${bad}）`);
    err.status = 400;
    throw err;
  }
  const finalLabel = String(label || bundle.label || fileName || '上传包').trim();
  const file = writeBundleFile({ ...bundle, label: finalLabel, kind: '上传包' });
  const info = registerBundle({
    kind: '上传包',
    label: finalLabel,
    note: note ?? null,
    actor,
    file,
    counts: bundle.counts ?? {},
  });
  const id = Number(info.lastInsertRowid);
  logOp(actor, '上传数据包', `#${id}「${finalLabel}」来源文件 ${fileName ?? '未知'}`);
  return getBundle(id);
}

/* ==================================================================
   四、配置（自动备份策略）
   ================================================================== */

const DEFAULT_AUTO_BACKUP = { enabled: false, intervalHours: 24, keep: 10, lastRunAt: null, lastSignature: null };

function getSettings(key, fallback) {
  const row = dbx.get('SELECT value FROM dataSettings WHERE key = ?', [key]);
  return row ? safeJson(row.value, fallback) : fallback;
}

function setSettings(key, value, actor) {
  dbx.run(
    `INSERT INTO dataSettings (key, value, updatedAt, updatedBy) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`,
    [key, JSON.stringify(value), nowStr(), actor ?? null],
  );
}

function getAutoBackup() {
  const cfg = getSettings('autoBackup', null);
  return { ...DEFAULT_AUTO_BACKUP, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
}

function setAutoBackup(patch, actor) {
  const cur = getAutoBackup();
  const enabled = patch.enabled === undefined ? cur.enabled : !!patch.enabled;
  const intervalHours = INTERVAL_OPTIONS.includes(Number(patch.intervalHours))
    ? Number(patch.intervalHours)
    : (INTERVAL_OPTIONS.includes(Number(cur.intervalHours)) ? Number(cur.intervalHours) : 24);
  const keepRaw = Number(patch.keep ?? cur.keep);
  const keep = Math.min(KEEP_MAX, Math.max(KEEP_MIN, Number.isFinite(keepRaw) ? Math.round(keepRaw) : 10));
  const next = { ...cur, enabled, intervalHours, keep };
  setSettings('autoBackup', next, actor);
  logOp(actor, '配置自动备份', enabled ? `开启 · 每 ${intervalHours} 小时 · 保留 ${keep} 份` : '关闭');
  return next;
}

/**
 * 不参与「内容签名」的表：审计流水（accessLogs）与登录尝试（loginAttempts）每次请求都在增长，
 * 若计入签名，自动备份的「内容未变化则跳过」永远不生效。
 * 注意：这两张表仍在 EXPORT_TABLES 内、照常进备份包（保证快照完整），只是不作为去重依据。
 */
const SIGNATURE_EXCLUDE = ['accessLogs', 'loginAttempts'];

/** 全库内容签名（自动备份去重依据）：按表逐行序列化后取 sha256 */
function contentSignature() {
  const parts = [];
  for (const table of EXPORT_TABLES) {
    if (SIGNATURE_EXCLUDE.includes(table)) continue;
    const rows = dbx.all(`SELECT * FROM ${assertTable(table)}`);
    parts.push(`${table}:${rows.length}:${sha256(JSON.stringify(rows))}`);
  }
  return sha256(parts.join('|'));
}

/** 保留策略：仅清理「自动备份」类型，最多保留 keep 份（手动包与快照不动） */
function pruneAutoBackups(keep) {
  const rows = dbx.all(
    "SELECT id, fileName FROM dataBundles WHERE kind = '自动备份' ORDER BY id DESC",
  );
  const stale = rows.slice(Math.max(0, keep));
  for (const row of stale) {
    const filePath = path.join(BACKUP_DIR, row.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    dbx.run('DELETE FROM dataBundles WHERE id = ?', [row.id]);
  }
  return stale.length;
}

/** 执行一次自动备份：内容签名未变则跳过写包，仅刷新 lastRunAt */
function runAutoBackup(actor = 'system') {
  const cfg = getAutoBackup();
  const signature = contentSignature();
  if (cfg.lastSignature === signature) {
    setSettings('autoBackup', { ...cfg, lastRunAt: nowStr(), lastSignature: signature }, actor);
    return { skipped: true, reason: '内容未变化', lastRunAt: nowStr() };
  }
  const bundle = buildBundle({ kind: '自动备份', label: `自动备份-${stamp()}`, actor });
  const file = writeBundleFile(bundle);
  const info = registerBundle({ kind: '自动备份', label: bundle.label, actor, file, counts: bundle.counts });
  const pruned = pruneAutoBackups(cfg.keep);
  setSettings('autoBackup', { ...cfg, lastRunAt: nowStr(), lastSignature: signature }, actor);
  logOp(actor, '自动备份', `#${Number(info.lastInsertRowid)} 已完成，清理过期 ${pruned} 份`);
  return { skipped: false, bundleId: Number(info.lastInsertRowid), pruned };
}

/** 链式调度（unref 不阻塞进程退出）；模块加载后由 index.js 调用 scheduleAuto() */
let autoTimer = null;
function scheduleAuto() {
  const cfg = getAutoBackup();
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (!cfg.enabled) return;
  const delay = Math.max(1, Number(cfg.intervalHours) || 24) * 3600 * 1000;
  autoTimer = setTimeout(() => {
    try {
      runAutoBackup('system');
    } catch (e) {
      console.error('[datamgmt] 自动备份失败:', e.message);
    }
    scheduleAuto();
  }, delay);
  if (typeof autoTimer.unref === 'function') autoTimer.unref();
  return delay;
}

/* ==================================================================
   五、总览与操作日志
   ================================================================== */

function dbFileSize() {
  try {
    return fs.statSync(DB_PATH).size;
  } catch {
    return 0;
  }
}

function formatMtime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dirStats(dir) {
  try {
    if (!fs.existsSync(dir)) return { files: 0, bytes: 0, updatedAt: null };
    let files = 0;
    let bytes = 0;
    let latest = 0;
    for (const name of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) {
        files += 1;
        bytes += st.size;
        latest = Math.max(latest, st.mtimeMs);
      }
    }
    return { files, bytes, updatedAt: latest ? formatMtime(latest) : null };
  } catch {
    return { files: 0, bytes: 0, updatedAt: null };
  }
}

let dbstatAvailable = null;
/** 单表体积：优先 dbstat（页级统计），不可用时回落到 JSON 序列化体积 */
function tableBytes(table) {
  if (dbstatAvailable !== false) {
    try {
      const row = dbx.get('SELECT COALESCE(SUM(pgsize), 0) AS b FROM dbstat WHERE name = ?', [table]);
      dbstatAvailable = true;
      return Number(row?.b) || 0;
    } catch {
      dbstatAvailable = false;
    }
  }
  return Buffer.byteLength(JSON.stringify(dbx.all(`SELECT * FROM ${assertTable(table)}`)), 'utf8');
}

/** 单表最近更新时间：取表内日期列（updatedAt 优先）的最大值 */
function tableUpdatedAt(table, columns) {
  const timeCols = TIME_COLUMNS.filter((c) => columns.includes(c));
  if (timeCols.length === 0) return null;
  const expr = `${timeCols.map((c) => `NULLIF(${c}, '')`).join(', ')}, NULL`;
  const row = dbx.get(`SELECT MAX(COALESCE(${expr})) AS t FROM ${assertTable(table)}`);
  return row?.t ?? null;
}

/** 数据总览卡片：中文名 + 条数 + 体积 + 更新时间 */
function tableStats() {
  return EXPORT_TABLES.map((table) => {
    const columns = columnsOf(table);
    const count = dbx.get(`SELECT COUNT(*) AS c FROM ${assertTable(table)}`).c;
    return {
      table,
      name: TABLE_LABELS[table] ?? '未知数据表',
      count,
      bytes: count === 0 ? 0 : tableBytes(table),
      updatedAt: tableUpdatedAt(table, columns),
    };
  });
}

function overview() {
  const stats = tableStats();
  const counts = {};
  for (const item of stats) counts[item.table] = item.count;
  const rows = dbx.all('SELECT kind, COUNT(*) AS n, COALESCE(SUM(sizeBytes), 0) AS bytes FROM dataBundles GROUP BY kind');
  const bundles = { total: 0, bytes: 0, byKind: rows };
  for (const r of rows) { bundles.total += r.n; bundles.bytes += r.bytes; }
  const latest = dbx.get('SELECT id, label, kind, createdAt FROM dataBundles ORDER BY id DESC LIMIT 1') ?? null;
  const settings = dbx.get('SELECT COUNT(*) AS c, MAX(updatedAt) AS t FROM dataSettings');
  return {
    generatedAt: nowStr(),
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    tables: EXPORT_TABLES,
    counts,
    tableStats: stats,
    settings: { count: settings?.c ?? 0, updatedAt: settings?.t ?? null },
    db: { file: path.basename(DB_PATH), sizeBytes: dbFileSize(), walBytes: (() => { try { return fs.statSync(`${DB_PATH}-wal`).size; } catch { return 0; } })() },
    uploads: dirStats(path.join(DATA_DIR, 'uploads')),
    bundles,
    latestBundle: latest,
    autoBackup: getAutoBackup(),
    oplog: listOplog(8),
  };
}

function logOp(actor, action, summary) {
  try {
    dbx.run('INSERT INTO dataOplog (ts, actor, action, summary) VALUES (?, ?, ?, ?)', [nowStr(), actor ?? null, action, summary ?? null]);
    // 环形保留：只保留最近 OPLOG_KEEP 条
    const total = dbx.get('SELECT COUNT(*) AS c FROM dataOplog').c;
    if (total > OPLOG_KEEP) {
      dbx.run('DELETE FROM dataOplog WHERE id IN (SELECT id FROM dataOplog ORDER BY id ASC LIMIT ?)', [total - OPLOG_KEEP]);
    }
  } catch (e) {
    console.error('[datamgmt] 写入操作日志失败:', e.message);
  }
}

function listOplog(limit = 50) {
  const n = Math.min(500, Math.max(1, parseInt(limit) || 50));
  return dbx.all('SELECT * FROM dataOplog ORDER BY id DESC LIMIT ?', [n]);
}

module.exports = {
  SCHEMA_VERSION,
  APP_VERSION,
  SOURCE,
  BUNDLE_KINDS,
  MIGRATION_KIND,
  TABLE_LABELS,
  INTERVAL_OPTIONS,
  KEEP_MIN,
  KEEP_MAX,
  RESTORE_PHRASE,
  MAX_UPLOAD_BYTES,
  EXPORT_TABLES,
  MANAGED_TABLES,
  nowStr,
  sha256,
  buildBundle,
  buildMigrationZip,
  parseBundleBuffer,
  writeBundleFile,
  verifyBundle,
  diffCounts,
  previewRestore,
  applyBundle,
  restore,
  createBackup,
  getBundle,
  bundleRow,
  listBundles,
  bundleFilePath,
  readBundleById,
  updateBundle,
  deleteBundle,
  saveUploadedBundle,
  getAutoBackup,
  setAutoBackup,
  runAutoBackup,
  scheduleAuto,
  pruneAutoBackups,
  contentSignature,
  overview,
  logOp,
  listOplog,
};

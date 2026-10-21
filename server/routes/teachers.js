/**
 * 班级管理 → 教师名单：辅导员与班主任的唯一权威来源。
 *
 * 通道边界（与方案文档 §5.2 一致）：
 * - 本通道以「人」为主视角，带班写入为**增量加入**：不会清空某人未被提及的其他班级；
 *   清空场景走「在职状态=离职」或单条维护接口。
 * - 班级导入（/classes/import）以「班级」为主视角，仍是**覆盖**语义，两者不互相擦除。
 *
 * 导入流程：上传（CSV，脚本/服务端直传）或前端解析 Excel →
 *          POST /import/preview（仅校验，返回 batchId 与逐行明细）→
 *          POST /import/confirm（重校验 + 事务写入 + 幂等）。
 * 幂等：以工号（users.username）为唯一键做 upsert；同时以 clientRequestId 保证同一批次
 *      重复确认只生效一次（第二次直接回放首次结果）。
 */
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission, roleKeysOfUserId } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');
const { ROLE_TYPES, ROLE_TYPE_COUNSELOR } = require('../lib/teacherSourceMigrate');
const {
  ROLE_LABEL,
  ROLE_BY_LABEL,
  allClassIds,
  listTeachers,
  refillStudentsByClass,
} = require('../lib/teacherSync');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('classes'));

/* ---------- 常量：与前端 utils/teacherImport.ts 严格保持一致 ---------- */

/** 工号规则：3-20 位字母/数字/下划线（工号即登录账号） */
const EMPLOYEE_NO_RE = /^[a-zA-Z0-9_]{3,20}$/;
/** 批量导入初始密码：与用户管理同规则「Hzpt@」+ 工号 */
const IMPORT_PASSWORD_PREFIX = 'Hzpt@';
/** 单次导入行数上限（超限直接拒绝，避免长事务） */
const MAX_ROWS = 2000;
/** 上传文件体积上限 5MB */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 预览批次有效期 30 分钟 */
const BATCH_TTL_MS = 30 * 60 * 1000;

const TEMPLATE_HEADERS = ['工号', '姓名', '手机号', '人员类型', '所辖班级', '在职状态'];
const REQUIRED_HEADERS = ['工号', '姓名', '人员类型', '所辖班级'];

/** 模板列 → 内部字段 */
const FIELD_OF_HEADER = {
  工号: 'employeeNo',
  姓名: 'name',
  手机号: 'mobile',
  人员类型: 'roleTypes',
  所辖班级: 'classNames',
  在职状态: 'status',
};

/* ---------- 错误码与 traceId ---------- */

/** 取请求 traceId：透传前端 X-Trace-Id，缺省生成 */
function traceOf(req) {
  if (req.traceId) return req.traceId;
  const incoming = String(req.headers['x-trace-id'] ?? '').trim();
  req.traceId = incoming || `tr-${crypto.randomUUID()}`;
  return req.traceId;
}

/**
 * 统一错误响应：HTTP 状态 + 稳定错误码 + traceId（便于前端定位与日志检索）。
 * 错误码清单：
 *   400 VALIDATION_ROWS / ROWS_TOO_LARGE / FILE_TOO_LARGE / FILE_TYPE_INVALID / EMPTY_ROWS
 *       BATCH_NOT_FOUND / BATCH_EXPIRED / BATCH_ROWS_TOO_LARGE
 *   403 MODULE_FORBIDDEN（由 requirePermission 统一返回）
 *   409 ALL_OR_NOTHING_ABORTED（存在失败行且要求整批回滚）
 *   500 IMPORT_ROLLBACKED（写入异常已回滚）
 */
function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ code, message, ...extra });
}

/* ---------- 解析与校验（纯逻辑，供预览与确认共用） ---------- */

/** 手机号清洗：去空格/连字符等分隔符后按 1 开头 11 位判定 */
function normalizeMobile(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, value: '' };
  const digits = text.replace(/[\s\-()（）]/g, '');
  if (!/^1[3-9]\d{9}$/.test(digits)) return { ok: false, raw: text };
  return { ok: true, value: digits };
}

/** 人员类型：「辅导员、班主任」→ ['counselor','headTeacher'] */
function parseRoleTypes(raw) {
  const tokens = String(raw ?? '').split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean);
  const roleTypes = [];
  const unknown = [];
  for (const t of tokens) {
    const key = ROLE_BY_LABEL[t];
    if (!key) unknown.push(t);
    else if (!roleTypes.includes(key)) roleTypes.push(key);
  }
  return { roleTypes, unknown };
}

/** 班级文本解析：支持「年级·班级」消歧；返回 { ids, missing, ambiguous } */
function resolveClassNames(raw) {
  const tokens = String(raw ?? '').split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean);
  const ids = [];
  const missing = [];
  const ambiguous = [];
  for (const token of tokens) {
    const parts = token.split(/[·・]/).map((s) => s.trim()).filter(Boolean);
    const rows = parts.length === 2
      ? dbx.all(
        'SELECT c.id FROM classes c JOIN grades g ON g.id = c.gradeId WHERE g.name = ? AND c.name = ?',
        [parts[0], parts[1]],
      )
      : dbx.all('SELECT c.id FROM classes c WHERE c.name = ?', [token]);
    if (rows.length === 0) missing.push(token);
    else if (rows.length > 1) ambiguous.push(token);
    else if (!ids.includes(rows[0].id)) ids.push(rows[0].id);
  }
  return { ids, missing, ambiguous };
}

/**
 * 逐行校验（返回失败明细，精确到行号 + 字段）。
 * @returns {{ plans: Array, failures: Array, warnings: Array }}
 */
function validateRows(rows, req) {
  const seen = new Map(); // 工号 → 首次出现行号
  const nameSeen = new Map(); // 姓名 → 首次出现工号（同名不同工号 → 警告）
  const plans = [];
  const failures = [];
  const warnings = [];

  const pushFailure = (row, field, employeeNo, name, reason, data) =>
    failures.push({ row, field, employeeNo: employeeNo || '—', name: name || '—', reason, data });

  for (const raw of rows) {
    const row = Number(raw?.row) || 0;
    const data = raw?.data ?? {};
    const employeeNo = String(data.employeeNo ?? '').trim();
    const name = String(data.name ?? '').trim();
    const roleRaw = String(data.roleTypes ?? '').trim();
    const classRaw = String(data.classNames ?? '').trim();
    const statusRaw = String(data.status ?? '').trim();
    const reasons = [];

    /* ① 工号：必填 + 格式 + 本批内唯一 */
    if (!employeeNo) reasons.push({ field: '工号', message: '工号为必填项' });
    else if (!EMPLOYEE_NO_RE.test(employeeNo)) {
      reasons.push({ field: '工号', message: '工号需为 3-20 位字母/数字/下划线' });
    } else if (seen.has(employeeNo)) {
      reasons.push({ field: '工号', message: `工号与本批第 ${seen.get(employeeNo)} 行重复` });
    }
    if (employeeNo) seen.set(employeeNo, row);

    /* ② 姓名：必填 + 长度 */
    if (!name) reasons.push({ field: '姓名', message: '姓名为必填项' });
    else if (name.length > 20) reasons.push({ field: '姓名', message: '姓名不可超过 20 个字' });

    /* ③ 手机号：选填，填了必须合规 */
    const mobile = normalizeMobile(data.mobile);
    if (!mobile.ok) {
      reasons.push({ field: '手机号', message: `手机号格式有误（${mobile.raw}），应为 11 位手机号` });
    }

    /* ④ 人员类型：必填且只能取「辅导员/班主任」 */
    const { roleTypes, unknown } = parseRoleTypes(roleRaw);
    if (!roleRaw) reasons.push({ field: '人员类型', message: '人员类型为必填项' });
    else if (roleTypes.length === 0) {
      reasons.push({ field: '人员类型', message: `人员类型只能填：辅导员、班主任（当前值「${roleRaw}」）` });
    } else if (unknown.length > 0) {
      reasons.push({ field: '人员类型', message: `无法识别的人员类型：${unknown.join('、')}` });
    }

    /* ⑤ 所辖班级：必填且逐个命中班级字典 */
    const classes = resolveClassNames(classRaw);
    if (!classRaw) reasons.push({ field: '所辖班级', message: '所辖班级为必填项' });
    else {
      if (classes.missing.length > 0) {
        reasons.push({ field: '所辖班级', message: `班级未匹配到班级字典：${classes.missing.join('、')}` });
      }
      if (classes.ambiguous.length > 0) {
        reasons.push({
          field: '所辖班级',
          message: `班级名在多个年级重复，请写成「年级·班级」：${classes.ambiguous.join('、')}`,
        });
      }
    }

    /* ⑥ 在职状态：选填，仅 在职/离职 */
    let status = 'active';
    if (statusRaw && !['在职', '离职'].includes(statusRaw)) {
      reasons.push({ field: '在职状态', message: '在职状态只能填：在职 或 离职' });
    } else if (statusRaw === '离职') {
      status = 'leave';
    }

    /* ⑦ 库内校验：管理员保护 + 自我保护（前置校验均通过时才有意义） */
    if (employeeNo && reasons.length === 0) {
      const existing = dbx.get('SELECT * FROM users WHERE username = ?', [employeeNo]);
      if (existing) {
        const roleKeys = roleKeysOfUserId(existing.id);
        if (existing.role === 'admin' || roleKeys.includes('admin')) {
          reasons.push({ field: '工号', message: '该工号是管理员账号，请到「用户管理」维护' });
        } else if (existing.id === req.user?.id) {
          reasons.push({ field: '工号', message: '不能通过本通道修改当前登录账号' });
        }
      }
    }

    if (reasons.length > 0) {
      pushFailure(row, reasons[0].field, employeeNo, name, reasons.map((r) => r.message).join('；'), data);
      continue;
    }

    /* ⑧ 同名不同工号 → 警告（不阻断，提示人工确认是否同一人） */
    if (name) {
      const prior = nameSeen.get(name);
      if (prior && prior !== employeeNo) {
        warnings.push({
          row,
          employeeNo,
          name,
          message: `与工号 ${prior} 的教师同名，请确认是否为同一人`,
        });
      }
      nameSeen.set(name, employeeNo);
    }

    plans.push({
      row,
      employeeNo,
      name,
      mobile: mobile.value,
      roleTypes,
      classIds: classes.ids,
      status,
    });
  }

  return { plans, failures, warnings };
}

/* ---------- 写入（事务内） ---------- */

/**
 * 执行写入：upsert 账号、同步角色、增量绑定班级、离职回收，并回填学生名册。
 * 必须在调用侧开启的事务内执行。
 */
function applyPlans(plans, req) {
  const summary = {
    createdUsers: 0,
    updatedUsers: 0,
    skippedCount: 0,
    disabledUsers: 0,
    grantedRoles: 0,
    revokedRoles: 0,
    linkedClasses: 0,
    unlinkedClasses: 0,
    refilledClasses: 0,
    refilledStudents: 0,
  };
  const affectedClassIds = new Set();

  for (const p of plans) {
    let user = dbx.get('SELECT * FROM users WHERE username = ?', [p.employeeNo]);
    const now = nowStr();
    let changed = false;

    if (!user) {
      const info = dbx.run(
        `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, mobile, teacherSource, createdAt)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'import', ?)`,
        [
          p.employeeNo,
          p.name,
          p.roleTypes[0],
          auth.hashPassword(`${IMPORT_PASSWORD_PREFIX}${p.employeeNo}`),
          p.status === 'leave' ? 1 : 0,
          p.mobile || null,
          now,
        ],
      );
      const uid = Number(info.lastInsertRowid);
      summary.createdUsers += 1;
      // 离职人员：只建档，不授予角色、不带班（与既有账号的离职处理口径一致）
      if (p.status === 'leave') {
        summary.disabledUsers += 1;
        continue;
      }
      for (const roleKey of p.roleTypes) {
        dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [uid, roleKey]);
        summary.grantedRoles += 1;
      }
      for (const classId of p.classIds) {
        for (const roleType of p.roleTypes) {
          dbx.run(
            'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
            [classId, uid, roleType, now],
          );
          summary.linkedClasses += 1;
        }
        affectedClassIds.add(classId);
      }
      continue;
    }

    /* 已存在：绑定已有账号 → 逐字段 diff，仅更新有变化部分 */
    const uid = user.id;
    const sets = [];
    const params = [];
    if (String(user.displayName ?? '').trim() !== p.name) {
      sets.push('displayName = ?');
      params.push(p.name);
      changed = true;
    }
    if (String(user.mobile ?? '') !== String(p.mobile ?? '')) {
      sets.push('mobile = ?');
      params.push(p.mobile || null);
      changed = true;
    }
    const targetDisabled = p.status === 'leave' ? 1 : 0;
    if (Number(user.disabled ?? 0) !== targetDisabled) {
      sets.push('disabled = ?');
      params.push(targetDisabled);
      changed = true;
    }
    if (user.teacherSource !== 'import') {
      sets.push('teacherSource = ?');
      params.push('import');
      changed = true;
    }
    if (sets.length > 0) {
      dbx.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, uid]);
    }

    if (p.status === 'leave') {
      /* 离职：停用账号 + 回收全部带班 + 回收教师角色（账号与审计线索保留） */
      const classes = dbx.all('SELECT classId FROM classCounselors WHERE userId = ?', [uid]);
      const info = dbx.run('DELETE FROM classCounselors WHERE userId = ?', [uid]);
      summary.unlinkedClasses += Number(info.changes ?? 0);
      classes.forEach((c) => affectedClassIds.add(c.classId));
      const removedRoles = dbx.run(
        `DELETE FROM userRoles WHERE userId = ? AND roleKey IN (${ROLE_TYPES.map(() => '?').join(', ')})`,
        [uid, ...ROLE_TYPES],
      );
      summary.revokedRoles += Number(removedRoles.changes ?? 0);
      summary.disabledUsers += 1;
      changed = true;
    } else {
      /* 在职：角色并集增量；带班增量加入（不清空未提及班级） */
      for (const roleKey of p.roleTypes) {
        const info = dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [uid, roleKey]);
        if (Number(info.changes ?? 0) > 0) {
          summary.grantedRoles += 1;
          changed = true;
        }
      }
      for (const classId of p.classIds) {
        for (const roleType of p.roleTypes) {
          const info = dbx.run(
            'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
            [classId, uid, roleType, now],
          );
          if (Number(info.changes ?? 0) > 0) {
            summary.linkedClasses += 1;
            changed = true;
          }
        }
        affectedClassIds.add(classId);
      }
    }

    if (changed) summary.updatedUsers += 1;
    else summary.skippedCount += 1;
  }

  /* 教师变动 → 学生责任人文本回填（同事务，保证一致状态） */
  const refill = refillStudentsByClass([...affectedClassIds]);
  summary.refilledClasses = refill.classCount;
  summary.refilledStudents = refill.changedCount;

  return summary;
}

/** 组装统一的导入响应体 */
function buildResult({ batchId, traceId, total, failures, warnings, summary, idempotentReplay = false }) {
  const insertedCount = summary?.createdUsers ?? 0;
  const updatedCount = summary?.updatedUsers ?? 0;
  return {
    batchId,
    traceId,
    idempotentReplay,
    total,
    insertedCount,
    updatedCount,
    skippedCount: summary?.skippedCount ?? 0,
    disabledCount: summary?.disabledUsers ?? 0,
    successCount: insertedCount + updatedCount,
    failures,
    warnings,
    syncSummary: summary ?? null,
  };
}

/* ---------- 批量存储 ---------- */

function storeBatch({ id, clientRequestId, operator, traceId, status, rows, result }) {
  const now = nowStr();
  dbx.run(
    `INSERT INTO teacherImportBatches (id, clientRequestId, operator, traceId, status, rowCount, payload, result, createdAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       clientRequestId = COALESCE(excluded.clientRequestId, teacherImportBatches.clientRequestId),
       operator = excluded.operator,
       traceId = excluded.traceId,
       status = excluded.status,
       result = excluded.result,
       completedAt = excluded.completedAt`,
    [
      id,
      clientRequestId ?? null,
      operator ?? null,
      traceId ?? null,
      status,
      (rows ?? []).length,
      JSON.stringify(rows ?? []),
      result ? JSON.stringify(result) : null,
      now,
      result ? now : null,
    ],
  );
}

function loadBatch(id) {
  const row = dbx.get('SELECT * FROM teacherImportBatches WHERE id = ?', [id]);
  if (!row) return null;
  return { ...row, rows: JSON.parse(row.payload ?? '[]') };
}

/* ---------- 接口 ---------- */

/** 教师名单列表：?roleType=&status=&keyword=&classId= */
router.get('/', (req, res) => {
  res.json(listTeachers({
    roleType: req.query.roleType,
    status: req.query.status,
    keyword: req.query.keyword,
    classId: req.query.classId,
  }));
});

/** 导出：与导入模板同列，形成「导出 → 修改 → 回导」闭环 */
router.get('/export', (req, res) => {
  const list = listTeachers({
    roleType: req.query.roleType,
    status: req.query.status,
    keyword: req.query.keyword,
    classId: req.query.classId,
  });
  res.json(list.map((t) => ({
    工号: t.employeeNo,
    姓名: t.name,
    手机号: t.mobile ?? '',
    人员类型: t.roleLabels.join('、'),
    所辖班级: t.classNames.join('、'),
    在职状态: t.disabled ? '离职' : '在职',
  })));
});

/**
 * 上传并预览：CSV 文本（≤5MB），服务端解析 + 校验，返回 batchId 与逐行明细。
 * 供脚本直传使用；前端 Excel 解析后走 /import/preview。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

router.post('/import/upload', upload.single('file'), (req, res) => {
  const traceId = traceOf(req);
  try {
    if (!req.file) return fail(res, 400, 'FILE_REQUIRED', '请选择要上传的 CSV 文件', { traceId });
    if (req.file.size > MAX_FILE_BYTES) {
      return fail(res, 400, 'FILE_TOO_LARGE', `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限`, { traceId });
    }
    const rows = parseCsvRows(req.file.buffer.toString('utf8'));
    if (rows.length === 0) return fail(res, 400, 'EMPTY_ROWS', '未解析到数据行，请检查文件内容', { traceId });
    if (rows.length > MAX_ROWS) {
      return fail(res, 400, 'ROWS_TOO_LARGE', `单次最多导入 ${MAX_ROWS} 行，请分批操作`, { traceId });
    }
    return runPreview({ req, res, rows, traceId });
  } catch (e) {
    return fail(res, 400, e.code ?? 'FILE_PARSE_ERROR', e.message ?? '文件解析失败', { traceId });
  }
});

/** 预览（dryRun）：只校验不写入，返回 batchId 供确认接口使用 */
router.post('/import/preview', (req, res) => {
  const traceId = traceOf(req);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return fail(res, 400, 'EMPTY_ROWS', '没有可导入的数据行', { traceId });
  if (rows.length > MAX_ROWS) {
    return fail(res, 400, 'ROWS_TOO_LARGE', `单次最多导入 ${MAX_ROWS} 行，请分批操作`, { traceId });
  }
  return runPreview({ req, res, rows, traceId });
});

function runPreview({ req, res, rows, traceId }) {
  const { plans, failures, warnings } = validateRows(rows, req);
  const batchId = `tb-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  storeBatch({
    id: batchId,
    clientRequestId: null,
    operator: req.user?.username ?? null,
    traceId,
    status: 'previewed',
    rows,
    result: null,
  });
  console.error(
    `[teachers] preview batchId=${batchId} traceId=${traceId} operator=${req.user?.username} ` +
    `rows=${rows.length} valid=${plans.length} failed=${failures.length}`,
  );
  return res.json({
    ...buildResult({ batchId, traceId, total: rows.length, failures, warnings, summary: null }),
    validCount: plans.length,
  });
}

/**
 * 确认导入：按 batchId（或直传 rows）重校验并事务写入；
 * clientRequestId 相同且已完成过 → 回放首次结果，绝不重复写入（幂等）。
 * @param mode 'partial'（默认，失败行跳过） | 'all-or-nothing'（存在失败行则整批放弃）
 */
function handleConfirm(req, res) {
  const traceId = traceOf(req);
  const clientRequestId = String(req.body?.clientRequestId ?? '').trim();
  const mode = req.body?.mode === 'all-or-nothing' ? 'all-or-nothing' : 'partial';

  /* 幂等：同一 clientRequestId 已完成过 → 直接回放，绝不重复写入 */
  if (clientRequestId) {
    const prev = dbx.get('SELECT * FROM teacherImportBatches WHERE clientRequestId = ?', [clientRequestId]);
    if (prev && prev.status === 'done') {
      const result = JSON.parse(prev.result ?? '{}');
      return res.json({ ...result, idempotentReplay: true, batchId: prev.id, traceId });
    }
  }

  let rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  let batchId = String(req.body?.batchId ?? '').trim();

  if (!rows) {
    const batch = loadBatch(batchId);
    if (!batch) return fail(res, 400, 'BATCH_NOT_FOUND', '批次不存在或已过期，请重新预览', { traceId });
    if (batch.status === 'done') {
      return res.json({ ...JSON.parse(batch.result ?? '{}'), idempotentReplay: true, batchId: batch.id, traceId });
    }
    if (Date.now() - new Date(batch.createdAt.replace(' ', 'T')).getTime() > BATCH_TTL_MS) {
      return fail(res, 400, 'BATCH_EXPIRED', '预览批次已超过 30 分钟，请重新上传', { traceId });
    }
    rows = batch.rows;
    batchId = batch.id;
  } else if (rows.length > MAX_ROWS) {
    return fail(res, 400, 'ROWS_TOO_LARGE', `单次最多导入 ${MAX_ROWS} 行，请分批操作`, { traceId });
  } else {
    batchId = batchId || `tb-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  const { plans, failures, warnings } = validateRows(rows, req);

  /* 整批回滚策略：存在任何失败行则不写入任何数据（由调用方通过 mode 选择） */
  if (mode === 'all-or-nothing' && failures.length > 0) {
    return fail(res, 409, 'ALL_OR_NOTHING_ABORTED', '存在校验失败行，已整批放弃，未产生任何数据变更', {
      traceId,
      batchId,
      total: rows.length,
      failures,
      warnings,
    });
  }

  try {
    let summary;
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      summary = applyPlans(plans, req);
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error(`[teachers] batchId=${batchId} traceId=${traceId} 事务回滚：${e.message}`);
      return fail(res, 500, 'IMPORT_ROLLBACKED', '导入失败，已全部回滚，未产生任何数据变更', { traceId, batchId });
    }

    const result = buildResult({
      batchId, traceId, total: rows.length, failures, warnings, summary,
    });
    storeBatch({
      id: batchId,
      clientRequestId: clientRequestId || null,
      operator: req.user?.username ?? null,
      traceId,
      status: 'done',
      rows,
      result,
    });
    logAccess(
      req,
      `导入教师名单：新增 ${summary.createdUsers}、更新 ${summary.updatedUsers}、跳过 ${summary.skippedCount}、` +
      `离职 ${summary.disabledUsers}，失败 ${failures.length} 条（batchId=${batchId} traceId=${traceId}）`,
    );
    console.error(
      `[teachers] confirm batchId=${batchId} traceId=${traceId} operator=${req.user?.username} ` +
      `created=${summary.createdUsers} updated=${summary.updatedUsers} skipped=${summary.skippedCount} ` +
      `disabled=${summary.disabledUsers} failed=${failures.length} refilledStudents=${summary.refilledStudents}`,
    );
    return res.json(result);
  } catch (e) {
    return fail(res, 500, 'INTERNAL_ERROR', e.message || '服务内部错误', { traceId, batchId });
  }
}

/** 确认导入：body { batchId? , rows? , clientRequestId? , mode? } */
router.post('/import/confirm', handleConfirm);

/** 一步导入（脚本 / 单步调用）：body { rows, clientRequestId?, mode? }，语义与 confirm 完全一致 */
router.post('/import', handleConfirm);

/** 单条维护：姓名 / 手机号 / 在职状态 / 带班集合 */
router.put('/:id', (req, res) => {
  const traceId = traceOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'INVALID_ID', '无效的教师', { traceId });
  const target = dbx.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return fail(res, 404, 'NOT_FOUND', '教师不存在', { traceId });
  if (target.role === 'admin' || roleKeysOfUserId(id).includes('admin')) {
    return fail(res, 400, 'ADMIN_PROTECTED', '管理员账号请到「用户管理」维护', { traceId });
  }

  const body = req.body ?? {};
  const name = body.name !== undefined ? String(body.name).trim() : target.displayName;
  const mobileRaw = body.mobile !== undefined ? normalizeMobile(body.mobile) : { ok: true, value: target.mobile ?? '' };
  if (!mobileRaw.ok) return fail(res, 400, 'VALIDATION_ROWS', `手机号格式有误（${mobileRaw.raw}）`, { traceId });
  if (!name) return fail(res, 400, 'VALIDATION_ROWS', '姓名为必填项', { traceId });

  const status = String(body.status ?? '').trim();
  if (status && !['active', 'leave'].includes(status)) {
    return fail(res, 400, 'VALIDATION_ROWS', '在职状态只能为 active 或 leave', { traceId });
  }
  const rawBindings = Array.isArray(body.bindings) ? body.bindings : null;

  try {
    dbx.db.exec('BEGIN IMMEDIATE');
    let refilled = { classCount: 0, changedCount: 0 };
    try {
      const now = nowStr();
      dbx.run('UPDATE users SET displayName = ?, mobile = ? WHERE id = ?', [name, mobileRaw.value || null, id]);
      if (status === 'leave') {
        dbx.run('UPDATE users SET disabled = 1 WHERE id = ?', [id]);
        dbx.run('DELETE FROM classCounselors WHERE userId = ?', [id]);
        dbx.run(
          `DELETE FROM userRoles WHERE userId = ? AND roleKey IN (${ROLE_TYPES.map(() => '?').join(', ')})`,
          [id, ...ROLE_TYPES],
        );
        refilled = refillStudentsByClass(allClassIds());
      } else if (status === 'active') {
        dbx.run('UPDATE users SET disabled = 0 WHERE id = ?', [id]);
      }
      if (rawBindings) {
        dbx.run('DELETE FROM classCounselors WHERE userId = ?', [id]);
        for (const b of rawBindings) {
          const classId = Number(b?.classId);
          const roleType = ROLE_TYPES.includes(b?.roleType) ? b.roleType : ROLE_TYPE_COUNSELOR;
          if (!Number.isInteger(classId) || classId <= 0) continue;
          dbx.run(
            'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
            [classId, id, roleType, now],
          );
        }
        // 角色至少保留带班所需的身份
        for (const roleType of [...new Set(rawBindings.map((b) => (ROLE_TYPES.includes(b?.roleType) ? b.roleType : ROLE_TYPE_COUNSELOR)))]) {
          dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [id, roleType]);
        }
        refilled = refillStudentsByClass([...new Set(rawBindings.map((b) => Number(b?.classId)).filter((n) => Number.isInteger(n) && n > 0))]);
      }
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      throw e;
    }
    logAccess(req, `维护教师 ${target.username}（${name}）traceId=${traceId}`);
    return res.json({ ok: true, refilled });
  } catch (e) {
    return fail(res, 500, 'UPDATE_ROLLBACKED', e.message || '更新失败，已回滚', { traceId });
  }
});

/** 学生名册回填：按班级重算 counselor / headTeacher（历史数据迁移与人工校验后重跑） */
router.post('/backfill', (req, res) => {
  const traceId = traceOf(req);
  const ids = Array.isArray(req.body?.classIds) && req.body.classIds.length > 0
    ? req.body.classIds
    : allClassIds();
  try {
    const result = refillStudentsByClass(ids);
    logAccess(req, `回填学生责任人：涉及 ${result.classCount} 个班，更新 ${result.changedCount} 名学生（traceId=${traceId}）`);
    return res.json({ ok: true, traceId, ...result });
  } catch (e) {
    return fail(res, 500, 'BACKFILL_FAILED', e.message || '回填失败', { traceId });
  }
});

/* ---------- CSV 解析（上传通道用，支持引号包裹与换行转义） ---------- */
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i += 1; } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    if (ch === '\r') continue;
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
}

/** CSV → 导入行（含表头映射与缺列校验） */
function parseCsvRows(text) {
  const table = parseCsvText(text);
  if (table.length < 2) throw Object.assign(new Error('没有解析到数据行，请检查文件内容'), { code: 'EMPTY_ROWS' });
  const header = table[0].map((h) => String(h ?? '').trim());
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw Object.assign(new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`), { code: 'FILE_PARSE_ERROR' });
  }
  const rows = [];
  for (let i = 1; i < table.length; i += 1) {
    const cells = table[i];
    const data = {};
    header.forEach((h, idx) => {
      const field = FIELD_OF_HEADER[h];
      if (field) data[field] = String(cells[idx] ?? '').trim();
    });
    if (TEMPLATE_HEADERS.every((h) => !String(data[FIELD_OF_HEADER[h]] ?? '').trim())) continue; // 整行空白
    rows.push({ row: i + 1, data });
  }
  return rows;
}

module.exports = router;
module.exports.__csv = { parseCsvText, parseCsvRows };
module.exports.__validate = { validateRows, parseRoleTypes, normalizeMobile, resolveClassNames };
module.exports.TEMPLATE_HEADERS = TEMPLATE_HEADERS;
module.exports.MAX_ROWS = MAX_ROWS;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
module.exports.BATCH_TTL_MS = BATCH_TTL_MS;
module.exports.EMPLOYEE_NO_RE = EMPLOYEE_NO_RE;

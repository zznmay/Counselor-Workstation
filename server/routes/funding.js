/** 资助管理（首版：困难生认定）：按学年维护认定档案、状态变更、统计与导入 */
const express = require('express');
const dayjs = require('dayjs');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { isAdmin, sensitiveScope, canManageStudent } = require('../lib/scope');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('funding'));

const LEVELS = ['特别困难', '困难', '一般困难'];
const STATUSES = ['待复核', '已认定', '已取消'];
const DIFFICULTY_TYPES = [
  '低保家庭', '特困供养', '脱贫家庭', '残疾学生', '孤儿', '突发严重困难', '其他',
];

const currentMonth = () => dayjs().format('YYYY-MM');
const soonMonth = () => dayjs().add(30, 'day').format('YYYY-MM');
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function currentAcademicYear(date = dayjs()) {
  const year = date.year();
  return date.month() + 1 >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function isAcademicYear(value) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(value ?? '').trim());
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

function yearRange(academicYear) {
  const start = Number(String(academicYear).slice(0, 4));
  return { validFrom: `${start}-09`, validTo: `${start + 1}-08` };
}

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

const CN_DIGITS = {
  '〇': '0', '○': '0', '零': '0', '一': '1', '二': '2', '两': '2',
  '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
};

function cnNumber(text) {
  if (!text) return null;
  if (text === '十') return 10;
  if (text.startsWith('十')) {
    const rest = CN_DIGITS[text[1]];
    return rest === undefined ? null : 10 + Number(rest);
  }
  const digits = text.split('').map((c) => CN_DIGITS[c]);
  return digits.every((d) => d !== undefined) ? Number(digits.join('')) : null;
}

/**
 * 宽松解析月份文本 → YYYY-MM。
 * 兼容：2026-10、2026/10、2026.10、2026年10月、2026年十月份、
 * 二〇二六年十月、202610、2026-10-01、10/2026 等写法。
 */
function parseMonthText(value) {
  if (value === null || value === undefined) return '';
  let raw = String(value).trim();
  if (!raw) return '';
  raw = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, '/')
    .replace(/[－—–]/g, '-')
    .replace(/[．]/g, '.')
    .replace(/\s+/g, '');
  raw = raw.replace(/([〇○零一二三四五六七八九]{2,4})年/g, (_, year) => (
    year.split('').map((c) => CN_DIGITS[c]).join('') + '年'
  ));
  raw = raw.replace(/([一二三四五六七八九十]{1,3})月/g, (_, monthText) => {
    const month = cnNumber(monthText);
    return month === null ? `${monthText}月` : `${month}月`;
  });

  const apply = (yearText, monthText) => {
    let year = Number(yearText);
    if (String(yearText).length === 2) year += 2000;
    const month = Number(monthText);
    return year >= 1900 && year <= 2100 && month >= 1 && month <= 12
      ? `${year}-${String(month).padStart(2, '0')}`
      : '';
  };

  // 月在前：10/2026（必须放在年前面之前，避免被 10/20 误匹配）
  let match = raw.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (match) return apply(match[2], match[1]);

  // 年在前：2026-10 / 2026/10 / 2026.10 / 2026年10月 / 2026年10月1日
  match = raw.match(/^(\d{2,4})(?:[-/.]|年)(\d{1,2})(?:月)?/);
  if (match) return apply(match[1], match[2]);

  // 紧凑写法：202610
  match = raw.match(/^(\d{4})(\d{2})$/);
  if (match) return apply(match[1], match[2]);

  // 其它可由 dayjs 识别的格式（如带英文月份、ISO 时间）
  if (/^\d{4}$/.test(raw)) return '';
  const parsed = dayjs(raw);
  return parsed.isValid() ? parsed.format('YYYY-MM') : '';
}

/** 统一成 YYYY-MM；兼容历史 YYYY-MM-DD 数据（截取到月） */
function toMonth(value) {
  return parseMonthText(value);
}

function normalizeMonth(value, fallback) {
  if (value === undefined) return toMonth(fallback) || null;
  const raw = String(value ?? '').trim();
  if (!raw) return toMonth(fallback) || null;
  return toMonth(raw) || null;
}

function parseTypes(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : raw.split(/[，,、]/);
    } catch {
      list = raw.split(/[，,、]/);
    }
  } else if (value === undefined || value === null) {
    return [];
  } else {
    return null;
  }
  const types = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
  return types.every((t) => DIFFICULTY_TYPES.includes(t)) ? types : null;
}

function parseTypesJson(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 校验并归一化一份认定档案；existing 非空时未提交字段沿用原值 */
function readProfile(body, existing = null) {
  const academicYear = existing ? existing.academicYear : String(body.academicYear ?? '').trim();
  if (!isAcademicYear(academicYear)) {
    return { error: '学年格式应为 YYYY-YYYY（如 2026-2027）' };
  }
  const level = String(body.level ?? existing?.level ?? '');
  if (!LEVELS.includes(level)) {
    return { error: `困难等级需为：${LEVELS.join('、')}` };
  }
  const types = parseTypes(body.difficultyTypes !== undefined ? body.difficultyTypes : existing?.difficultyTypes);
  if (types === null) {
    return { error: `困难类型需为：${DIFFICULTY_TYPES.join('、')}` };
  }
  const range = yearRange(academicYear);
  const identifiedAt = normalizeMonth(body.identifiedAt, existing?.identifiedAt ?? currentMonth());
  const validFrom = normalizeMonth(body.validFrom, existing?.validFrom ?? range.validFrom);
  const validTo = normalizeMonth(body.validTo, existing?.validTo ?? range.validTo);
  if (!identifiedAt || !validFrom || !validTo) {
    return { error: '日期格式应为 YYYY-MM' };
  }
  if (validTo < validFrom) {
    return { error: '有效期结束月份不能早于开始月份' };
  }

  return {
    data: {
      academicYear,
      level,
      difficultyTypes: JSON.stringify(types),
      identifiedAt,
      validFrom,
      validTo,
      basis: text(body.basis !== undefined ? body.basis : existing?.basis ?? ''),
      remark: text(body.remark !== undefined ? body.remark : existing?.remark ?? ''),
    },
  };
}

function displayStatusOf(row) {
  const validTo = toMonth(row.validTo);
  if (row.status === '已认定' && validTo && validTo < currentMonth()) return '已过期';
  return row.status;
}

function apiRow(row) {
  if (!row) return row;
  return {
    ...row,
    identifiedAt: toMonth(row.identifiedAt),
    validFrom: toMonth(row.validFrom),
    validTo: toMonth(row.validTo),
    difficultyTypes: parseTypesJson(row.difficultyTypes),
    displayStatus: displayStatusOf(row),
  };
}

function logChange(req, payload) {
  dbx.run(
    `INSERT INTO fundingIdentificationLogs
      (id, identificationId, studentId, action, fromStatus, toStatus, fromLevel, toLevel, reason, operatorId, operatorName, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('fl'),
      payload.identificationId,
      payload.studentId,
      payload.action,
      payload.fromStatus ?? null,
      payload.toStatus ?? null,
      payload.fromLevel ?? null,
      payload.toLevel ?? null,
      payload.reason ?? null,
      req.user?.id ?? null,
      req.user?.displayName ?? req.user?.username ?? null,
      nowStr(),
    ],
  );
}

function resolveStudent(studentId) {
  return dbx.get('SELECT id, name, studentNo, className, grade, status FROM students WHERE id = ?', [studentId]);
}

function activeRecordOf(studentId, academicYear, excludeId = null) {
  return dbx.get(
    `SELECT * FROM fundingIdentifications
     WHERE studentId = ? AND academicYear = ? AND status IN ('待复核','已认定')
       ${excludeId ? 'AND id != ?' : ''}
     LIMIT 1`,
    excludeId ? [studentId, academicYear, excludeId] : [studentId, academicYear],
  );
}

function scopedRecord(id, user) {
  const scope = sensitiveScope(user, 'x');
  return dbx.get(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className, s.grade, s.gender,
            s.status AS studentStatus, s.origin, s.phone
     FROM fundingIdentifications x JOIN students s ON s.id = x.studentId
     WHERE x.id = ? ${scope.where}`,
    [id, ...scope.params],
  );
}

function parseClassIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);
}

/** 组装列表/统计共用筛选条件（默认当前学年） */
function buildFilters(req) {
  const {
    keyword = '', academicYear, level, status, difficultyType, classIds, grade, expiry,
  } = req.query;
  const conds = ['1 = 1'];
  const params = [];

  const year = String(academicYear ?? '').trim() || currentAcademicYear();
  conds.push('x.academicYear = ?');
  params.push(year);

  if (LEVELS.includes(level)) { conds.push('x.level = ?'); params.push(level); }
  if (STATUSES.includes(status)) { conds.push('x.status = ?'); params.push(status); }
  if (status === '已过期') {
    conds.push("x.status = '已认定' AND x.validTo IS NOT NULL AND substr(x.validTo, 1, 7) < ?");
    params.push(currentMonth());
  }
  if (difficultyType && DIFFICULTY_TYPES.includes(difficultyType)) {
    conds.push('x.difficultyTypes LIKE ?');
    params.push(`%"${difficultyType}"%`);
  }
  const gradeValue = String(grade ?? '').trim();
  if (gradeValue) { conds.push('s.grade = ?'); params.push(gradeValue); }
  const ids = parseClassIds(classIds);
  if (ids.length > 0) {
    conds.push(`s.classId IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (expiry === 'soon') {
    conds.push("x.status = '已认定' AND substr(x.validTo, 1, 7) >= ? AND substr(x.validTo, 1, 7) <= ?");
    params.push(currentMonth(), soonMonth());
  } else if (expiry === 'expired') {
    conds.push("x.status = '已认定' AND x.validTo IS NOT NULL AND substr(x.validTo, 1, 7) < ?");
    params.push(currentMonth());
  } else if (expiry === 'valid') {
    conds.push("x.status = '已认定' AND (x.validTo IS NULL OR substr(x.validTo, 1, 7) >= ?)");
    params.push(currentMonth());
  }
  if (String(keyword).trim()) {
    const kw = `%${String(keyword).trim()}%`;
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ? OR s.className LIKE ? OR x.basis LIKE ? OR x.remark LIKE ?)');
    params.push(kw, kw, kw, kw, kw);
  }
  return { conds, params, year };
}

/* ==================== 列表 / 详情 ==================== */

router.get('/identifications', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const { conds, params } = buildFilters(req);
  const scope = sensitiveScope(req.user, 'x');
  const where = `${conds.join(' AND ')} ${scope.where}`;
  const join = 'FROM fundingIdentifications x JOIN students s ON s.id = x.studentId';

  const total = dbx.get(`SELECT COUNT(*) AS c ${join} WHERE ${where}`, [...params, ...scope.params]).c;
  const rows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className, s.grade, s.gender,
            s.status AS studentStatus, s.origin
     ${join} WHERE ${where}
     ORDER BY x.academicYear DESC, x.updatedAt DESC, x.rowid ASC
     LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows.map(apiRow), total, page, pageSize });
});

router.get('/identifications/:id', (req, res) => {
  const record = scopedRecord(req.params.id, req.user);
  if (!record) return res.status(404).json({ message: '认定记录不存在或无权查看' });
  const logs = dbx.all(
    'SELECT * FROM fundingIdentificationLogs WHERE identificationId = ? ORDER BY createdAt DESC, rowid DESC',
    [req.params.id],
  );
  const warnings = dbx.all(
    `SELECT id, type, level, reason, raisedAt, status FROM warnings
     WHERE studentId = ? AND type = '经济困难预警' ORDER BY raisedAt DESC LIMIT 5`,
    [record.studentId],
  );
  const conversations = dbx.all(
    `SELECT id, talkTime, way, type, content FROM conversations
     WHERE studentId = ? AND type = '资助帮扶' ORDER BY talkTime DESC LIMIT 5`,
    [record.studentId],
  );
  res.json({ ...apiRow(record), logs, warnings, conversations });
});

router.get('/identifications/:id/logs', (req, res) => {
  const record = scopedRecord(req.params.id, req.user);
  if (!record) return res.status(404).json({ message: '认定记录不存在或无权查看' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
  const total = dbx.get(
    'SELECT COUNT(*) AS c FROM fundingIdentificationLogs WHERE identificationId = ?',
    [req.params.id],
  ).c;
  const list = dbx.all(
    `SELECT * FROM fundingIdentificationLogs WHERE identificationId = ?
     ORDER BY createdAt DESC, rowid DESC LIMIT ? OFFSET ?`,
    [req.params.id, pageSize, (page - 1) * pageSize],
  );
  res.json({ list, total, page, pageSize });
});

/* ==================== 新增 / 编辑 / 状态变更 ==================== */

router.post('/identifications', (req, res) => {
  const body = req.body ?? {};
  const studentId = String(body.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权为该学生建立认定（仅所带班级的学生）' });
  }
  const student = resolveStudent(studentId);
  if (!student) return res.status(404).json({ message: '学生不存在' });

  const parsed = readProfile(body);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const data = parsed.data;

  if (activeRecordOf(studentId, data.academicYear)) {
    return res.status(400).json({ message: '该学生本学年已有有效认定记录，请编辑原记录或先取消后重新认定' });
  }

  const previousId = body.previousId ? String(body.previousId) : null;
  const reason = text(body.reason, 1000);
  if (previousId) {
    const previous = dbx.get('SELECT * FROM fundingIdentifications WHERE id = ?', [previousId]);
    if (!previous || previous.studentId !== studentId || previous.status !== '已取消') {
      return res.status(400).json({ message: '重新认定关联的原记录无效' });
    }
    if (!reason) return res.status(400).json({ message: '重新认定必须填写原因' });
  }

  const id = newId('fi');
  const now = nowStr();
  dbx.run(
    `INSERT INTO fundingIdentifications
      (id, studentId, academicYear, level, difficultyTypes, status, identifiedAt, validFrom, validTo,
       basis, remark, source, previousId, createdBy, createdAt, updatedBy, updatedAt)
     VALUES (?, ?, ?, ?, ?, '已认定', ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
    [
      id, studentId, data.academicYear, data.level, data.difficultyTypes,
      data.identifiedAt, data.validFrom, data.validTo, data.basis, data.remark,
      previousId, req.user.id, now, req.user.id, now,
    ],
  );
  logChange(req, {
    identificationId: id,
    studentId,
    action: previousId ? 'reidentify' : 'create',
    toStatus: '已认定',
    toLevel: data.level,
    reason: previousId ? reason : null,
  });
  logAccess(req, `${previousId ? '重新认定' : '新增困难生认定'}（${student.name} · ${data.academicYear} · ${data.level}）`);
  res.json({ id, ok: true });
});

router.put('/identifications/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM fundingIdentifications WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '认定记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权修改该认定（仅所带班级的学生）' });
  }
  if (target.status === '已取消') {
    return res.status(400).json({ message: '已取消的认定不可编辑，请重新认定' });
  }

  const parsed = readProfile(req.body ?? {}, target);
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const data = parsed.data;
  const reason = text(req.body?.reason, 1000);
  const levelChanged = data.level !== target.level;
  const previousValidTo = toMonth(target.validTo);
  const validToShortened = !!previousValidTo && data.validTo < previousValidTo;
  if ((levelChanged || validToShortened) && !reason) {
    return res.status(400).json({ message: levelChanged ? '调整困难等级必须填写原因' : '缩短有效期必须填写原因' });
  }

  const now = nowStr();
  dbx.run(
    `UPDATE fundingIdentifications SET
       level = ?, difficultyTypes = ?, identifiedAt = ?, validFrom = ?, validTo = ?,
       basis = ?, remark = ?, updatedBy = ?, updatedAt = ?
     WHERE id = ?`,
    [
      data.level, data.difficultyTypes, data.identifiedAt, data.validFrom, data.validTo,
      data.basis, data.remark, req.user.id, now, target.id,
    ],
  );
  logChange(req, {
    identificationId: target.id,
    studentId: target.studentId,
    action: levelChanged ? 'level_change' : 'update',
    fromStatus: target.status,
    toStatus: target.status,
    fromLevel: target.level,
    toLevel: data.level,
    reason: reason || null,
  });
  logAccess(req, `更新困难生认定（${target.studentId} · ${data.level}）`);
  res.json({ ok: true });
});

router.post('/identifications/:id/status', (req, res) => {
  const target = dbx.get('SELECT * FROM fundingIdentifications WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '认定记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权变更该认定（仅所带班级的学生）' });
  }
  const action = String(req.body?.action ?? '');
  const reason = text(req.body?.reason, 1000);
  const now = nowStr();

  if (action === 'confirm') {
    if (target.status !== '待复核') {
      return res.status(400).json({ message: '只有「待复核」记录可以确认认定' });
    }
    const level = String(req.body?.level ?? target.level);
    if (!LEVELS.includes(level)) return res.status(400).json({ message: `困难等级需为：${LEVELS.join('、')}` });
    if (level !== target.level && !reason) {
      return res.status(400).json({ message: '调整困难等级必须填写原因' });
    }
    const validFrom = normalizeMonth(req.body?.validFrom, target.validFrom);
    const validTo = normalizeMonth(req.body?.validTo, target.validTo);
    if (!validFrom || !validTo) return res.status(400).json({ message: '日期格式应为 YYYY-MM' });
    if (validTo < validFrom) return res.status(400).json({ message: '有效期结束月份不能早于开始月份' });
    const identifiedAt = normalizeMonth(req.body?.identifiedAt, target.identifiedAt || currentMonth());
    if (!identifiedAt) return res.status(400).json({ message: '认定日期格式应为 YYYY-MM' });

    dbx.run(
      `UPDATE fundingIdentifications SET status = '已认定', level = ?, identifiedAt = ?,
         validFrom = ?, validTo = ?, updatedBy = ?, updatedAt = ? WHERE id = ?`,
      [level, identifiedAt, validFrom, validTo, req.user.id, now, target.id],
    );
    logChange(req, {
      identificationId: target.id,
      studentId: target.studentId,
      action: 'review',
      fromStatus: '待复核',
      toStatus: '已认定',
      fromLevel: target.level,
      toLevel: level,
      reason: reason || null,
    });
    logAccess(req, `确认困难生认定复核（${target.studentId}）`);
    return res.json({ ok: true });
  }

  if (action === 'cancel') {
    if (target.status === '已取消') return res.status(400).json({ message: '该认定已取消' });
    if (!reason) return res.status(400).json({ message: '取消认定必须填写原因' });
    dbx.run(
      `UPDATE fundingIdentifications SET status = '已取消', cancelledAt = ?, cancelReason = ?,
         updatedBy = ?, updatedAt = ? WHERE id = ?`,
      [now, reason, req.user.id, now, target.id],
    );
    logChange(req, {
      identificationId: target.id,
      studentId: target.studentId,
      action: 'cancel',
      fromStatus: target.status,
      toStatus: '已取消',
      fromLevel: target.level,
      reason,
    });
    logAccess(req, `取消困难生认定（${target.studentId}）`);
    return res.json({ ok: true });
  }

  res.status(400).json({ message: '不支持的状态变更操作' });
});

/* ==================== 批量操作 ==================== */

router.post('/identifications/batch', (req, res) => {
  const body = req.body ?? {};
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))].slice(0, 500) : [];
  const action = String(body.action ?? '');
  const reason = text(body.reason, 1000);
  if (ids.length === 0) return res.status(400).json({ message: '请选择要操作的记录' });
  if (!['changeLevel', 'cancel', 'renew', 'confirm'].includes(action)) {
    return res.status(400).json({ message: '不支持的批量操作' });
  }
  if (['changeLevel', 'cancel'].includes(action) && !reason) {
    return res.status(400).json({ message: action === 'cancel' ? '批量取消必须填写原因' : '批量调级必须填写原因' });
  }
  const level = String(body.level ?? '');
  if (action === 'changeLevel' && !LEVELS.includes(level)) {
    return res.status(400).json({ message: `困难等级需为：${LEVELS.join('、')}` });
  }
  const validTo = normalizeMonth(body.validTo, null);
  if (action === 'renew' && !validTo) {
    return res.status(400).json({ message: '请选择新的有效期截止月份' });
  }

  const failures = [];
  let successCount = 0;
  const current = currentMonth();

  for (const id of ids) {
    const target = dbx.get(
      `SELECT x.*, s.name AS studentName FROM fundingIdentifications x
       JOIN students s ON s.id = x.studentId WHERE x.id = ?`,
      [id],
    );
    if (!target) {
      failures.push({ id, studentName: null, reason: '记录不存在' });
      continue;
    }
    if (!canManageStudent(req.user, target.studentId)) {
      failures.push({ id, studentName: target.studentName, reason: '无权操作该学生' });
      continue;
    }
    try {
      if (action === 'changeLevel') {
        if (target.status === '已取消') throw new Error('已取消记录不可调级');
        dbx.withTransaction(() => {
          dbx.run(
            'UPDATE fundingIdentifications SET level = ?, updatedBy = ?, updatedAt = ? WHERE id = ?',
            [level, req.user.id, nowStr(), id],
          );
          logChange(req, {
            identificationId: id,
            studentId: target.studentId,
            action: 'level_change',
            fromStatus: target.status,
            toStatus: target.status,
            fromLevel: target.level,
            toLevel: level,
            reason,
          });
        });
      } else if (action === 'cancel') {
        if (target.status === '已取消') throw new Error('记录已取消');
        dbx.withTransaction(() => {
          dbx.run(
            `UPDATE fundingIdentifications SET status = '已取消', cancelledAt = ?, cancelReason = ?,
               updatedBy = ?, updatedAt = ? WHERE id = ?`,
            [nowStr(), reason, req.user.id, nowStr(), id],
          );
          logChange(req, {
            identificationId: id,
            studentId: target.studentId,
            action: 'cancel',
            fromStatus: target.status,
            toStatus: '已取消',
            fromLevel: target.level,
            reason,
          });
        });
      } else if (action === 'renew') {
        if (target.status === '已取消') throw new Error('已取消记录不可续期');
        const previousValidTo = toMonth(target.validTo);
        if (previousValidTo && validTo < previousValidTo && !reason) {
          throw new Error('缩短有效期必须填写原因');
        }
        dbx.withTransaction(() => {
          dbx.run(
            'UPDATE fundingIdentifications SET validTo = ?, updatedBy = ?, updatedAt = ? WHERE id = ?',
            [validTo, req.user.id, nowStr(), id],
          );
          logChange(req, {
            identificationId: id,
            studentId: target.studentId,
            action: 'update',
            fromStatus: target.status,
            toStatus: target.status,
            reason: reason || `批量续期至 ${validTo}`,
          });
        });
      } else {
        if (target.status !== '待复核') throw new Error('只有待复核记录可以确认认定');
        dbx.withTransaction(() => {
          dbx.run(
            `UPDATE fundingIdentifications SET status = '已认定', identifiedAt = COALESCE(identifiedAt, ?),
               updatedBy = ?, updatedAt = ? WHERE id = ?`,
            [current, req.user.id, nowStr(), id],
          );
          logChange(req, {
            identificationId: id,
            studentId: target.studentId,
            action: 'review',
            fromStatus: '待复核',
            toStatus: '已认定',
            fromLevel: target.level,
            toLevel: target.level,
            reason: reason || null,
          });
        });
      }
      successCount += 1;
    } catch (err) {
      failures.push({ id, studentName: target.studentName, reason: err.message || '操作失败' });
    }
  }

  logAccess(req, `批量${action === 'cancel' ? '取消认定' : action === 'changeLevel' ? '调整等级' : action === 'renew' ? '续期' : '确认认定'}（成功 ${successCount} / 失败 ${failures.length}）`);
  res.json({ successCount, failureCount: failures.length, failures });
});

/* ==================== 学年结转 ==================== */

function nextAcademicYear(year) {
  const start = Number(String(year).slice(0, 4));
  return `${start + 1}-${start + 2}`;
}

function rolloverCandidates(user, fromYear, toYear) {
  const scope = sensitiveScope(user, 'x');
  const sourceRows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className, s.grade, s.status AS studentStatus
     FROM fundingIdentifications x JOIN students s ON s.id = x.studentId
     WHERE x.academicYear = ? AND x.status = '已认定' AND s.status = '在读' ${scope.where}
     ORDER BY s.className ASC, s.studentNo ASC`,
    [fromYear, ...scope.params],
  );
  const existing = new Set(
    dbx.all('SELECT studentId FROM fundingIdentifications WHERE academicYear = ?', [toYear])
      .map((r) => r.studentId),
  );
  return sourceRows.map((row) => ({
    ...apiRow(row),
    skipped: existing.has(row.studentId),
  }));
}

router.get('/rollover/preview', (req, res) => {
  const fromYear = String(req.query.fromYear ?? currentAcademicYear()).trim();
  const toYear = String(req.query.toYear ?? nextAcademicYear(fromYear)).trim();
  if (!isAcademicYear(fromYear) || !isAcademicYear(toYear)) {
    return res.status(400).json({ message: '学年格式应为 YYYY-YYYY' });
  }
  if (toYear !== nextAcademicYear(fromYear)) {
    return res.status(400).json({ message: '目标学年需为源学年的下一学年' });
  }
  const candidates = rolloverCandidates(req.user, fromYear, toYear);
  res.json({
    fromYear,
    toYear,
    candidates,
    total: candidates.length,
    skippedCount: candidates.filter((c) => c.skipped).length,
  });
});

router.post('/rollover', (req, res) => {
  const body = req.body ?? {};
  const fromYear = String(body.fromYear ?? '').trim();
  const toYear = String(body.toYear ?? '').trim();
  if (!isAcademicYear(fromYear) || !isAcademicYear(toYear)) {
    return res.status(400).json({ message: '学年格式应为 YYYY-YYYY' });
  }
  if (toYear !== nextAcademicYear(fromYear)) {
    return res.status(400).json({ message: '目标学年需为源学年的下一学年' });
  }
  const range = yearRange(toYear);
  const validFrom = normalizeMonth(body.validFrom, range.validFrom);
  const validTo = normalizeMonth(body.validTo, range.validTo);
  if (!validFrom || !validTo || validTo < validFrom) {
    return res.status(400).json({ message: '有效期格式不正确' });
  }
  const wantedIds = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
  const allCandidates = rolloverCandidates(req.user, fromYear, toYear);
  const preSkipped = allCandidates.filter((c) => c.skipped).length;
  const candidates = allCandidates
    .filter((c) => !c.skipped && (!wantedIds || wantedIds.has(c.id)));

  let created = 0;
  let skipped = 0;
  const failures = [];
  const now = nowStr();

  for (const candidate of candidates) {
    if (!canManageStudent(req.user, candidate.studentId)) {
      failures.push({ id: candidate.id, studentName: candidate.studentName, reason: '无权操作该学生' });
      continue;
    }
    if (activeRecordOf(candidate.studentId, toYear)) {
      skipped += 1;
      continue;
    }
    const id = newId('fi');
    try {
      dbx.withTransaction(() => {
        dbx.run(
          `INSERT INTO fundingIdentifications
            (id, studentId, academicYear, level, difficultyTypes, status, identifiedAt, validFrom, validTo,
             basis, remark, source, previousId, createdBy, createdAt, updatedBy, updatedAt)
           VALUES (?, ?, ?, ?, ?, '待复核', NULL, ?, ?, ?, ?, 'rollover', ?, ?, ?, ?, ?)`,
          [
            id, candidate.studentId, toYear, candidate.level,
            JSON.stringify(candidate.difficultyTypes), validFrom, validTo,
            candidate.basis, candidate.remark, candidate.id,
            req.user.id, now, req.user.id, now,
          ],
        );
        logChange(req, {
          identificationId: id,
          studentId: candidate.studentId,
          action: 'rollover',
          toStatus: '待复核',
          toLevel: candidate.level,
          reason: `由 ${fromYear} 学年结转`,
        });
      });
      created += 1;
    } catch (err) {
      failures.push({ id: candidate.id, studentName: candidate.studentName, reason: err.message || '结转失败' });
    }
  }

  logAccess(req, `困难生认定学年结转（${fromYear} → ${toYear}，新增 ${created} 条）`);
  res.json({
    created,
    skipped: preSkipped + skipped,
    failureCount: failures.length,
    failures,
  });
});

/* ==================== 批量导入 ==================== */

/** 导入预览：按学号从学生名册回填姓名、班级、年级，并标记名册缺失/无权限 */
router.post('/identifications/import/preview', (req, res) => {
  const raw = Array.isArray(req.body?.studentNos) ? req.body.studentNos : [];
  const studentNos = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, 2000);
  if (studentNos.length === 0) {
    return res.status(400).json({ message: '请提供要核对的学号' });
  }

  const students = [];
  const notFound = [];
  for (const studentNo of studentNos) {
    const student = dbx.get(
      'SELECT id, studentNo, name, className, grade, status FROM students WHERE studentNo = ?',
      [studentNo],
    );
    if (!student) {
      notFound.push(studentNo);
      continue;
    }
    students.push({
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      className: student.className,
      grade: student.grade,
      studentStatus: student.status,
      manageable: canManageStudent(req.user, student.id),
    });
  }
  res.json({ students, notFound });
});

router.post('/identifications/import', (req, res) => {
  if (Array.isArray(req.body?.rows) && req.body.rows.length > 2000) {
    return res.status(400).json({ message: '单次最多导入 2000 行，请分批导入' });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ message: '没有可导入的数据行' });

  const failures = [];
  const operations = [];
  const seen = new Map();
  const now = nowStr();

  rows.forEach((row, index) => {
    const rowNo = Number(row?.row) || index + 2;
    const studentNo = text(row?.studentNo, 40);
    if (!studentNo) {
      failures.push({ row: rowNo, studentNo: '', name: '', reason: '学号为必填项' });
      return;
    }
    if (seen.has(studentNo)) {
      failures.push({ row: rowNo, studentNo, name: row?.name ?? '', reason: `学号与本表第 ${seen.get(studentNo)} 行重复` });
      return;
    }
    seen.set(studentNo, rowNo);

    const student = dbx.get(
      'SELECT id, name, studentNo, className FROM students WHERE studentNo = ?',
      [studentNo],
    );
    if (!student) {
      failures.push({ row: rowNo, studentNo, name: row?.name ?? '', reason: '学号未匹配到学生名册' });
      return;
    }
    if (!canManageStudent(req.user, student.id)) {
      failures.push({ row: rowNo, studentNo, name: student.name, reason: '无权操作该学生（仅所带班级）' });
      return;
    }
    const parsed = readProfile({
      academicYear: row?.academicYear,
      level: row?.level,
      difficultyTypes: row?.difficultyTypes,
      identifiedAt: row?.identifiedAt,
      validFrom: row?.validFrom,
      validTo: row?.validTo,
      basis: row?.basis,
      remark: row?.remark,
    });
    if (parsed.error) {
      failures.push({ row: rowNo, studentNo, name: student.name, reason: parsed.error });
      return;
    }
    const existing = activeRecordOf(student.id, parsed.data.academicYear);
    let previousId = null;
    if (!existing) {
      const cancelled = dbx.get(
        `SELECT id FROM fundingIdentifications
         WHERE studentId = ? AND academicYear = ? AND status = '已取消'
         ORDER BY updatedAt DESC, rowid DESC LIMIT 1`,
        [student.id, parsed.data.academicYear],
      );
      previousId = cancelled?.id ?? null;
    }
    operations.push({ row: rowNo, student, data: parsed.data, existing, previousId });
  });

  let created = 0;
  let updated = 0;
  try {
    dbx.withTransaction(() => {
      for (const op of operations) {
        if (op.existing) {
          dbx.run(
            `UPDATE fundingIdentifications SET
               level = ?, difficultyTypes = ?, status = '已认定', identifiedAt = ?, validFrom = ?, validTo = ?,
               basis = ?, remark = ?, source = 'import', updatedBy = ?, updatedAt = ?
             WHERE id = ?`,
            [
              op.data.level, op.data.difficultyTypes, op.data.identifiedAt, op.data.validFrom, op.data.validTo,
              op.data.basis, op.data.remark, req.user.id, now, op.existing.id,
            ],
          );
          logChange(req, {
            identificationId: op.existing.id,
            studentId: op.student.id,
            action: 'import',
            fromStatus: op.existing.status,
            toStatus: '已认定',
            fromLevel: op.existing.level,
            toLevel: op.data.level,
            reason: `Excel 导入更新（第 ${op.row} 行）`,
          });
          updated += 1;
        } else {
          const id = newId('fi');
          dbx.run(
            `INSERT INTO fundingIdentifications
              (id, studentId, academicYear, level, difficultyTypes, status, identifiedAt, validFrom, validTo,
               basis, remark, source, previousId, createdBy, createdAt, updatedBy, updatedAt)
             VALUES (?, ?, ?, ?, ?, '已认定', ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?)`,
            [
              id, op.student.id, op.data.academicYear, op.data.level, op.data.difficultyTypes,
              op.data.identifiedAt, op.data.validFrom, op.data.validTo, op.data.basis, op.data.remark,
              op.previousId, req.user.id, now, req.user.id, now,
            ],
          );
          logChange(req, {
            identificationId: id,
            studentId: op.student.id,
            action: 'import',
            toStatus: '已认定',
            toLevel: op.data.level,
            reason: `Excel 导入新增（第 ${op.row} 行）`,
          });
          created += 1;
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ message: `导入失败，已回滚：${err.message || '数据库错误'}` });
  }

  logAccess(req, `Excel 导入困难生认定（新增 ${created} / 更新 ${updated} / 失败 ${failures.length}）`);
  res.json({
    total: rows.length,
    created,
    updated,
    skipped: 0,
    failureCount: failures.length,
    failures,
  });
});

/* ==================== 统计 ==================== */

router.get('/stats', (req, res) => {
  const { conds, params, year } = buildFilters(req);
  const scope = sensitiveScope(req.user, 'x');
  const where = `${conds.join(' AND ')} ${scope.where}`;
  const join = 'FROM fundingIdentifications x JOIN students s ON s.id = x.studentId';
  const rows = dbx.all(`SELECT x.*, s.grade, s.className ${join} WHERE ${where}`, [...params, ...scope.params]);
  const current = currentMonth();
  const soon = soonMonth();

  let identifiedCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let expiredCount = 0;
  let expiringCount = 0;
  const levelCounts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const typeCounts = new Map();
  const gradeCounts = new Map();
  const classCounts = new Map();

  for (const row of rows) {
    if (row.status === '已取消') {
      cancelledCount += 1;
      continue;
    }
    if (row.status === '待复核') {
      pendingCount += 1;
      continue;
    }
    identifiedCount += 1;
    levelCounts[row.level] = (levelCounts[row.level] ?? 0) + 1;
    for (const type of parseTypesJson(row.difficultyTypes)) {
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    const gradeLabel = row.grade || '未分年级';
    gradeCounts.set(gradeLabel, (gradeCounts.get(gradeLabel) ?? 0) + 1);
    const classLabel = row.className || '未分班';
    classCounts.set(classLabel, (classCounts.get(classLabel) ?? 0) + 1);
    const validTo = toMonth(row.validTo);
    if (validTo && validTo < current) expiredCount += 1;
    else if (validTo && validTo <= soon) expiringCount += 1;
  }

  // 认定率分母：与当前学年同范围的在校学生（不受等级/状态/关键字筛选影响）
  const studentConds = ["s.status = '在读'"];
  const studentParams = [];
  if (!isAdmin(req.user)) {
    studentConds.push('s.classId IN (SELECT classId FROM classCounselors WHERE userId = ?)');
    studentParams.push(req.user.id);
  }
  const gradeValue = String(req.query.grade ?? '').trim();
  if (gradeValue) { studentConds.push('s.grade = ?'); studentParams.push(gradeValue); }
  const classIds = parseClassIds(req.query.classIds);
  if (classIds.length > 0) {
    studentConds.push(`s.classId IN (${classIds.map(() => '?').join(',')})`);
    studentParams.push(...classIds);
  }
  const studentCount = dbx.get(
    `SELECT COUNT(*) AS c FROM students s WHERE ${studentConds.join(' AND ')}`,
    studentParams,
  ).c;

  // 学年对比：沿用班级/年级范围，统计各学年已认定人数
  const yearConds = ["x.status = '已认定'"];
  const yearParams = [];
  const yearScope = sensitiveScope(req.user, 'x');
  if (gradeValue) { yearConds.push('s.grade = ?'); yearParams.push(gradeValue); }
  if (classIds.length > 0) {
    yearConds.push(`s.classId IN (${classIds.map(() => '?').join(',')})`);
    yearParams.push(...classIds);
  }
  const byYear = dbx.all(
    `SELECT x.academicYear AS label, COUNT(*) AS count ${join}
     WHERE ${yearConds.join(' AND ')} ${yearScope.where}
     GROUP BY x.academicYear ORDER BY x.academicYear ASC`,
    [...yearParams, ...yearScope.params],
  );

  res.json({
    academicYear: year,
    summary: {
      total: rows.length,
      identifiedCount,
      pendingCount,
      cancelledCount,
      expiredCount,
      expiringCount,
      studentCount,
      coverage: studentCount > 0 ? Math.round((identifiedCount / studentCount) * 1000) / 10 : 0,
    },
    byLevel: LEVELS.map((label) => ({ label, count: levelCounts[label] ?? 0 })),
    byGrade: [...gradeCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    byClass: [...classCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN')),
    byType: [...typeCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    byYear,
  });
});

module.exports = router;

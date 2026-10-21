/**
 * 学生名册：列表/筛选/分页、增删改查、批量导入。
 * 查看范围按角色收口（lib/scope.js rosterScope）：管理员或含辅导员角色全员可见，
 * 其他角色仅见所带班级学生（多角色按最大范围合并）；编辑/删除限带班辅导员或管理员。
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { canManageStudent, rosterScope } = require('../lib/scope');
const { normalizeTarget, diffStudentFields } = require('../lib/studentDiff');
const { mirrorStudentDorm, removeDormOfStudent, renameDormStudentNo, syncDormFromText } = require('../lib/dormitory');
const { derivedTeachersOfClass } = require('../lib/teacherSync');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

/**
 * 学生查询统一 LEFT JOIN 寝室管理：dormBuilding / dormRoom 为名册展示「宿舍」的唯一来源
 * （展示口径 = 宿舍楼 + 房间号，见 lib/dormitory.js joinDorm）。
 * students.dorm 仅作镜像保留（同宿舍学生、导出等复用），不再作为名册展示依据。
 */
const STUDENT_SELECT = `
  SELECT s.*, d.building AS dormBuilding, d.room AS dormRoom
  FROM students s LEFT JOIN dormitories d ON d.studentNo = s.studentNo`;

const router = express.Router();
router.use(auth.authMiddleware);

const FIELDS = [
  'studentNo', 'name', 'gender', 'grade', 'major', 'className', 'phone', 'dorm',
  'politicalStatus', 'origin', 'status', 'headTeacher', 'counselor',
  'fatherName', 'fatherPhone', 'motherName', 'motherPhone', 'position', 'remark', 'enrollDate',
];

/** 共管老师列表 */
function coManagersOf(studentId) {
  return dbx.all(
    'SELECT u.id, u.displayName AS name FROM studentCounselors sc JOIN users u ON u.id = sc.userId WHERE sc.studentId = ?',
    [studentId],
  );
}

function setCoManagers(studentId, userIds) {
  dbx.run('DELETE FROM studentCounselors WHERE studentId = ?', [studentId]);
  for (const uid of userIds) {
    const id = Number(uid);
    if (Number.isInteger(id) && id > 0) {
      dbx.run('INSERT INTO studentCounselors (studentId, userId) VALUES (?, ?)', [studentId, id]);
    }
  }
}

/**
 * 解析学生归属班级 classId：
 * - body.classId 显式传 null/'' 表示清空；传数字时校验班级存在，不存在返回 { error }
 * - 未传 classId 时按 (grade, className) 文本反查字典回填，查不到返回 { value: null }（不自动建班）
 * - PUT 场景可传 fallback（库中原行），文本字段未随请求更新时以原值为准
 */
function resolveStudentClassId(body, fallback = {}) {
  if (body.classId !== undefined) {
    if (body.classId === null || body.classId === '') return { value: null };
    const cid = Number(body.classId);
    if (!Number.isInteger(cid) || cid <= 0 || !dbx.get('SELECT id FROM classes WHERE id = ?', [cid])) {
      return { error: '所选班级不存在（可能已被删除）' };
    }
    return { value: cid };
  }
  const grade = String(body.grade ?? fallback.grade ?? '').trim();
  const className = String(body.className ?? fallback.className ?? '').trim();
  if (!grade || !className) return { value: null };
  const row = dbx.get(
    'SELECT c.id FROM classes c JOIN grades g ON g.id = c.gradeId WHERE c.name = ? AND g.name = ?',
    [className, grade],
  );
  return { value: row ? row.id : null };
}

/**
 * 列表筛选口径（列表查询与批量全选共用，保证「全选当前筛选结果」与所见一致）：
 * 关键字（姓名/学号/班级/手机号/专业）+ 年级 + 班级 + 专业 + 学籍状态
 */
function buildStudentFilter(query) {
  const { grade, major, status } = query;
  const kw = String(query.keyword ?? '').trim();

  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ? OR s.className LIKE ? OR s.phone LIKE ? OR s.major LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (grade) { conds.push('s.grade = ?'); params.push(String(grade)); }
  // 专业按去空白后比对：选项值来自 /students/majors 的 TRIM 结果，
  // 若库内存在「电子商务 」这类带空白的脏值，直接等值比会筛不出任何记录。
  if (major) { conds.push('TRIM(s.major) = ?'); params.push(String(major).trim()); }
  if (status) { conds.push('s.status = ?'); params.push(String(status)); }
  const classId = Number(query.classId);
  if (Number.isInteger(classId) && classId > 0) { conds.push('s.classId = ?'); params.push(classId); }

  return { where: conds.join(' AND '), params };
}

/** 列表：关键字 + 年级/班级/专业/学籍状态筛选 + 分页（管理员/辅导员全员可见，其他角色仅所带班级） */
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const { where, params } = buildStudentFilter(req.query);
  const scope = rosterScope(req.user);
  const conds = [where];
  if (scope) {
    conds.push(scope.sql);
    params.push(...scope.params);
  }
  const finalWhere = conds.join(' AND ');
  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM students s WHERE ${finalWhere}`,
    params,
  ).c;
  const rows = dbx.all(
    `${STUDENT_SELECT} WHERE ${finalWhere} ORDER BY s.studentNo DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows, total, page, pageSize });
});

/**
 * 表单下拉：在读学生精简列表（可见范围内）。
 * 与列表同口径：无辅导员/管理员角色的用户仅返回所带班级学生，避免下拉框泄露其他班级的学生姓名/学号。
 */
router.get('/options', (req, res) => {
  const scope = rosterScope(req.user);
  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className, s.classId FROM students s
     WHERE s.status = '在读'${scope ? ` AND ${scope.sql}` : ''} ORDER BY s.studentNo`,
    scope ? scope.params : [],
  );
  res.json(rows);
});

/**
 * 导入查重用：可见范围内学号（学号全局唯一，导入接口仍做全局查重兜底，
 * 故收口到可见范围不会放过重复学号，只影响前端预检提示的覆盖度）。
 */
router.get('/nos', (req, res) => {
  const scope = rosterScope(req.user);
  const rows = dbx.all(
    `SELECT s.studentNo FROM students s${scope ? ` WHERE ${scope.sql}` : ''}`,
    scope ? scope.params : [],
  );
  res.json(rows.map((r) => r.studentNo));
});

/* —— 以下为名册数据接口：需「学生名册」模块权限（/options、/nos 为跨模块参考数据，不受限） —— */
router.use(requirePermission('students'));

/**
 * 筛选下拉：名册中「实际存在」的专业（去重、去首尾空白、忽略空值）。
 * 专业是自由文本（导入/编辑均可写入任意名称），故不能用前端静态清单当选项，
 * 否则会出现「下拉里有名册中查不到的专业」或「名册里的专业下拉里没有」。
 * 与列表同口径：同样走 rosterScope 收口，保证下拉里每个专业在当前账号可见范围内都筛得出学生。
 * 排序：人数多的在前，人数相同按名称，便于高频专业置顶。
 */
router.get('/majors', (req, res) => {
  const scope = rosterScope(req.user);
  const rows = dbx.all(
    `SELECT TRIM(s.major) AS major, COUNT(*) AS c FROM students s
     WHERE s.major IS NOT NULL AND TRIM(s.major) <> ''${scope ? ` AND ${scope.sql}` : ''}
     GROUP BY TRIM(s.major)
     ORDER BY c DESC, major`,
    scope ? scope.params : [],
  );
  res.json(rows.map((r) => r.major));
});

/**
 * 批量选择用：当前筛选条件下的全部学生精简信息（不分页，仅管理员）。
 * 与列表同一套筛选口径，供前端「全选当前筛选结果」与删除确认摘要使用。
 */
router.get('/briefs', auth.adminOnly, (req, res) => {
  const { where, params } = buildStudentFilter(req.query);
  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.grade, s.className, s.classId
     FROM students s WHERE ${where} ORDER BY s.studentNo DESC`,
    params,
  );
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = dbx.get(`${STUDENT_SELECT} WHERE s.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ message: '学生不存在' });
  // 与列表同口径：收口用户仅可查看其所带班级的学生（防绕过列表直达详情）
  const scope = rosterScope(req.user);
  if (scope) {
    const inScope = dbx.get(
      `SELECT 1 FROM students s WHERE s.id = ? AND ${scope.sql}`,
      [req.params.id, ...scope.params],
    );
    if (!inScope) return res.status(403).json({ message: '仅可查看其所带班级的学生' });
  }
  res.json({ ...row, coManagerIds: coManagersOf(req.params.id).map((u) => u.id), coManagers: coManagersOf(req.params.id) });
});

/**
 * 同宿舍学生（详情页模块）：宿舍文本相同（去首尾空白后比对）的在读学生，不含本人。
 * 与详情同口径：收口用户仅可见其所带班级的室友，防绕过列表直达详情泄露他班学生。
 * 学生未登记宿舍时返回空列表，由前端区分「未登记宿舍」与「无室友」两种空态。
 */
router.get('/:id/roommates', (req, res) => {
  const row = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: '学生不存在' });
  const scope = rosterScope(req.user);
  if (scope) {
    const inScope = dbx.get(
      `SELECT 1 FROM students s WHERE s.id = ? AND ${scope.sql}`,
      [req.params.id, ...scope.params],
    );
    if (!inScope) return res.status(403).json({ message: '仅可查看其所带班级的学生' });
  }
  const dorm = String(row.dorm ?? '').trim();
  if (!dorm) return res.json([]);
  const rows = dbx.all(
    `SELECT s.id, s.name, s.className, s.phone FROM students s
     WHERE TRIM(s.dorm) = ? AND s.id != ? AND s.status = '在读'${scope ? ` AND ${scope.sql}` : ''}
     ORDER BY s.studentNo`,
    [dorm, req.params.id, ...(scope ? scope.params : [])],
  );
  res.json(rows.map((r) => ({ ...r, phone: r.phone ?? null })));
});

router.get('/id/exists', (req, res) => {
  const no = String(req.query.studentNo ?? '');
  const row = dbx.get('SELECT id FROM students WHERE studentNo = ?', [no]);
  res.json({ exists: !!row });
});

/** 新增：辅导员默认自己为主责；管理员可指定归属与共管 */
router.post('/', (req, res) => {
  const body = req.body ?? {};
  const studentNo = String(body.studentNo ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!studentNo || !name) return res.status(400).json({ message: '学号与姓名为必填项' });
  if (dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo])) {
    return res.status(400).json({ message: `学号 ${studentNo} 已存在` });
  }

  const ownerId = req.user.role === 'admin' && body.ownerId
    ? Number(body.ownerId)
    : req.user.id;
  const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const cls = resolveStudentClassId(body);
  if (cls.error) return res.status(400).json({ message: cls.error });

  // 班主任 / 辅导员一律由班级教师名单派生（班级管理为唯一来源，不接受入参）
  const derived = derivedTeachersOfClass(cls.value);

  dbx.run(`INSERT INTO students
    (id, studentNo, name, gender, grade, major, className, classId, phone, dorm, politicalStatus, origin, status,
     headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
     ownerId, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, studentNo, name, body.gender ?? '男', body.grade ?? '', body.major ?? '', body.className ?? '',
      cls.value, body.phone ?? '', body.dorm ?? null, body.politicalStatus ?? null, body.origin ?? null,
      body.status ?? '在读', derived.headTeacher, derived.counselor, body.fatherName ?? null,
      body.fatherPhone ?? null, body.motherName ?? null, body.motherPhone ?? null, body.position ?? null,
      body.remark ?? null, body.enrollDate ?? '', ownerId, req.user.id, nowStr(), nowStr()],
  );
  if (Array.isArray(body.coManagerIds)) setCoManagers(id, body.coManagerIds);
  // 新增时填写的宿舍文本同步进寝室管理（寝室模块为宿舍数据唯一来源，学生表只留镜像）
  if (String(body.dorm ?? '').trim()) syncDormFromText(studentNo, body.dorm);

  logAccess(req, `新增学生 ${name}（${studentNo}）`);
  const row = dbx.get(`${STUDENT_SELECT} WHERE s.id = ?`, [id]);
  res.json({ ...row, coManagerIds: coManagersOf(id).map((u) => u.id) });
});

/** 编辑：仅所带班级的辅导员或管理员；共管关系与归属（仅管理员）可更新 */
router.put('/:id', (req, res) => {
  if (!canManageStudent(req.user, req.params.id)) {
    return res.status(403).json({ message: '无权修改该学生（仅所带班级的学生或管理员可编辑）' });
  }
  const target = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '学生不存在' });

  const body = req.body ?? {};
  const studentNo = String(body.studentNo ?? target.studentNo).trim();
  if (studentNo !== target.studentNo) {
    if (dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo])) {
      return res.status(400).json({ message: `学号 ${studentNo} 已存在` });
    }
  }

  const sets = [];
  const params = [];
  for (const field of FIELDS) {
    // 班主任 / 辅导员不接受入参：统一由班级教师名单派生，避免其他模块另写一份
    if (field === 'headTeacher' || field === 'counselor') continue;
    if (body[field] !== undefined) { sets.push(`${field} = ?`); params.push(body[field]); }
  }
  const cls = resolveStudentClassId(body, target);
  if (cls.error) return res.status(400).json({ message: cls.error });
  sets.push('classId = ?');
  params.push(cls.value);
  // 班级归属确定后重算派生责任人（换班 / 教师调整都能即时生效）
  const derived = derivedTeachersOfClass(cls.value);
  sets.push('headTeacher = ?');
  params.push(derived.headTeacher);
  sets.push('counselor = ?');
  params.push(derived.counselor);
  if (req.user.role === 'admin' && body.ownerId !== undefined) {
    sets.push('ownerId = ?'); params.push(Number(body.ownerId) || req.user.id);
  }
  sets.push('updatedAt = ?'); params.push(nowStr());
  sets.push('studentNo = ?'); params.push(studentNo);

  dbx.run(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  if (Array.isArray(body.coManagerIds)) setCoManagers(req.params.id, body.coManagerIds);
  // 学号变更时同步寝室分配的关联键；宿舍文本变更（含清空）同步到寝室管理
  if (studentNo !== target.studentNo) renameDormStudentNo(target.studentNo, studentNo);
  if (body.dorm !== undefined) syncDormFromText(studentNo, body.dorm);

  logAccess(req, `修改学生 ${target.name}（${target.studentNo}）`);
  const row = dbx.get(`${STUDENT_SELECT} WHERE s.id = ?`, [req.params.id]);
  res.json({ ...row, coManagerIds: coManagersOf(req.params.id).map((u) => u.id) });
});

/** 删除：仅所带班级的辅导员或管理员（谈话/预警等历史记录保留，便于留档追溯） */
router.delete('/:id', (req, res) => {
  if (!canManageStudent(req.user, req.params.id)) {
    return res.status(403).json({ message: '无权删除该学生（仅所带班级的学生或管理员可删除）' });
  }
  const target = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '学生不存在' });
  dbx.run('DELETE FROM studentCounselors WHERE studentId = ?', [req.params.id]);
  dbx.run('DELETE FROM students WHERE id = ?', [req.params.id]);
  // 学生档案删除后其寝室分配随之清理（避免留下查无此人的孤儿分配）
  removeDormOfStudent(target.studentNo);
  logAccess(req, `删除学生 ${target.name}（${target.studentNo}）`);
  res.json({ ok: true });
});

/**
 * 批量删除：仅管理员。单次请求内事务写入（全部成功或全部回滚）。
 * - 先整批校验目标是否仍存在：有任一已被他人删除则整批拒绝，避免「部分成功」
 * - 共管关系同步清理；谈话/预警/审批等历史记录保留，便于留档追溯
 * - 操作日志写入 accessLogs：操作人、时间由 logAccess 记录，action 内附全部学生明细
 */
router.post('/batch-delete', auth.adminOnly, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return res.status(400).json({ message: '请选择要删除的学生' });
  if (ids.length > 2000) return res.status(400).json({ message: '单次最多删除 2000 名学生，请分批操作' });

  const marks = ids.map(() => '?').join(', ');
  const targets = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className FROM students s WHERE s.id IN (${marks})`,
    ids,
  );
  if (targets.length !== ids.length) {
    return res.status(409).json({
      message: `所选学生中有 ${ids.length - targets.length} 名已不存在（可能已被删除），请刷新列表后重新选择`,
    });
  }

  dbx.db.exec('BEGIN IMMEDIATE');
  try {
      for (const id of ids) {
        dbx.run('DELETE FROM studentCounselors WHERE studentId = ?', [id]);
        const info = dbx.run('DELETE FROM students WHERE id = ?', [id]);
        if (Number(info.changes) !== 1) throw new Error(`学生 ${id} 删除失败`);
        removeDormOfStudent(targets.find((t) => t.id === id)?.studentNo);
      }
    dbx.db.exec('COMMIT');
  } catch (e) {
    dbx.db.exec('ROLLBACK');
    console.error('[students/batch-delete] 事务回滚：', e.message);
    return res.status(500).json({ message: '批量删除失败，已全部回滚，未产生任何数据变更' });
  }

  const detail = targets.map((t) => `${t.name}（${t.studentNo}）`).join('、');
  logAccess(req, `批量删除学生 ${targets.length} 名：${detail}`);

  res.json({
    ok: true,
    deletedCount: targets.length,
    deleted: targets.map((t) => ({ id: t.id, name: t.name, studentNo: t.studentNo, className: t.className })),
  });
});

/**
 * 批量导入（upsert 语义）：以学号为唯一标识——
 * - 学号不存在 → 新增；
 * - 已存在且在编辑权限内（canManageStudent）→ 逐字段比对，仅更新有变化字段，完全相同跳过；
 * - 已存在但不在编辑权限内（他人所带班级）→ 判失败；
 * - 同一批文件内学号重复 → 判失败（两行数据可能不同，避免互相覆盖）。
 * 校验在事务外完成，写入包事务保证单次请求原子性。
 */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const failures = [];
  const inserts = []; // 新增待写入 { row, studentNo, target }
  const updates = []; // 更新待写入 { id, target, changedFields }
  let skippedCount = 0;

  // 空值入库统一为 null（与历史数据一致），比对时 ''/null 等价
  const opt = (v) => (v === '' ? null : v);

  // 事务外先完成全部校验（读操作），事务内只做写入
  const fileSeen = new Map(); // studentNo → 本批首次出现的行号
  for (const { row, data } of rows) {
    const reasons = [];
    const studentNo = String(data?.studentNo ?? '').trim();
    const name = String(data?.name ?? '').trim();
    if (!studentNo) reasons.push('学号为必填项');
    if (!name) reasons.push('姓名为必填项');
    if (!data?.gender) reasons.push('性别为必填项');
    if (!data?.grade) reasons.push('年级为必填项');
    if (!data?.className) reasons.push('班级为必填项');
    if (!data?.enrollDate) reasons.push('入学时间为必填项');

    if (studentNo && fileSeen.has(studentNo)) {
      reasons.push(`学号与本批第 ${fileSeen.get(studentNo)} 行重复`);
    }
    if (studentNo) fileSeen.set(studentNo, row);

    if (reasons.length > 0) {
      failures.push({ row, studentNo: studentNo || '—', name: name || '—', reason: reasons.join('；'), data });
      continue;
    }

    // 班级字典匹配：(年级, 班级) 必须已存在于班级管理，未匹配的行跳过不导入
    const grade = String(data?.grade ?? '').trim();
    const className = String(data?.className ?? '').trim();
    const clsRow = dbx.get(
      'SELECT c.id, c.name FROM classes c JOIN grades g ON g.id = c.gradeId WHERE c.name = ? AND g.name = ?',
      [className, grade],
    );
    if (!clsRow) {
      failures.push({
        row, studentNo, name,
        reason: `班级名未匹配到班级字典（${grade} ${className}），请先在「班级管理」中创建该班级`,
        data,
      });
      continue;
    }

    // 班主任 / 辅导员由班级教师名单派生后注入（学生模板已移除两列）
    const target = { ...normalizeTarget(data, clsRow), ...derivedTeachersOfClass(clsRow.id) };
    const existing = dbx.get('SELECT * FROM students WHERE studentNo = ?', [studentNo]);
    if (!existing) {
      inserts.push({ row, studentNo, target });
      continue;
    }

    // 学号已存在：更新权限按编辑口径收口（管理员或该学生归属班级在带班范围内）
    if (!canManageStudent(req.user, existing.id)) {
      failures.push({
        row, studentNo, name,
        reason: `学号 ${studentNo} 已存在且不在您所带班级范围内，无权限更新`,
        data,
      });
      continue;
    }
    const changedFields = diffStudentFields(target, existing);
    if (changedFields.length === 0) {
      skippedCount += 1; // 与系统记录完全一致，跳过不导入
      continue;
    }
    updates.push({ id: existing.id, target, changedFields });
  }

  // 事务写入：单次请求内原子生效（中途异常全部回滚，不产生部分导入）
  let insertedCount = 0;
  let updatedCount = 0;
  if (inserts.length > 0 || updates.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      for (const it of inserts) {
        const t = it.target;
        dbx.run(`INSERT INTO students
          (id, studentNo, name, gender, grade, major, className, classId, phone, dorm, politicalStatus, origin, status,
           headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
           ownerId, createdBy, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${it.row}`, it.studentNo,
            t.name, t.gender, t.grade, t.major, t.className, t.classId, t.phone,
            opt(t.dorm), opt(t.politicalStatus), opt(t.origin), t.status,
            opt(t.headTeacher), opt(t.counselor), opt(t.fatherName), opt(t.fatherPhone),
            opt(t.motherName), opt(t.motherPhone), opt(t.position), opt(t.remark), t.enrollDate,
            req.user.id, req.user.id, nowStr(), nowStr()],
        );
        // 导入时填写的宿舍同步进寝室管理（空值不处理，避免覆盖已有分配）
        if (String(it.target.dorm ?? '').trim()) syncDormFromText(it.studentNo, it.target.dorm);
        insertedCount += 1;
      }
      for (const it of updates) {
        // 仅更新有变化的字段（changedFields 来自 COMPARE_FIELDS 白名单，可安全拼接）
        const sets = it.changedFields.map((f) => `${f} = ?`);
        const params = it.changedFields.map((f) => opt(it.target[f]));
        sets.push('updatedAt = ?');
        params.push(nowStr(), it.id);
        dbx.run(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, params);
        // 仅宿舍字段有变化才同步（清空表示解除寝室分配）
        if (it.changedFields.includes('dorm')) syncDormFromText(it.studentNo, it.target.dorm);
        updatedCount += 1;
      }
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[students/import] 事务回滚：', e.message);
      return res.status(500).json({ message: '导入失败，已全部回滚，未产生任何数据变更' });
    }
  }

  logAccess(req, `批量导入学生：新增 ${insertedCount}、更新 ${updatedCount}、跳过 ${skippedCount}，失败 ${failures.length} 条`);
  res.json({
    total: rows.length,
    successCount: insertedCount + updatedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    failures,
  });
});

module.exports = router;

/** 学生信息：列表/筛选/分页、增删改查、归属过滤、批量导入 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { studentScope, canSeeStudent } = require('../lib/scope');
const { logAccess, nowStr } = require('../lib/audit');

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

/** 列表：关键字 + 年级/专业/学籍状态筛选 + 分页 */
router.get('/', (req, res) => {
  const { keyword = '', grade, major, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const scope = studentScope(req.user);
  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ? OR s.className LIKE ? OR s.phone LIKE ? OR s.major LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (grade) { conds.push('s.grade = ?'); params.push(grade); }
  if (major) { conds.push('s.major = ?'); params.push(major); }
  if (status) { conds.push('s.status = ?'); params.push(status); }

  const where = `${conds.join(' AND ')} ${scope.where}`;
  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM students s WHERE ${where}`,
    [...params, ...scope.params],
  ).c;
  const rows = dbx.all(
    `SELECT s.* FROM students s WHERE ${where} ORDER BY s.studentNo DESC LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows, total, page, pageSize });
});

/** 表单下拉：在读学生精简列表（可见范围内） */
router.get('/options', (req, res) => {
  const scope = studentScope(req.user);
  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className FROM students s
     WHERE s.status = '在读' ${scope.where} ORDER BY s.studentNo`,
    [...scope.params],
  );
  res.json(rows);
});

/** 导入查重用：可见范围内全部学号 */
router.get('/nos', (req, res) => {
  const scope = studentScope(req.user);
  const rows = dbx.all(`SELECT s.studentNo FROM students s WHERE 1 = 1 ${scope.where}`, [...scope.params]);
  res.json(rows.map((r) => r.studentNo));
});

router.get('/:id', (req, res) => {
  if (!canSeeStudent(req.user, req.params.id)) {
    return res.status(403).json({ message: '无权查看该学生' });
  }
  const row = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: '学生不存在' });
  res.json({ ...row, coManagerIds: coManagersOf(req.params.id).map((u) => u.id), coManagers: coManagersOf(req.params.id) });
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

  dbx.run(`INSERT INTO students
    (id, studentNo, name, gender, grade, major, className, phone, dorm, politicalStatus, origin, status,
     headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
     ownerId, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, studentNo, name, body.gender ?? '男', body.grade ?? '', body.major ?? '', body.className ?? '',
      body.phone ?? '', body.dorm ?? null, body.politicalStatus ?? null, body.origin ?? null,
      body.status ?? '在读', body.headTeacher ?? null, body.counselor ?? null, body.fatherName ?? null,
      body.fatherPhone ?? null, body.motherName ?? null, body.motherPhone ?? null, body.position ?? null,
      body.remark ?? null, body.enrollDate ?? '', ownerId, req.user.id, nowStr(), nowStr()],
  );
  if (Array.isArray(body.coManagerIds)) setCoManagers(id, body.coManagerIds);

  logAccess(req, `新增学生 ${name}（${studentNo}）`);
  const row = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [id]);
  res.json({ ...row, coManagerIds: coManagersOf(id).map((u) => u.id) });
});

/** 编辑：需可见；共管关系与归属（仅管理员）可更新 */
router.put('/:id', (req, res) => {
  if (!canSeeStudent(req.user, req.params.id)) {
    return res.status(403).json({ message: '无权修改该学生' });
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
    if (body[field] !== undefined) { sets.push(`${field} = ?`); params.push(body[field]); }
  }
  if (req.user.role === 'admin' && body.ownerId !== undefined) {
    sets.push('ownerId = ?'); params.push(Number(body.ownerId) || req.user.id);
  }
  sets.push('updatedAt = ?'); params.push(nowStr());
  sets.push('studentNo = ?'); params.push(studentNo);

  dbx.run(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  if (Array.isArray(body.coManagerIds)) setCoManagers(req.params.id, body.coManagerIds);

  logAccess(req, `修改学生 ${target.name}（${target.studentNo}）`);
  const row = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  res.json({ ...row, coManagerIds: coManagersOf(req.params.id).map((u) => u.id) });
});

/** 删除（谈话/预警等历史记录保留，便于留档追溯） */
router.delete('/:id', (req, res) => {
  if (!canSeeStudent(req.user, req.params.id)) {
    return res.status(403).json({ message: '无权删除该学生' });
  }
  const target = dbx.get('SELECT s.* FROM students s WHERE s.id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '学生不存在' });
  dbx.run('DELETE FROM studentCounselors WHERE studentId = ?', [req.params.id]);
  dbx.run('DELETE FROM students WHERE id = ?', [req.params.id]);
  logAccess(req, `删除学生 ${target.name}（${target.studentNo}）`);
  res.json({ ok: true });
});

/** 批量追加导入（前端已完成预检，服务端做全局学号查重兜底） */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  let successCount = 0;
  const failures = [];

  for (const { row, data } of rows) {
    const reasons = [];
    const studentNo = String(data?.studentNo ?? '').trim();
    const name = String(data?.name ?? '').trim();
    if (!studentNo) reasons.push('学号为必填项');
    else if (dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo])) {
      reasons.push('学号已存在于系统中，不可重复导入');
    }
    if (!name) reasons.push('姓名为必填项');
    if (!data?.gender) reasons.push('性别为必填项');
    if (!data?.className) reasons.push('班级为必填项');
    if (!data?.enrollDate) reasons.push('入学时间为必填项');

    if (reasons.length > 0) {
      failures.push({ row, studentNo: studentNo || '—', name: name || '—', reason: reasons.join('；'), data });
      continue;
    }

    dbx.run(`INSERT INTO students
      (id, studentNo, name, gender, grade, major, className, phone, dorm, politicalStatus, origin, status,
       headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
       ownerId, createdBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${row}`, studentNo, name,
        data.gender ?? '男', data.grade ?? '', data.major ?? '', data.className ?? '', data.phone ?? '',
        data.dorm ?? null, data.politicalStatus ?? null, data.origin ?? null, data.status ?? '在读',
        data.headTeacher ?? null, data.counselor ?? null, data.fatherName ?? null, data.fatherPhone ?? null,
        data.motherName ?? null, data.motherPhone ?? null, data.position ?? null, data.remark ?? null,
        data.enrollDate ?? '', req.user.id, req.user.id, nowStr(), nowStr()],
    );
    successCount += 1;
  }

  logAccess(req, `批量导入学生：成功 ${successCount} 条，失败 ${failures.length} 条`);
  res.json({ total: rows.length, successCount, failures });
});

module.exports = router;

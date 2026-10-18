/** 谈心谈话记录：列表/时间线/增删改查（仅所带班级学生的记录可见可维护） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { sensitiveScope, canManageStudent } = require('../lib/scope');
const { requirePermission } = require('../lib/permissions');
const { logAccess } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('conversations'));

function toBool(v) { return v === 1 || v === true; }

/** 列表：关键字 + 类型/方式/跟进/日期区间/学生筛选 + 分页 */
router.get('/', (req, res) => {
  const { keyword = '', studentId, type, way, needFollowUp, startDate, endDate } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const scope = sensitiveScope(req.user, 'x');
  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(x.content LIKE ? OR EXISTS (SELECT 1 FROM students s2 WHERE s2.id = x.studentId AND (s2.name LIKE ? OR s2.studentNo LIKE ?)))');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (studentId) { conds.push('x.studentId = ?'); params.push(studentId); }
  if (type) { conds.push('x.type = ?'); params.push(type); }
  if (way) { conds.push('x.way = ?'); params.push(way); }
  if (needFollowUp === 'true' || needFollowUp === 'false') {
    conds.push('x.needFollowUp = ?'); params.push(needFollowUp === 'true' ? 1 : 0);
  }
  if (startDate) { conds.push('substr(x.talkTime, 1, 10) >= ?'); params.push(startDate); }
  if (endDate) { conds.push('substr(x.talkTime, 1, 10) <= ?'); params.push(endDate); }

  const where = `${conds.join(' AND ')} ${scope.where}`;
  const total = dbx.get(`SELECT COUNT(*) AS c FROM conversations x WHERE ${where}`, [...params, ...scope.params]).c;
  const rows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo FROM conversations x
     JOIN students s ON s.id = x.studentId WHERE ${where} ORDER BY x.talkTime DESC LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, (page - 1) * pageSize],
  );
  res.json({
    list: rows.map((r) => ({ ...r, needFollowUp: toBool(r.needFollowUp) })),
    total, page, pageSize,
  });
});

/** 时间线：某学生全部谈话记录（最新在前，仅所带班级学生） */
router.get('/timeline', (req, res) => {
  const studentId = String(req.query.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权查看该学生的谈话记录（仅所带班级的学生）' });
  }
  const type = req.query.type;
  const rows = type
    ? dbx.all('SELECT * FROM conversations WHERE studentId = ? AND type = ? ORDER BY talkTime DESC', [studentId, type])
    : dbx.all('SELECT * FROM conversations WHERE studentId = ? ORDER BY talkTime DESC', [studentId]);
  res.json(rows.map((r) => ({ ...r, needFollowUp: toBool(r.needFollowUp) })));
});

/** 时间线学生选项：有谈话记录的学生（可见范围内，按最近谈话倒序） */
router.get('/talked-students', (req, res) => {
  const scope = sensitiveScope(req.user, 'x');
  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className, COUNT(*) AS count,
            MAX(x.talkTime) AS lastTime,
            SUM(CASE WHEN x.needFollowUp = 1 THEN 1 ELSE 0 END) AS followCount
     FROM conversations x JOIN students s ON s.id = x.studentId
     WHERE 1 = 1 ${scope.where}
     GROUP BY x.studentId ORDER BY lastTime DESC`,
    [...scope.params],
  );
  res.json(rows.map((r) => ({ ...r, needFollowUp: undefined, followCount: Number(r.followCount) })));
});

function resolveStudent(studentId) {
  return dbx.get('SELECT id, name, studentNo, className FROM students WHERE id = ?', [studentId]);
}

/** 新增：仅所带班级的学生 */
router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const studentId = String(body.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权为该学生记录谈话（仅所带班级的学生）' });
  }
  const student = resolveStudent(studentId);
  if (!student) return res.status(404).json({ message: '学生不存在' });

  const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO conversations
    (id, studentId, talkTime, way, type, needFollowUp, content, followUp, createdBy, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, studentId, body.talkTime ?? '', body.way ?? '面对面', body.type ?? '学业指导',
      body.needFollowUp ? 1 : 0, body.content ?? '', body.followUp ?? null, req.user.id, body.talkTime ?? ''],
  );
  logAccess(req, `新增谈话记录（${student.name}）`);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权修改该记录' });
  }
  const body = req.body ?? {};
  const studentId = String(body.studentId ?? target.studentId);
  if (!canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权将记录调整到该学生' });
  }
  dbx.run(`UPDATE conversations SET studentId = ?, talkTime = ?, way = ?, type = ?, needFollowUp = ?, content = ?, followUp = ? WHERE id = ?`,
    [studentId, body.talkTime ?? target.talkTime, body.way ?? target.way, body.type ?? target.type,
      body.needFollowUp ? 1 : 0, body.content ?? target.content, body.followUp ?? null, req.params.id],
  );
  logAccess(req, '修改谈话记录');
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM conversations WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权删除该记录' });
  }
  dbx.run('DELETE FROM conversations WHERE id = ?', [req.params.id]);
  logAccess(req, '删除谈话记录');
  res.json({ ok: true });
});

module.exports = router;

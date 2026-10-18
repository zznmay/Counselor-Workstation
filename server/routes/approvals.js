/** 审批中心：仅所带班级学生的申请可见可维护，支持通过/驳回 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { sensitiveScope, canManageStudent } = require('../lib/scope');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 列表：关键字 + 类型/状态筛选（待审批优先，时间倒序） */
router.get('/', (req, res) => {
  const { keyword = '', type, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const scope = sensitiveScope(req.user, 'x');
  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(x.summary LIKE ? OR EXISTS (SELECT 1 FROM students s2 WHERE s2.id = x.studentId AND (s2.name LIKE ? OR s2.studentNo LIKE ? OR s2.className LIKE ?)))');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (type) { conds.push('x.type = ?'); params.push(type); }
  if (status) { conds.push('x.status = ?'); params.push(status); }

  const where = `${conds.join(' AND ')} ${scope.where}`;
  const rows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM approvals x
     JOIN students s ON s.id = x.studentId WHERE ${where} ORDER BY x.submittedAt DESC`,
    [...params, ...scope.params],
  );
  rows.sort((a, b) => {
    const pa = a.status === '待审批' ? 0 : 1;
    const pb = b.status === '待审批' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return b.submittedAt.localeCompare(a.submittedAt);
  });

  res.json({ list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
});

function resolveStudent(studentId) {
  return dbx.get('SELECT id, name, studentNo, className FROM students WHERE id = ?', [studentId]);
}

/** 登记申请（代学生提交，仅所带班级的学生） */
router.post('/', (req, res) => {
  const body = req.body ?? {};
  const studentId = String(body.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权为该学生登记申请（仅所带班级的学生）' });
  }
  const student = resolveStudent(studentId);
  if (!student) return res.status(404).json({ message: '学生不存在' });

  const id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO approvals (id, type, studentId, summary, detail, submittedAt, status, comment, approvedAt)
    VALUES (?, ?, ?, ?, ?, ?, '待审批', NULL, NULL)`,
    [id, body.type ?? '其他', studentId, body.summary ?? '', body.detail ?? null, nowStr()],
  );
  logAccess(req, `登记申请（${student.name} · ${body.type ?? ''}）`);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM approvals WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权修改该申请' });
  }
  const body = req.body ?? {};
  dbx.run('UPDATE approvals SET type = ?, summary = ?, detail = ? WHERE id = ?',
    [body.type ?? target.type, body.summary ?? target.summary, body.detail !== undefined ? body.detail : target.detail, req.params.id],
  );
  logAccess(req, '修改申请信息');
  res.json({ ok: true });
});

/** 审批：通过 / 驳回 */
router.post('/:id/approve', (req, res) => {
  const target = dbx.get('SELECT * FROM approvals WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权审批该申请' });
  }
  if (target.status !== '待审批') return res.status(400).json({ message: '该申请已审批完成' });
  const status = req.body?.status === '已驳回' ? '已驳回' : '已通过';
  const comment = String(req.body?.comment ?? '');
  dbx.run('UPDATE approvals SET status = ?, comment = ?, approvedAt = ? WHERE id = ?',
    [status, comment, nowStr(), req.params.id],
  );
  logAccess(req, `审批${status === '已通过' ? '通过' : '驳回'}（${target.studentId} · ${target.type}）`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM approvals WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权删除该申请' });
  }
  dbx.run('DELETE FROM approvals WHERE id = ?', [req.params.id]);
  logAccess(req, '删除审批记录');
  res.json({ ok: true });
});

module.exports = router;

/** 学业与心理预警：列表/处理/增删改查（仅所带班级学生的记录可见可维护） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { sensitiveScope, canManageStudent } = require('../lib/scope');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('warnings'));

const STATUS_ORDER = { 待处理: 0, 处理中: 1, 已解除: 2 };

/** 列表：关键字 + 类型/等级/状态筛选（待处理优先，时间倒序） */
router.get('/', (req, res) => {
  const { keyword = '', type, level, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const scope = sensitiveScope(req.user, 'x');
  const conds = ['1 = 1'];
  const params = [];
  if (kw) {
    conds.push('(x.reason LIKE ? OR EXISTS (SELECT 1 FROM students s2 WHERE s2.id = x.studentId AND (s2.name LIKE ? OR s2.studentNo LIKE ? OR s2.className LIKE ?)))');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (type) { conds.push('x.type = ?'); params.push(type); }
  if (level) { conds.push('x.level = ?'); params.push(level); }
  if (status) { conds.push('x.status = ?'); params.push(status); }

  const where = `${conds.join(' AND ')} ${scope.where}`;
  const rows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM warnings x
     JOIN students s ON s.id = x.studentId WHERE ${where} ORDER BY x.raisedAt DESC`,
    [...params, ...scope.params],
  );
  rows.sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return b.raisedAt.localeCompare(a.raisedAt);
  });

  res.json({ list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
});

function resolveStudent(studentId) {
  return dbx.get('SELECT id, name, studentNo, className FROM students WHERE id = ?', [studentId]);
}

/** 新增：录入预警（仅所带班级的学生） */
router.post('/', (req, res) => {
  const body = req.body ?? {};
  const studentId = String(body.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '无权为该学生录入预警（仅所带班级的学生）' });
  }
  const student = resolveStudent(studentId);
  if (!student) return res.status(404).json({ message: '学生不存在' });

  const id = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO warnings
    (id, studentId, type, level, reason, raisedAt, status, handleNote, handledAt, createdBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, studentId, body.type ?? '学业预警', body.level ?? '黄色', body.reason ?? '',
      body.raisedAt ?? nowStr(), body.status ?? '待处理', body.handleNote ?? null, body.handledAt ?? null, req.user.id],
  );
  logAccess(req, `录入预警（${student.name} · ${body.type ?? ''}）`);
  res.json({ id });
});

/** 编辑/处理：状态流转到已解除时自动补充处理时间 */
router.put('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM warnings WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权处理该预警（仅所带班级学生的预警）' });
  }
  const body = req.body ?? {};
  const status = body.status ?? target.status;
  dbx.run(`UPDATE warnings SET type = ?, level = ?, reason = ?, raisedAt = ?, status = ?, handleNote = ?, handledAt = ? WHERE id = ?`,
    [body.type ?? target.type, body.level ?? target.level, body.reason ?? target.reason,
      body.raisedAt ?? target.raisedAt, status,
      body.handleNote !== undefined ? body.handleNote : target.handleNote,
      status === '已解除' ? (target.handledAt ?? nowStr()) : target.handledAt,
      req.params.id],
  );
  logAccess(req, `更新预警（${target.id} · ${status}）`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM warnings WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权删除该预警' });
  }
  dbx.run('DELETE FROM warnings WHERE id = ?', [req.params.id]);
  logAccess(req, '删除预警记录');
  res.json({ ok: true });
});

module.exports = router;

/** 学业与心理预警：列表/处理/增删改查（仅所带班级学生的记录可见可维护） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { sensitiveScope, canManageStudent } = require('../lib/scope');
const { requirePermission, requireAction, hasAction } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('warnings'));

/** 列表：关键字 + 类型/等级/状态筛选（待处理优先，时间倒序） */
router.get('/', (req, res) => {
  const { keyword = '', type, level, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const scope = sensitiveScope(req.user, 'warnings', 'x');
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
  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM warnings x JOIN students s ON s.id = x.studentId WHERE ${where}`,
    [...params, ...scope.params],
  ).c;
  // 排序与分页下推到 SQL：避免把全部预警捞回 Node 再排序切片
  const rows = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM warnings x
     JOIN students s ON s.id = x.studentId WHERE ${where}
     ORDER BY CASE x.status WHEN '待处理' THEN 0 WHEN '处理中' THEN 1 WHEN '已解除' THEN 2 ELSE 9 END,
              x.raisedAt DESC, x.rowid ASC
     LIMIT ? OFFSET ?`,
    [...params, ...scope.params, pageSize, (page - 1) * pageSize],
  );

  res.json({ list: rows, total, page, pageSize });
});

/**
 * 移动端名册预警角标：只返回每个学生当前最高预警级别。
 * 原实现拉取「待处理」「处理中」各 100 条完整预警再在前端归并，数据量与请求数都偏大。
 */
router.get('/active-map', (req, res) => {
  const scope = sensitiveScope(req.user, 'warnings', 'x');
  const rows = dbx.all(
    `SELECT x.studentId,
            CASE MAX(CASE x.level WHEN '红色' THEN 3 WHEN '橙色' THEN 2 WHEN '黄色' THEN 1 ELSE 0 END)
              WHEN 3 THEN '红色' WHEN 2 THEN '橙色' WHEN 1 THEN '黄色' ELSE NULL END AS level
     FROM warnings x JOIN students s ON s.id = x.studentId
     WHERE x.status != '已解除' ${scope.where}
     GROUP BY x.studentId`,
    [...scope.params],
  );
  res.json(rows.filter((r) => r.level));
});

function resolveStudent(studentId) {
  return dbx.get('SELECT id, name, studentNo, className FROM students WHERE id = ?', [studentId]);
}

/** 新增：录入预警（仅所带班级的学生） */
router.post('/', requireAction('warnings', 'create'), (req, res) => {
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
  // 同一端点承载「编辑」与「处理（状态流转）」：按是否变更状态区分操作权限
  const statusChanged = req.body?.status !== undefined && req.body.status !== target.status;
  if (!hasAction(req.user, 'warnings', statusChanged ? 'resolve' : 'edit')) {
    return res.status(403).json({ message: statusChanged ? '当前角色无权处理预警' : '当前角色无权编辑预警' });
  }
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

router.delete('/:id', requireAction('warnings', 'delete'), (req, res) => {
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

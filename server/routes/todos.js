/** 待办提醒：全员共享的协同待办 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 列表：关键字 + 类型/优先级/状态筛选（未完成按截止时间升序，已完成沉底） */
router.get('/', (req, res) => {
  const { keyword = '', type, priority, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const conds = ['1 = 1'];
  const params = [];
  if (kw) { conds.push('(title LIKE ? OR relatedStudent LIKE ? OR note LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (type) { conds.push('type = ?'); params.push(type); }
  if (priority) { conds.push('priority = ?'); params.push(priority); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const rows = dbx.all(`SELECT * FROM todos WHERE ${where}`, params);
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === '未完成' ? -1 : 1;
    const timeOf = (t) => `${t.dueDate} ${t.dueTime ?? '23:59'}`;
    if (a.status === '未完成') return timeOf(a).localeCompare(timeOf(b));
    return timeOf(b).localeCompare(timeOf(a));
  });

  res.json({ list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  if (!title) return res.status(400).json({ message: '请输入待办事项' });
  const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO todos (id, title, type, priority, dueDate, dueTime, status, relatedStudent, note, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, '未完成', ?, ?, ?)`,
    [id, title, body.type ?? '其他', body.priority ?? '中', body.dueDate ?? '', body.dueTime ?? null,
      body.relatedStudent ?? null, body.note ?? null, nowStr()],
  );
  logAccess(req, `新增待办「${title}」`);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM todos WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '待办不存在' });
  const body = req.body ?? {};
  dbx.run(`UPDATE todos SET title = ?, type = ?, priority = ?, dueDate = ?, dueTime = ?, status = ?, relatedStudent = ?, note = ? WHERE id = ?`,
    [body.title ?? target.title, body.type ?? target.type, body.priority ?? target.priority,
      body.dueDate ?? target.dueDate, body.dueTime !== undefined ? body.dueTime : target.dueTime,
      body.status ?? target.status, body.relatedStudent !== undefined ? body.relatedStudent : target.relatedStudent,
      body.note !== undefined ? body.note : target.note, req.params.id],
  );
  logAccess(req, `更新待办「${target.title}」`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM todos WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '待办不存在' });
  dbx.run('DELETE FROM todos WHERE id = ?', [req.params.id]);
  logAccess(req, `删除待办「${target.title}」`);
  res.json({ ok: true });
});

module.exports = router;

/** 通知发布：全员共享的工作协同项 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 列表：关键字 + 类型/状态筛选（置顶优先，时间倒序） */
router.get('/', (req, res) => {
  const { keyword = '', type, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  const conds = ['1 = 1'];
  const params = [];
  if (kw) { conds.push('(title LIKE ? OR content LIKE ? OR scope LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (type) { conds.push('type = ?'); params.push(type); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const total = dbx.get(`SELECT COUNT(*) AS c FROM notices WHERE ${where}`, params).c;
  // 置顶优先 + 发布时间倒序；排序与分页下推到 SQL
  const rows = dbx.all(
    `SELECT * FROM notices WHERE ${where}
     ORDER BY pinned DESC, COALESCE(publishAt, createdAt) DESC, rowid ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  res.json({
    list: rows.map((r) => ({ ...r, pinned: !!r.pinned })),
    total,
    page,
    pageSize,
  });
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  if (!title) return res.status(400).json({ message: '请输入通知标题' });
  const id = `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO notices (id, title, type, scope, content, status, pinned, publishAt, createdAt, author)
    VALUES (?, ?, ?, ?, ?, '草稿', ?, NULL, ?, ?)`,
    [id, title, body.type ?? '事务通知', body.scope ?? '全部学生', body.content ?? '', body.pinned ? 1 : 0, nowStr(), req.user.displayName],
  );
  logAccess(req, `新建通知「${title}」（草稿）`);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '通知不存在' });
  const body = req.body ?? {};
  dbx.run('UPDATE notices SET title = ?, type = ?, scope = ?, content = ?, pinned = ? WHERE id = ?',
    [body.title ?? target.title, body.type ?? target.type, body.scope ?? target.scope,
      body.content ?? target.content, body.pinned !== undefined ? (body.pinned ? 1 : 0) : target.pinned,
      req.params.id],
  );
  logAccess(req, `编辑通知「${target.title}」`);
  res.json({ ok: true });
});

router.post('/:id/publish', (req, res) => {
  const target = dbx.get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '通知不存在' });
  dbx.run("UPDATE notices SET status = '已发布', publishAt = ? WHERE id = ?", [nowStr(), req.params.id]);
  logAccess(req, `发布通知「${target.title}」`);
  res.json({ ok: true });
});

router.post('/:id/withdraw', (req, res) => {
  const target = dbx.get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '通知不存在' });
  dbx.run("UPDATE notices SET status = '已撤回' WHERE id = ?", [req.params.id]);
  logAccess(req, `撤回通知「${target.title}」`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM notices WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '通知不存在' });
  dbx.run('DELETE FROM notices WHERE id = ?', [req.params.id]);
  logAccess(req, `删除通知「${target.title}」`);
  res.json({ ok: true });
});

module.exports = router;

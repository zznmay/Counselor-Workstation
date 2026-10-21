/** 申请表模板汇总库：类别/文件管理（文件落盘 uploads/，全员可下载） */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { UPLOAD_DIR } = require('../lib/config');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('templates'));

const ALLOWED_EXT = ['doc', 'docx', 'xls', 'xlsx', 'pdf'];
const MAX_SIZE = 10 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error('仅支持 doc/docx/xls/xlsx/pdf 格式'));
    cb(null, true);
  },
});

const toClient = (row) => ({ ...row, uploaded: !!row.uploaded, pinned: undefined });

/* ---------- 类别 ---------- */

router.get('/categories', (req, res) => {
  const rows = dbx.all('SELECT * FROM templateCategories ORDER BY id');
  // 一次 GROUP BY 取代按类别逐条 COUNT 的 N+1 查询
  const counts = new Map(
    dbx.all('SELECT categoryId, COUNT(*) AS c FROM templateFiles GROUP BY categoryId')
      .map((r) => [r.categoryId, r.c]),
  );
  res.json(rows.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })));
});

router.post('/categories', auth.adminOnly, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 20) return res.status(400).json({ message: '类别名称需为 1-20 个字' });
  if (dbx.get('SELECT id FROM templateCategories WHERE name = ?', [name])) {
    return res.status(400).json({ message: `类别「${name}」已存在` });
  }
  const id = `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  dbx.run('INSERT INTO templateCategories (id, name) VALUES (?, ?)', [id, name]);
  logAccess(req, `新增模板类别「${name}」`);
  res.json({ id });
});

router.put('/categories/:id', auth.adminOnly, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 20) return res.status(400).json({ message: '类别名称需为 1-20 个字' });
  const target = dbx.get('SELECT * FROM templateCategories WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '类别不存在' });
  if (dbx.get('SELECT id FROM templateCategories WHERE name = ? AND id != ?', [name, req.params.id])) {
    return res.status(400).json({ message: `类别「${name}」已存在` });
  }
  dbx.run('UPDATE templateCategories SET name = ? WHERE id = ?', [name, req.params.id]);
  logAccess(req, `重命名模板类别「${target.name}」→「${name}」`);
  res.json({ ok: true });
});

router.delete('/categories/:id', auth.adminOnly, (req, res) => {
  const target = dbx.get('SELECT * FROM templateCategories WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '类别不存在' });
  const count = dbx.get('SELECT COUNT(*) AS c FROM templateFiles WHERE categoryId = ?', [req.params.id]).c;
  if (count > 0) return res.status(400).json({ message: `该类别下仍有 ${count} 个模板，请先删除或移动模板后再删除类别` });
  dbx.run('DELETE FROM templateCategories WHERE id = ?', [req.params.id]);
  logAccess(req, `删除模板类别「${target.name}」`);
  res.json({ ok: true });
});

/* ---------- 模板文件 ---------- */

router.get('/', (req, res) => {
  const { categoryId, keyword = '' } = req.query;
  const kw = String(keyword).trim();
  const conds = ['1 = 1'];
  const params = [];
  if (categoryId) { conds.push('categoryId = ?'); params.push(categoryId); }
  if (kw) { conds.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`); }
  const rows = dbx.all(`SELECT * FROM templateFiles WHERE ${conds.join(' AND ')}`, params);
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(rows.map(toClient));
});

router.get('/name-taken', (req, res) => {
  const name = String(req.query.name ?? '').trim();
  const exclude = req.query.exclude ? String(req.query.exclude) : null;
  const taken = exclude
    ? !!dbx.get('SELECT id FROM templateFiles WHERE name = ? AND id != ?', [name, exclude])
    : !!dbx.get('SELECT id FROM templateFiles WHERE name = ?', [name]);
  res.json({ taken });
});

router.get('/:id', (req, res) => {
  const row = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: '模板不存在' });
  res.json(toClient(row));
});

/** 上传：类型/大小校验 + 重名校验，文件落盘 uploads/ */
router.post('/', upload.single('file'), (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const categoryId = String(req.body?.categoryId ?? '');
  if (!name) return res.status(400).json({ message: '请输入模板名称' });
  if (!categoryId || !dbx.get('SELECT id FROM templateCategories WHERE id = ?', [categoryId])) {
    return res.status(400).json({ message: '所属类别无效' });
  }
  if (dbx.get('SELECT id FROM templateFiles WHERE name = ?', [name])) {
    return res.status(400).json({ message: `已存在同名模板「${name}」，请修改名称` });
  }
  if (!req.file) return res.status(400).json({ message: '请选择模板文件' });

  const format = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const id = `tf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO templateFiles
    (id, name, categoryId, format, size, description, uploader, updatedAt, uploaded, storedName)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, name, categoryId, format, req.file.size, req.body?.description?.trim() || null,
      req.user.displayName, nowStr(), req.file.filename],
  );
  logAccess(req, `上传模板「${name}」`);
  const row = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [id]);
  res.json(toClient(row));
});

router.put('/:id/rename', (req, res) => {
  const target = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '模板不存在' });
  if (req.user.role !== 'admin' && target.uploader !== req.user.displayName) {
    return res.status(403).json({ message: '仅管理员或上传者可操作' });
  }
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ message: '请输入模板名称' });
  if (dbx.get('SELECT id FROM templateFiles WHERE name = ? AND id != ?', [name, req.params.id])) {
    return res.status(400).json({ message: `已存在同名模板「${name}」，请修改名称` });
  }
  dbx.run('UPDATE templateFiles SET name = ?, updatedAt = ? WHERE id = ?', [name, nowStr(), req.params.id]);
  logAccess(req, `重命名模板「${target.name}」→「${name}」`);
  res.json({ ok: true });
});

router.put('/:id/description', (req, res) => {
  const target = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '模板不存在' });
  if (req.user.role !== 'admin' && target.uploader !== req.user.displayName) {
    return res.status(403).json({ message: '仅管理员或上传者可操作' });
  }
  dbx.run('UPDATE templateFiles SET description = ?, updatedAt = ? WHERE id = ?',
    [String(req.body?.description ?? '').trim() || null, nowStr(), req.params.id],
  );
  logAccess(req, `编辑模板说明「${target.name}」`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ message: '模板不存在' });
  if (req.user.role !== 'admin' && target.uploader !== req.user.displayName) {
    return res.status(403).json({ message: '仅管理员或上传者可操作' });
  }
  if (target.storedName) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, target.storedName)); } catch { /* 文件已不存在则忽略 */ }
  }
  dbx.run('DELETE FROM templateFiles WHERE id = ?', [req.params.id]);
  logAccess(req, `删除模板「${target.name}」`);
  res.json({ ok: true });
});

/** 下载：鉴权后回放上传的原文件 */
router.get('/:id/download', (req, res) => {
  const row = dbx.get('SELECT * FROM templateFiles WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ message: '模板不存在' });
  if (!row.uploaded || !row.storedName) {
    return res.status(404).json({ message: '该模板无原始文件' });
  }
  const filePath = path.join(UPLOAD_DIR, row.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: '模板文件缺失' });
  res.download(filePath, `${row.name}.${row.format}`);
});

module.exports = router;

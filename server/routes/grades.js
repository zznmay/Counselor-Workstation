/** 年级管理：列表/选项全员可取，写操作仅管理员 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 年级精简列表（学生表单/筛选下拉用，所有登录用户可取） */
router.get('/options', (req, res) => {
  res.json(dbx.all('SELECT id, name FROM grades ORDER BY name DESC'));
});

/* 年级维护属「班级管理」模块能力 */
router.use(requirePermission('classes'));

const LIST_SELECT = `
  SELECT g.id, g.name, g.createdAt,
    (SELECT COUNT(*) FROM classes c WHERE c.gradeId = g.id) AS classCount
  FROM grades g`;

/** 年级列表（含班级数；量小不分页） */
router.get('/', (req, res) => {
  res.json(dbx.all(`${LIST_SELECT} ORDER BY g.name DESC`));
});

router.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 20) return res.status(400).json({ message: '年级名称需为 1-20 个字' });
  if (dbx.get('SELECT id FROM grades WHERE name = ?', [name])) {
    return res.status(400).json({ message: `年级「${name}」已存在` });
  }

  const info = dbx.run('INSERT INTO grades (name, createdAt) VALUES (?, ?)', [name, nowStr()]);
  logAccess(req, `新增年级 ${name}`);
  const row = dbx.get(`${LIST_SELECT} WHERE g.id = ?`, [info.lastInsertRowid]);
  res.json(row);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的年级' });
  const target = dbx.get('SELECT * FROM grades WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '年级不存在' });

  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 20) return res.status(400).json({ message: '年级名称需为 1-20 个字' });
  if (name !== target.name && dbx.get('SELECT id FROM grades WHERE name = ?', [name])) {
    return res.status(400).json({ message: `年级「${name}」已存在` });
  }

  dbx.run('UPDATE grades SET name = ? WHERE id = ?', [name, id]);
  // 重命名后同步学生表的年级文本，避免文本字段与字典漂移
  dbx.run('UPDATE students SET grade = ? WHERE classId IN (SELECT id FROM classes WHERE gradeId = ?)', [name, id]);

  logAccess(req, `修改年级 ${target.name} → ${name}`);
  const row = dbx.get(`${LIST_SELECT} WHERE g.id = ?`, [id]);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的年级' });
  const target = dbx.get('SELECT * FROM grades WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ message: '年级不存在' });

  const classCount = dbx.get('SELECT COUNT(*) AS c FROM classes WHERE gradeId = ?', [id]).c;
  if (classCount > 0) {
    return res.status(400).json({ message: `该年级下仍有 ${classCount} 个班级，请先删除或迁移班级` });
  }
  dbx.run('DELETE FROM grades WHERE id = ?', [id]);
  logAccess(req, `删除年级 ${target.name}`);
  res.json({ ok: true });
});

module.exports = router;

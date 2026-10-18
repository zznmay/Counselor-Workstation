/** 班级管理：列表/选项全员可取，写操作与批量导入仅管理员；班级归属年级（gradeId） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

const LIST_SELECT = `
  SELECT c.id, c.gradeId, c.name, c.createdAt, g.name AS gradeName,
    (SELECT COUNT(*) FROM students s WHERE s.classId = c.id) AS studentCount,
    (SELECT COUNT(*) FROM classCounselors cc WHERE cc.classId = c.id) AS counselorCount,
    (SELECT GROUP_CONCAT(u.displayName, '、') FROM classCounselors cc
      JOIN users u ON u.id = cc.userId WHERE cc.classId = c.id) AS counselorNames
  FROM classes c JOIN grades g ON g.id = c.gradeId`;

const byId = (id) => dbx.get(`${LIST_SELECT} WHERE c.id = ?`, [id]);

/** 班级精简列表（学生表单级联下拉等用，所有登录用户可取；?gradeId= 可选过滤） */
router.get('/options', (req, res) => {
  const gradeId = Number(req.query.gradeId);
  const hasGrade = Number.isInteger(gradeId) && gradeId > 0;
  const rows = dbx.all(
    `SELECT c.id, c.name, c.gradeId, g.name AS gradeName
     FROM classes c JOIN grades g ON g.id = c.gradeId ${hasGrade ? 'WHERE c.gradeId = ?' : ''}
     ORDER BY g.name DESC, c.name`,
    hasGrade ? [gradeId] : [],
  );
  res.json(rows);
});

/* 班级维护属「班级管理」模块能力（/options 为跨模块参考数据，不受限） */
router.use(requirePermission('classes'));

/** 班级列表：关键字 + 年级筛选 + 分页 */
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(req.query.keyword ?? '').trim();
  const gradeId = Number(req.query.gradeId);
  const hasGrade = Number.isInteger(gradeId) && gradeId > 0;

  const conds = ['1 = 1'];
  const params = [];
  if (kw) { conds.push('c.name LIKE ?'); params.push(`%${kw}%`); }
  if (hasGrade) { conds.push('c.gradeId = ?'); params.push(gradeId); }
  const where = conds.join(' AND ');

  const total = dbx.get(`SELECT COUNT(*) AS c FROM classes c WHERE ${where}`, params).c;
  const rows = dbx.all(
    `${LIST_SELECT} WHERE ${where} ORDER BY g.name DESC, c.name LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows, total, page, pageSize });
});

router.post('/', (req, res) => {
  const gradeId = Number(req.body?.gradeId);
  const name = String(req.body?.name ?? '').trim();
  if (!Number.isInteger(gradeId) || gradeId <= 0) return res.status(400).json({ message: '请选择所属年级' });
  if (!name || name.length > 30) return res.status(400).json({ message: '班级名称需为 1-30 个字' });
  if (!dbx.get('SELECT id FROM grades WHERE id = ?', [gradeId])) {
    return res.status(400).json({ message: '所选年级不存在' });
  }
  if (dbx.get('SELECT id FROM classes WHERE gradeId = ? AND name = ?', [gradeId, name])) {
    return res.status(400).json({ message: `该年级下已存在同名班级「${name}」` });
  }

  const info = dbx.run('INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)', [gradeId, name, nowStr()]);
  logAccess(req, `新增班级 ${name}`);
  res.json(byId(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的班级' });
  const target = byId(id);
  if (!target) return res.status(404).json({ message: '班级不存在' });

  const body = req.body ?? {};
  const gradeId = body.gradeId !== undefined ? Number(body.gradeId) : target.gradeId;
  const name = body.name !== undefined ? String(body.name).trim() : target.name;
  if (!Number.isInteger(gradeId) || gradeId <= 0) return res.status(400).json({ message: '请选择所属年级' });
  if (!name || name.length > 30) return res.status(400).json({ message: '班级名称需为 1-30 个字' });

  if (gradeId !== target.gradeId) {
    if (!dbx.get('SELECT id FROM grades WHERE id = ?', [gradeId])) {
      return res.status(400).json({ message: '所选年级不存在' });
    }
    const studentCount = dbx.get('SELECT COUNT(*) AS c FROM students WHERE classId = ?', [id]).c;
    if (studentCount > 0) {
      return res.status(400).json({ message: `该班级下已有 ${studentCount} 名学生，不允许更改所属年级` });
    }
  }
  if ((gradeId !== target.gradeId || name !== target.name)
    && dbx.get('SELECT id FROM classes WHERE gradeId = ? AND name = ? AND id <> ?', [gradeId, name, id])) {
    return res.status(400).json({ message: `该年级下已存在同名班级「${name}」` });
  }

  dbx.run('UPDATE classes SET gradeId = ?, name = ? WHERE id = ?', [gradeId, name, id]);
  // 重命名后同步学生表的班级文本，避免文本字段与字典漂移
  if (name !== target.name) {
    dbx.run('UPDATE students SET className = ? WHERE classId = ?', [name, id]);
  }

  logAccess(req, `修改班级 ${target.name} → ${name}`);
  res.json(byId(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的班级' });
  const target = byId(id);
  if (!target) return res.status(404).json({ message: '班级不存在' });

  const studentCount = dbx.get('SELECT COUNT(*) AS c FROM students WHERE classId = ?', [id]).c;
  if (studentCount > 0) {
    return res.status(400).json({ message: `该班级下仍有 ${studentCount} 名学生，请先转移学生后再删除` });
  }
  dbx.run('DELETE FROM classCounselors WHERE classId = ?', [id]);
  dbx.run('DELETE FROM classes WHERE id = ?', [id]);
  logAccess(req, `删除班级 ${target.name}`);
  res.json({ ok: true });
});

/** 批量导入班级（前端已完成预检，服务端逐条兜底校验；事务写入保证单次请求原子性） */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const failures = [];
  const pending = []; // 校验通过的待写入项

  // 事务外先完成全部校验（读操作），事务内只做写入
  const fileSeen = new Map(); // grade|name → 本批首次出现的行号
  for (const { row, data } of rows) {
    const reasons = [];
    const name = String(data?.name ?? '').trim();
    const grade = String(data?.grade ?? '').trim();
    const counselorsRaw = String(data?.counselors ?? '').trim();

    if (!name) reasons.push('班级名称为必填项');
    else if (name.length > 30) reasons.push('班级名称不可超过 30 个字');
    if (!grade) reasons.push('年级为必填项');

    let gradeId = null;
    if (grade) {
      const g = dbx.get('SELECT id FROM grades WHERE name = ?', [grade]);
      if (!g) reasons.push(`年级未匹配到年级字典（${grade}），请先在「年级管理」中创建`);
      else gradeId = g.id;
    }

    if (name && gradeId) {
      if (dbx.get('SELECT id FROM classes WHERE gradeId = ? AND name = ?', [gradeId, name])) {
        reasons.push('班级已存在于系统中，不可重复导入');
      } else if (fileSeen.has(`${grade}|${name}`)) {
        reasons.push(`班级与本批第 ${fileSeen.get(`${grade}|${name}`)} 行重复`);
      }
      fileSeen.set(`${grade}|${name}`, row);
    }

    // 辅导员可留空；填写时逐个按姓名匹配在职辅导员
    const counselorIds = [];
    if (counselorsRaw) {
      const names = [...new Set(counselorsRaw.split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean))];
      for (const n of names) {
        const u = dbx.get(
          "SELECT id, displayName FROM users WHERE displayName = ? AND role = 'counselor' AND disabled = 0",
          [n],
        );
        if (!u) reasons.push(`辅导员「${n}」未匹配到在职辅导员`);
        else counselorIds.push(u.id);
      }
    }

    if (reasons.length > 0) {
      failures.push({ row, name: name || '—', grade: grade || '—', reason: reasons.join('；'), data });
      continue;
    }
    pending.push({ row, gradeId, name, counselorIds });
  }

  // 事务写入：单次请求内原子生效（中途异常全部回滚，不产生部分导入）
  if (pending.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      for (const it of pending) {
        const info = dbx.run(
          'INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)',
          [it.gradeId, it.name, nowStr()],
        );
        const classId = Number(info.lastInsertRowid);
        for (const uid of it.counselorIds) {
          dbx.run('INSERT INTO classCounselors (classId, userId) VALUES (?, ?)', [classId, uid]);
        }
      }
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[classes/import] 事务回滚：', e.message);
      return res.status(500).json({ message: '导入失败，已全部回滚，未产生任何数据变更' });
    }
  }

  logAccess(req, `批量导入班级：成功 ${pending.length} 条，失败 ${failures.length} 条`);
  res.json({ total: rows.length, successCount: pending.length, failures });
});

module.exports = router;

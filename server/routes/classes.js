/** 班级管理：列表/选项全员可取，写操作与批量导入仅管理员；班级归属年级（gradeId） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');
const { diffCounselorIds } = require('../lib/studentDiff');
const { refillStudentsByClass } = require('../lib/teacherSync');

const router = express.Router();
router.use(auth.authMiddleware);

/**
 * 班级列表聚合：classCounselors 已升级为「人-班-身份」三维，
 * 辅导员与班主任分别按 roleType 聚合，姓名按 users.id 升序（与派生回填口径一致，避免假 diff）。
 */
const LIST_SELECT = `
  SELECT c.id, c.gradeId, c.name, c.createdAt, g.name AS gradeName,
    (SELECT COUNT(*) FROM students s WHERE s.classId = c.id) AS studentCount,
    (SELECT COUNT(*) FROM classCounselors cc WHERE cc.classId = c.id AND cc.roleType = 'counselor') AS counselorCount,
    (SELECT GROUP_CONCAT(t.name, '、') FROM (
      SELECT u.displayName AS name FROM classCounselors cc JOIN users u ON u.id = cc.userId
      WHERE cc.classId = c.id AND cc.roleType = 'counselor' ORDER BY u.id) t) AS counselorNames,
    (SELECT COUNT(*) FROM classCounselors cc WHERE cc.classId = c.id AND cc.roleType = 'headTeacher') AS headTeacherCount,
    (SELECT GROUP_CONCAT(t.name, '、') FROM (
      SELECT u.displayName AS name FROM classCounselors cc JOIN users u ON u.id = cc.userId
      WHERE cc.classId = c.id AND cc.roleType = 'headTeacher' ORDER BY u.id) t) AS headTeacherNames
  FROM classes c JOIN grades g ON g.id = c.gradeId`;

const byId = (id) => dbx.get(`${LIST_SELECT} WHERE c.id = ?`, [id]);

/** 班级精简列表（学生表单级联下拉等用，所有登录用户可取；?gradeId= 可选过滤） */
router.get('/options', (req, res) => {
  const gradeId = Number(req.query.gradeId);
  const hasGrade = Number.isInteger(gradeId) && gradeId > 0;
  const rows = dbx.all(
    `SELECT c.id, c.name, c.gradeId, g.name AS gradeName,
      (SELECT GROUP_CONCAT(t.name, '、') FROM (
        SELECT u.displayName AS name FROM classCounselors cc JOIN users u ON u.id = cc.userId
        WHERE cc.classId = c.id AND cc.roleType = 'counselor' ORDER BY u.id) t) AS counselorNames,
      (SELECT GROUP_CONCAT(t.name, '、') FROM (
        SELECT u.displayName AS name FROM classCounselors cc JOIN users u ON u.id = cc.userId
        WHERE cc.classId = c.id AND cc.roleType = 'headTeacher' ORDER BY u.id) t) AS headTeacherNames
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

/**
 * 按姓名匹配在职教师（身份由 roleKey 指定：counselor / headTeacher）。
 * 教师档案的唯一来源是「班级管理 → 教师名单」，这里只做引用，不创建账号。
 */
function findStaffByName(name, roleKey) {
  return dbx.get(
    `SELECT u.id, u.displayName FROM users u
     WHERE u.displayName = ? AND u.disabled = 0
       AND (u.role = ? OR EXISTS (SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey = ?))`,
    [name, roleKey, roleKey],
  );
}

/**
 * 批量导入班级（upsert 语义）：以「年级+班级名称」为唯一标识——
 * - 不存在 → 新建班级并分配辅导员 / 班主任；
 * - 已存在 → 按身份分别比对人员集合，仅增删有变化部分，完全相同跳过；
 * - 同一批文件内重复 → 判失败（两行数据可能不同，避免互相覆盖）。
 * 与教师导入（人视角、增量）不同，本通道以班级为准，采用**覆盖**语义：
 * 文件中该班的辅导员/班主任集合即最终结果。
 * 前端已完成预检，服务端逐条兜底校验；事务写入保证单次请求原子性。
 */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const failures = [];
  const pending = []; // 校验通过的待写入项
  let skippedCount = 0;

  // 事务外先完成全部校验（读操作），事务内只做写入
  const fileSeen = new Map(); // grade|name → 本批首次出现的行号
  for (const { row, data } of rows) {
    const reasons = [];
    const name = String(data?.name ?? '').trim();
    const grade = String(data?.grade ?? '').trim();
    const counselorsRaw = String(data?.counselors ?? '').trim();
    /* 班主任列（选填）：与辅导员同规则按姓名匹配在职班主任 */
    const headTeachersRaw = String(data?.headTeachers ?? '').trim();

    if (!name) reasons.push('班级名称为必填项');
    else if (name.length > 30) reasons.push('班级名称不可超过 30 个字');
    if (!grade) reasons.push('年级为必填项');

    let gradeId = null;
    if (grade) {
      const g = dbx.get('SELECT id FROM grades WHERE name = ?', [grade]);
      if (!g) reasons.push(`年级未匹配到年级字典（${grade}），请先在「年级管理」中创建`);
      else gradeId = g.id;
    }

    let existingClassId = null;
    if (name && gradeId) {
      if (fileSeen.has(`${grade}|${name}`)) {
        reasons.push(`班级与本批第 ${fileSeen.get(`${grade}|${name}`)} 行重复`);
      }
      fileSeen.set(`${grade}|${name}`, row);
      const existingClass = dbx.get('SELECT id FROM classes WHERE gradeId = ? AND name = ?', [gradeId, name]);
      if (existingClass) existingClassId = existingClass.id;
    }

    // 辅导员 / 班主任可留空；填写时逐个按姓名匹配在职教师（未匹配判失败，避免留下空引用）
    const counselorIds = [];
    if (counselorsRaw) {
      const names = [...new Set(counselorsRaw.split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean))];
      for (const n of names) {
        const u = findStaffByName(n, 'counselor');
        if (!u) reasons.push(`辅导员「${n}」未匹配到在职辅导员，请先在「教师名单」导入`);
        else counselorIds.push(u.id);
      }
    }
    const headTeacherIds = [];
    if (headTeachersRaw) {
      const names = [...new Set(headTeachersRaw.split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean))];
      for (const n of names) {
        const u = findStaffByName(n, 'headTeacher');
        if (!u) reasons.push(`班主任「${n}」未匹配到在职班主任，请先在「教师名单」导入`);
        else headTeacherIds.push(u.id);
      }
    }

    if (reasons.length > 0) {
      failures.push({ row, name: name || '—', grade: grade || '—', reason: reasons.join('；'), data });
      continue;
    }

    if (existingClassId) {
      // 班级已存在：按身份分别比对人员集合，均无变化跳过，有变化仅增删差集（覆盖语义）
      const existingCounselorIds = dbx.all(
        "SELECT userId FROM classCounselors WHERE classId = ? AND roleType = 'counselor'", [existingClassId],
      ).map((r) => r.userId);
      const existingHeadIds = dbx.all(
        "SELECT userId FROM classCounselors WHERE classId = ? AND roleType = 'headTeacher'", [existingClassId],
      ).map((r) => r.userId);
      const cDiff = diffCounselorIds(existingCounselorIds, counselorIds);
      const hDiff = diffCounselorIds(existingHeadIds, headTeacherIds);
      if (cDiff.toAdd.length === 0 && cDiff.toRemove.length === 0
        && hDiff.toAdd.length === 0 && hDiff.toRemove.length === 0) {
        skippedCount += 1; // 与系统记录完全一致，跳过不导入
        continue;
      }
      pending.push({
        row,
        mode: 'update',
        classId: existingClassId,
        name,
        counselor: cDiff,
        headTeacher: hDiff,
      });
    } else {
      pending.push({ row, mode: 'insert', gradeId, name, counselorIds, headTeacherIds });
    }
  }

  // 事务写入：单次请求内原子生效（中途异常全部回滚，不产生部分导入）
  let insertedCount = 0;
  let updatedCount = 0;
  if (pending.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      const touchedClassIds = new Set();
      for (const it of pending) {
        if (it.mode === 'insert') {
          const info = dbx.run(
            'INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)',
            [it.gradeId, it.name, nowStr()],
          );
          const classId = Number(info.lastInsertRowid);
          for (const uid of it.counselorIds) {
            dbx.run(
              "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'counselor', ?)",
              [classId, uid, nowStr()],
            );
          }
          for (const uid of it.headTeacherIds ?? []) {
            dbx.run(
              "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'headTeacher', ?)",
              [classId, uid, nowStr()],
            );
          }
          touchedClassIds.add(classId);
          insertedCount += 1;
        } else {
          for (const uid of it.counselor.toAdd) {
            dbx.run(
              "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'counselor', ?)",
              [it.classId, uid, nowStr()],
            );
          }
          for (const uid of it.counselor.toRemove) {
            dbx.run(
              "DELETE FROM classCounselors WHERE classId = ? AND userId = ? AND roleType = 'counselor'",
              [it.classId, uid],
            );
          }
          for (const uid of it.headTeacher.toAdd) {
            dbx.run(
              "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'headTeacher', ?)",
              [it.classId, uid, nowStr()],
            );
          }
          for (const uid of it.headTeacher.toRemove) {
            dbx.run(
              "DELETE FROM classCounselors WHERE classId = ? AND userId = ? AND roleType = 'headTeacher'",
              [it.classId, uid],
            );
          }
          touchedClassIds.add(it.classId);
          updatedCount += 1;
        }
      }
      // 班级人员变动 → 同步回填学生名册的派生责任人（同事务，保持一致状态）
      refillStudentsByClass([...touchedClassIds]);
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[classes/import] 事务回滚：', e.message);
      return res.status(500).json({ message: '导入失败，已全部回滚，未产生任何数据变更' });
    }
  }

  logAccess(req, `批量导入班级：新增 ${insertedCount}、更新 ${updatedCount}、跳过 ${skippedCount}，失败 ${failures.length} 条`);
  res.json({
    total: rows.length,
    successCount: insertedCount + updatedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    failures,
  });
});

module.exports = router;

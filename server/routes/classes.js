/** 班级管理：列表/选项全员可取，写操作与批量导入需「班级管理」权限。
 *  人员（辅导员/班主任）按工号（= users.username）匹配在职账号：
 *  命中 → classCounselors 正式绑定（授班即生效）；
 *  未命中 → classPendingStaff 待同步（不授任何权限），
 *  由「同步用户管理」（POST /pending-staff/sync）一键建号并落地绑定。 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');
const { diffCounselorIds } = require('../lib/studentDiff');
const { refillStudentsByClass } = require('../lib/teacherSync');

const router = express.Router();
router.use(auth.authMiddleware);

/** 工号/登录名格式：3-20 位字母、数字、下划线（与用户管理建号规则一致） */
const EMPLOYEE_NO_RE = /^[a-zA-Z0-9_]{3,20}$/;
/** 同步建号初始密码前缀：Hzpt@ + 工号（首登强制修改） */
const IMPORT_PASSWORD_PREFIX = 'Hzpt@';
/** 多值分隔符（Excel 单元格 / 表单 tags / lookup keywords 共用） */
const SPLIT_RE = /[、,，/;；]/;

const ROLE_TYPE_COUNSELOR = 'counselor';
const ROLE_TYPE_HEAD_TEACHER = 'headTeacher';

/**
 * 班级列表聚合：classCounselors 为「人-班-身份」三维，辅导员与班主任分别按 roleType 聚合，
 * 正式绑定姓名按 users.id 升序（与派生回填口径一致，避免假 diff）；
 * 待同步人员姓名按 employeeNo 升序，单独输出 pending* 字段（前端渲染「（待同步）」标记）。
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
      WHERE cc.classId = c.id AND cc.roleType = 'headTeacher' ORDER BY u.id) t) AS headTeacherNames,
    (SELECT GROUP_CONCAT(t.name, '、') FROM (
      SELECT p.displayName || '（待同步）' AS name FROM classPendingStaff p
      WHERE p.classId = c.id AND p.roleType = 'counselor' ORDER BY p.employeeNo) t) AS pendingCounselorNames,
    (SELECT GROUP_CONCAT(t.name, '、') FROM (
      SELECT p.displayName || '（待同步）' AS name FROM classPendingStaff p
      WHERE p.classId = c.id AND p.roleType = 'headTeacher' ORDER BY p.employeeNo) t) AS pendingHeadTeacherNames,
    (SELECT COUNT(*) FROM classPendingStaff p WHERE p.classId = c.id) AS pendingStaffCount
  FROM classes c JOIN grades g ON g.id = c.gradeId`;

const byId = (id) => dbx.get(`${LIST_SELECT} WHERE c.id = ?`, [id]);

/* ---------- 人员（工号）解析 / 匹配 / 落库（供单独表单与批量导入复用） ---------- */

/**
 * 按工号匹配**在职**非管理员账号：工号 = users.username。
 * 管理员账号不参与班级人员匹配（避免把班级绑到管理员上）。
 */
function findUserByEmployeeNo(no) {
  return dbx.get(
    `SELECT u.id, u.username, u.displayName FROM users u
     WHERE u.username = ? AND u.disabled = 0 AND u.role <> 'admin'
       AND NOT EXISTS (SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey = 'admin')`,
    [no],
  );
}

/**
 * 解析 Excel 单元格中的工号列 + 姓名列：按分隔符拆分、顺序一一配对、工号去重（重复工号必须同姓名）。
 * @returns {{ entries: Array<{employeeNo, displayName}> } | { error: string }}
 */
function parseStaffCell(rawNos, rawNames, roleLabel) {
  const nos = String(rawNos ?? '').split(SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  const names = String(rawNames ?? '').split(SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  if (nos.length !== names.length) {
    return { error: `${roleLabel}工号与姓名数量不一致（${nos.length} 个工号 / ${names.length} 个姓名），请按顺序一一对应` };
  }
  const seen = new Set();
  const entries = [];
  for (let i = 0; i < nos.length; i += 1) {
    const employeeNo = nos[i];
    const displayName = names[i];
    if (!EMPLOYEE_NO_RE.test(employeeNo)) {
      return { error: `${roleLabel}工号「${employeeNo}」格式不合法，需为 3-20 位字母/数字/下划线` };
    }
    if (seen.has(employeeNo)) {
      const first = entries.find((e) => e.employeeNo === employeeNo);
      if (first.displayName !== displayName) {
        return { error: `${roleLabel}工号「${employeeNo}」对应了两个不同姓名（${first.displayName} / ${displayName}）` };
      }
      continue; // 同工号同姓名的重复项去重
    }
    seen.add(employeeNo);
    entries.push({ employeeNo, displayName });
  }
  return { entries };
}

/** 解析表单提交的结构化人员数组 [{employeeNo, displayName}]（校验规则与 parseStaffCell 一致） */
function parseStaffEntries(list, roleLabel) {
  if (!Array.isArray(list)) return { error: `${roleLabel}人员数据格式不正确` };
  const seen = new Set();
  const entries = [];
  for (const it of list) {
    const employeeNo = String(it?.employeeNo ?? '').trim();
    const displayName = String(it?.displayName ?? '').trim();
    if (!EMPLOYEE_NO_RE.test(employeeNo)) {
      return { error: `${roleLabel}工号「${employeeNo || '空'}」格式不合法，需为 3-20 位字母/数字/下划线` };
    }
    if (!displayName) return { error: `${roleLabel}工号「${employeeNo}」缺少对应姓名` };
    if (seen.has(employeeNo)) continue;
    seen.add(employeeNo);
    entries.push({ employeeNo, displayName });
  }
  return { entries };
}

/** 逐工号匹配在职账号（userCache 跨行缓存，同一工号只查一次库） */
function resolveStaffEntries(entries, userCache) {
  const matchedIds = [];
  const pendingEntries = [];
  for (const e of entries) {
    let u = userCache?.get(e.employeeNo);
    if (u === undefined) {
      u = findUserByEmployeeNo(e.employeeNo) ?? null;
      userCache?.set(e.employeeNo, u);
    }
    if (u) matchedIds.push(u.id);
    else pendingEntries.push(e);
  }
  return { matchedIds, pendingEntries };
}

/** 比对某班某身份的人员状态是否与库内完全一致（正式绑定集合 + 待同步集合），用于导入 skipped 判定 */
function staffStateEquals(classId, roleType, matchedIds, pendingEntries) {
  const existingIds = dbx.all(
    'SELECT userId FROM classCounselors WHERE classId = ? AND roleType = ? ORDER BY userId',
    [classId, roleType],
  ).map((r) => Number(r.userId));
  const newIds = [...matchedIds].map(Number).sort((a, b) => a - b);
  if (JSON.stringify(existingIds) !== JSON.stringify(newIds)) return false;
  const existingPending = dbx.all(
    'SELECT employeeNo, displayName FROM classPendingStaff WHERE classId = ? AND roleType = ? ORDER BY employeeNo',
    [classId, roleType],
  ).map((r) => [r.employeeNo, r.displayName]);
  const newPending = pendingEntries
    .map((pe) => [pe.employeeNo, pe.displayName])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(existingPending) === JSON.stringify(newPending);
}

/**
 * 事务内落库某班某身份的人员（覆盖语义）：
 * ① 正式绑定按差集增删；② 待同步整体替换；③ 反向清理保证「同人同班同身份」绑定与待同步不并存。
 * 必须在调用侧开启的事务内执行。
 */
function applyClassStaff(classId, roleType, resolved) {
  const existingIds = dbx.all(
    'SELECT userId FROM classCounselors WHERE classId = ? AND roleType = ? ORDER BY userId',
    [classId, roleType],
  ).map((r) => Number(r.userId));
  const matchedIds = [...resolved.matchedIds].map(Number).sort((a, b) => a - b);
  const { toAdd, toRemove } = diffCounselorIds(existingIds, matchedIds);
  for (const uid of toAdd) {
    dbx.run(
      'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
      [classId, uid, roleType, nowStr()],
    );
  }
  for (const uid of toRemove) {
    dbx.run('DELETE FROM classCounselors WHERE classId = ? AND userId = ? AND roleType = ?', [classId, uid, roleType]);
  }
  dbx.run('DELETE FROM classPendingStaff WHERE classId = ? AND roleType = ?', [classId, roleType]);
  for (const pe of resolved.pendingEntries) {
    dbx.run(
      'INSERT OR IGNORE INTO classPendingStaff (classId, employeeNo, displayName, roleType, source, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [classId, pe.employeeNo, pe.displayName, roleType, pe.source ?? 'import', nowStr()],
    );
  }
  // 不变量兜底：凡在本班本身份下记为待同步的工号，其账号不得同时保留正式绑定
  const pendingNos = resolved.pendingEntries.map((pe) => pe.employeeNo);
  if (pendingNos.length > 0) {
    dbx.run(
      `DELETE FROM classCounselors WHERE classId = ? AND roleType = ?
       AND userId IN (SELECT id FROM users WHERE username IN (${pendingNos.map(() => '?').join(', ')}))`,
      [classId, roleType, ...pendingNos],
    );
  }
  return { changed: toAdd.length > 0 || toRemove.length > 0 || resolved.pendingEntries.length > 0 };
}

/** 班级精简列表（学生表单级联下拉等用，所有登录用户可取；?gradeId= 可选过滤。
 *  注意：此处派生姓名只认 classCounselors，不掺待同步人员（学生派生口径唯一，避免口径分裂）。 */
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

/** 待同步人员清单（「同步用户管理」弹窗与角标用） */
router.get('/pending-staff', (req, res) => {
  const rows = dbx.all(
    `SELECT p.id, p.classId, p.employeeNo, p.displayName, p.roleType, p.source, p.createdAt,
            c.name AS className, g.name AS gradeName
     FROM classPendingStaff p
     JOIN classes c ON c.id = p.classId
     JOIN grades g ON g.id = c.gradeId
     ORDER BY p.employeeNo, g.name DESC, c.name`,
  );
  res.json(rows);
});

/**
 * 同步用户管理：把待同步人员落地为正式绑定。
 * 按工号分组（同工号跨班/跨身份只建一个账号、绑定多个班级）：
 * - 账号不存在 → 建号（用户名=工号、姓名=待同步姓名、角色按 roleType、初始密码 Hzpt@工号、首登强改）；
 * - 已有在职非管理员账号 → 只绑班（不建号、不改名、不授角色）；
 * - 停用/管理员账号 → 跳过并提示，待同步行保留（处理后可再次同步）。
 */
router.post('/pending-staff/sync', (req, res) => {
  const rows = dbx.all('SELECT * FROM classPendingStaff ORDER BY employeeNo, id');
  const summary = {
    total: rows.length,
    createdUsers: 0,
    linkedExisting: 0,
    skippedCount: 0,
    skipped: [],
  };
  const touchedClassIds = new Set();
  if (rows.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      const groups = new Map(); // employeeNo → { displayName, items: [{classId, roleType}] }
      for (const r of rows) {
        if (!groups.has(r.employeeNo)) groups.set(r.employeeNo, { displayName: r.displayName, items: [] });
        groups.get(r.employeeNo).items.push({ classId: Number(r.classId), roleType: r.roleType });
      }
      for (const [employeeNo, grp] of groups) {
        const user = dbx.get('SELECT * FROM users WHERE username = ?', [employeeNo]);
        if (!user) {
          const roleTypes = [...new Set(grp.items.map((i) => i.roleType))];
          const primaryRole = roleTypes.includes(ROLE_TYPE_COUNSELOR) ? ROLE_TYPE_COUNSELOR : roleTypes[0];
          const info = dbx.run(
            `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, teacherSource, createdAt)
             VALUES (?, ?, ?, ?, 1, 0, 'import', ?)`,
            [employeeNo, grp.displayName, primaryRole, auth.hashPassword(`${IMPORT_PASSWORD_PREFIX}${employeeNo}`), nowStr()],
          );
          const uid = Number(info.lastInsertRowid);
          for (const roleKey of roleTypes) {
            dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [uid, roleKey]);
          }
          for (const it of grp.items) {
            dbx.run(
              'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
              [it.classId, uid, it.roleType, nowStr()],
            );
            touchedClassIds.add(it.classId);
          }
          dbx.run('DELETE FROM classPendingStaff WHERE employeeNo = ?', [employeeNo]);
          summary.createdUsers += 1;
        } else if (
          Number(user.disabled ?? 0) === 0
          && user.role !== 'admin'
          && !dbx.get('SELECT 1 AS x FROM userRoles WHERE userId = ? AND roleKey = ?', [user.id, 'admin'])
        ) {
          for (const it of grp.items) {
            dbx.run(
              'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
              [it.classId, user.id, it.roleType, nowStr()],
            );
            touchedClassIds.add(it.classId);
          }
          dbx.run('DELETE FROM classPendingStaff WHERE employeeNo = ?', [employeeNo]);
          summary.linkedExisting += 1;
        } else {
          const reason = Number(user.disabled ?? 0) === 1 ? '账号已停用' : '管理员账号';
          summary.skipped.push({ employeeNo, displayName: grp.displayName, reason });
          summary.skippedCount += 1;
        }
      }
      const refill = refillStudentsByClass([...touchedClassIds]);
      dbx.db.exec('COMMIT');
      summary.refilledClasses = refill.classCount;
      summary.refilledStudents = refill.changedCount;
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[classes/pending-staff/sync] 事务回滚：', e.message);
      return res.status(500).json({ message: '同步失败，已全部回滚，未产生任何数据变更' });
    }
  } else {
    summary.refilledClasses = 0;
    summary.refilledStudents = 0;
  }

  logAccess(req, `同步用户管理：新建账号 ${summary.createdUsers}、绑定已有账号 ${summary.linkedExisting}、跳过 ${summary.skippedCount}`);
  res.json(summary);
});

/** 工号批量查询（导入预检/表单匹配展示用；只认在职非管理员账号） */
router.get('/users/lookup', (req, res) => {
  const keywords = String(req.query.keywords ?? '')
    .split(/[、,，/;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  res.json(keywords.map((kw) => {
    const u = findUserByEmployeeNo(kw);
    return { keyword: kw, matched: !!u, userId: u?.id ?? null, displayName: u?.displayName ?? null };
  }));
});

/** 工号候选列表（表单远程搜索用；在职非管理员账号） */
router.get('/staff-users', (req, res) => {
  const kw = String(req.query.keyword ?? '').trim();
  const like = `%${kw}%`;
  const rows = dbx.all(
    `SELECT u.username AS employeeNo, u.displayName FROM users u
     WHERE u.disabled = 0 AND u.role <> 'admin'
       AND NOT EXISTS (SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey = 'admin')
       AND (? = '' OR u.username LIKE ? OR u.displayName LIKE ?)
     ORDER BY u.username LIMIT 50`,
    [kw, like, like],
  );
  res.json(rows);
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

  // 人员字段可选（不传 = 不配置人员）；传则校验并区分 matched/pending
  const cParsed = req.body?.counselors !== undefined ? parseStaffEntries(req.body.counselors, '辅导员') : { entries: [] };
  if (cParsed.error) return res.status(400).json({ message: cParsed.error });
  const hParsed = req.body?.headTeachers !== undefined ? parseStaffEntries(req.body.headTeachers, '班主任') : { entries: [] };
  if (hParsed.error) return res.status(400).json({ message: hParsed.error });
  const userCache = new Map();
  const cResolved = resolveStaffEntries(cParsed.entries, userCache);
  const hResolved = resolveStaffEntries(hParsed.entries, userCache);

  let classId;
  dbx.db.exec('BEGIN IMMEDIATE');
  try {
    const info = dbx.run('INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)', [gradeId, name, nowStr()]);
    classId = Number(info.lastInsertRowid);
    applyClassStaff(classId, ROLE_TYPE_COUNSELOR, cResolved);
    applyClassStaff(classId, ROLE_TYPE_HEAD_TEACHER, hResolved);
    refillStudentsByClass([classId]);
    dbx.db.exec('COMMIT');
  } catch (e) {
    dbx.db.exec('ROLLBACK');
    console.error('[classes/create] 事务回滚：', e.message);
    return res.status(500).json({ message: '创建失败，已回滚' });
  }
  logAccess(req, `新增班级 ${name}`);
  res.json(byId(classId));
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

  // 人员字段语义：undefined = 不动人员（移动端表单兼容）；传数组 = 覆盖（与批量导入一致）
  const hasCounselors = body.counselors !== undefined;
  const hasHeadTeachers = body.headTeachers !== undefined;
  const cParsed = hasCounselors ? parseStaffEntries(body.counselors, '辅导员') : null;
  if (cParsed?.error) return res.status(400).json({ message: cParsed.error });
  const hParsed = hasHeadTeachers ? parseStaffEntries(body.headTeachers, '班主任') : null;
  if (hParsed?.error) return res.status(400).json({ message: hParsed.error });
  const userCache = new Map();
  const cResolved = hasCounselors ? resolveStaffEntries(cParsed.entries, userCache) : null;
  const hResolved = hasHeadTeachers ? resolveStaffEntries(hParsed.entries, userCache) : null;

  dbx.db.exec('BEGIN IMMEDIATE');
  try {
    dbx.run('UPDATE classes SET gradeId = ?, name = ? WHERE id = ?', [gradeId, name, id]);
    // 重命名后同步学生表的班级文本，避免文本字段与字典漂移
    if (name !== target.name) {
      dbx.run('UPDATE students SET className = ? WHERE classId = ?', [name, id]);
    }
    if (cResolved) applyClassStaff(id, ROLE_TYPE_COUNSELOR, cResolved);
    if (hResolved) applyClassStaff(id, ROLE_TYPE_HEAD_TEACHER, hResolved);
    if (cResolved || hResolved) refillStudentsByClass([id]);
    dbx.db.exec('COMMIT');
  } catch (e) {
    dbx.db.exec('ROLLBACK');
    console.error('[classes/update] 事务回滚：', e.message);
    return res.status(500).json({ message: '保存失败，已回滚' });
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
  dbx.run('DELETE FROM classPendingStaff WHERE classId = ?', [id]);
  dbx.run('DELETE FROM classes WHERE id = ?', [id]);
  logAccess(req, `删除班级 ${target.name}`);
  res.json({ ok: true });
});

/** 某班人员明细（编辑表单回填：正式绑定 + 待同步，pending 标志区分） */
router.get('/:id/staff', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的班级' });
  if (!dbx.get('SELECT id FROM classes WHERE id = ?', [id])) return res.status(404).json({ message: '班级不存在' });
  const rows = dbx.all(
    `SELECT cc.roleType, u.username AS employeeNo, u.displayName, 0 AS pending
     FROM classCounselors cc JOIN users u ON u.id = cc.userId
     WHERE cc.classId = ?
     UNION ALL
     SELECT roleType, employeeNo, displayName, 1 AS pending
     FROM classPendingStaff WHERE classId = ?
     ORDER BY pending, employeeNo`,
    [id, id],
  );
  res.json(rows);
});

/**
 * 批量导入班级（upsert 语义）：以「年级+班级名称」为唯一标识——
 * - 不存在 → 新建班级并配置人员；
 * - 已存在 → 按身份比对「正式绑定 + 待同步」整体状态，完全一致跳过，有变化覆盖写入；
 * - 同一批文件内重复 → 判失败（两行数据可能不同，避免互相覆盖）。
 * 人员按工号匹配在职账号：命中 → 正式绑定；未命中 → 待同步（不判失败，导入后可「同步用户管理」建号）。
 * 前端已完成预检，服务端逐条兜底校验；事务写入保证单次请求原子性。
 */
router.post('/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const failures = [];
  const writeItems = []; // 校验通过的待写入项
  let skippedCount = 0;
  let pendingCount = 0;

  // 事务外先完成全部校验（读操作），事务内只做写入
  const fileSeen = new Map(); // grade|name → 本批首次出现的行号
  const fileStaffSeen = new Map(); // employeeNo → 本批首次登记的姓名（跨行一致性）
  const userCache = new Map(); // employeeNo → user|null（跨行共享匹配结果）
  for (const { row, data } of rows) {
    const reasons = [];
    const name = String(data?.name ?? '').trim();
    const grade = String(data?.grade ?? '').trim();

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

    // 辅导员 / 班主任列：工号 + 姓名按顺序一一对应；工号未匹配不判失败 → 待同步
    const cParsed = parseStaffCell(data?.counselorNos, data?.counselorNames, '辅导员');
    if (cParsed.error) reasons.push(cParsed.error);
    const hParsed = parseStaffCell(data?.headTeacherNos, data?.headTeacherNames, '班主任');
    if (hParsed.error) reasons.push(hParsed.error);
    if (reasons.length === 0) {
      for (const roleLabel of ['辅导员', '班主任']) {
        const entries = roleLabel === '辅导员' ? cParsed.entries : hParsed.entries;
        for (const e of entries) {
          const known = fileStaffSeen.get(e.employeeNo);
          if (known && known.name !== e.displayName) {
            reasons.push(`${roleLabel}工号「${e.employeeNo}」与本批第 ${known.row} 行登记的姓名「${known.name}」不一致`);
          } else if (!known) {
            fileStaffSeen.set(e.employeeNo, { row, name: e.displayName });
          }
        }
      }
    }

    if (reasons.length > 0) {
      failures.push({ row, name: name || '—', grade: grade || '—', reason: reasons.join('；'), data });
      continue;
    }

    const cResolved = resolveStaffEntries(cParsed.entries, userCache);
    const hResolved = resolveStaffEntries(hParsed.entries, userCache);

    if (existingClassId) {
      // 班级已存在：按身份比对「绑定 + 待同步」整体状态，完全一致跳过（覆盖语义）
      if (staffStateEquals(existingClassId, ROLE_TYPE_COUNSELOR, cResolved.matchedIds, cResolved.pendingEntries)
        && staffStateEquals(existingClassId, ROLE_TYPE_HEAD_TEACHER, hResolved.matchedIds, hResolved.pendingEntries)) {
        skippedCount += 1; // 与系统记录完全一致，跳过不导入
        continue;
      }
      writeItems.push({
        row,
        mode: 'update',
        classId: existingClassId,
        name,
        counselor: cResolved,
        headTeacher: hResolved,
      });
    } else {
      writeItems.push({ row, mode: 'insert', gradeId, name, counselor: cResolved, headTeacher: hResolved });
    }
  }

  // 事务写入：单次请求内原子生效（中途异常全部回滚，不产生部分导入）
  let insertedCount = 0;
  let updatedCount = 0;
  if (writeItems.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      const touchedClassIds = new Set();
      for (const it of writeItems) {
        let classId;
        if (it.mode === 'insert') {
          const info = dbx.run(
            'INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)',
            [it.gradeId, it.name, nowStr()],
          );
          classId = Number(info.lastInsertRowid);
          insertedCount += 1;
        } else {
          classId = it.classId;
          updatedCount += 1;
        }
        applyClassStaff(classId, ROLE_TYPE_COUNSELOR, it.counselor);
        applyClassStaff(classId, ROLE_TYPE_HEAD_TEACHER, it.headTeacher);
        pendingCount += it.counselor.pendingEntries.length + it.headTeacher.pendingEntries.length;
        touchedClassIds.add(classId);
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

  logAccess(req, `批量导入班级：新增 ${insertedCount}、更新 ${updatedCount}、跳过 ${skippedCount}，待同步 ${pendingCount} 人次，失败 ${failures.length} 条`);
  res.json({
    total: rows.length,
    successCount: insertedCount + updatedCount,
    insertedCount,
    updatedCount,
    skippedCount,
    pendingCount,
    failures,
  });
});

module.exports = router;

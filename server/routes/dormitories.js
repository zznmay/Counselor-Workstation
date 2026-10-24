/**
 * 寝室管理：集中维护学生宿舍分配（学号唯一，一名学生一条记录）。
 *
 * 字段口径：学号 / 班级 / 姓名 / 年级 / 性别 取自「学生名册」（JOIN students，随名册变化实时一致），
 * 宿舍楼（building）与房间号（room）由本模块维护；名册展示的「宿舍」= 宿舍楼 + 房间号 拼接。
 *
 * 权限：查看按名册可见范围收口（rosterScope）；新增/编辑/删除/导入按带班收口（canManageStudent）。
 * 学生名册侧（students 路由）只读寝室数据，任何写入都经 lib/dormitory.js 同步 students.dorm 镜像。
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { canManageStudent, rosterScope } = require('../lib/scope');
const { requirePermission, requireAction, isModuleOwner } = require('../lib/permissions');
const {
  MAX_BUILDING,
  MAX_ROOM,
  joinDorm,
  mirrorStudentDorm,
} = require('../lib/dormitory');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

/** 列表主查询：寝室分配 JOIN 学生名册（姓名/班级/年级/性别一律以名册为准） */
const LIST_SELECT = `
  SELECT d.id, d.studentNo, d.building, d.room, d.updatedBy, d.updatedAt,
    s.id AS studentId, s.name, s.gender, s.grade, s.className, s.classId
  FROM dormitories d JOIN students s ON s.studentNo = d.studentNo`;

const byId = (id) => dbx.get(`${LIST_SELECT} WHERE d.id = ?`, [id]);

/** 单个字段的模糊匹配（LIKE %值%）；空值不参与筛选 */
function pushLike(conds, params, field, value) {
  const v = String(value ?? '').trim();
  if (!v) return;
  conds.push(`${field} LIKE ?`);
  params.push(`%${v}%`);
}

/**
 * 列表筛选口径：学号 / 姓名 / 班级 / 宿舍楼 / 房间号 五项均支持模糊查询，
 * 另提供年级精确筛选、classIds 多班级筛选（逗号分隔字典 ID）、
 * occupancy 寝室人数筛选（同宿舍楼+房间号的在住人数，1-4），
 * 以及 keyword 综合关键字（学号、姓名、房间号 任一命中）供移动端单搜索框使用。
 */
function buildFilter(query) {
  const conds = ['1 = 1'];
  const params = [];
  pushLike(conds, params, 'd.studentNo', query.studentNo);
  pushLike(conds, params, 's.name', query.name);
  pushLike(conds, params, 's.className', query.className);
  pushLike(conds, params, 'd.building', query.building);
  pushLike(conds, params, 'd.room', query.room);

  const grade = String(query.grade ?? '').trim();
  if (grade) {
    conds.push('s.grade = ?');
    params.push(grade);
  }

  const rawClassIds = Array.isArray(query.classIds) ? query.classIds.join(',') : String(query.classIds ?? '');
  const classIds = [...new Set(
    rawClassIds.split(',').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0),
  )];
  if (classIds.length > 0) {
    conds.push(`s.classId IN (${classIds.map(() => '?').join(', ')})`);
    params.push(...classIds);
  }

  const occ = Number(query.occupancy);
  if (Number.isInteger(occ) && occ >= 1 && occ <= 4) {
    // 寝室人数 = 同宿舍楼+房间号的分配条数；非法值忽略（等同全部）
    conds.push(
      '(SELECT COUNT(*) FROM dormitories d2 WHERE d2.building = d.building AND d2.room = d.room) = ?',
    );
    params.push(occ);
  }

  const kw = String(query.keyword ?? '').trim();
  if (kw) {
    conds.push('(d.studentNo LIKE ? OR s.name LIKE ? OR d.room LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  return { where: conds.join(' AND '), params };
}

/* 寝室维护属「寝室管理」模块能力 */
router.use(requirePermission('dormitories'));

/**
 * 筛选下拉选项：可见范围内已分配的宿舍楼与班级（去重排序）。
 * 选项取自数据本身，避免「下拉里有筛不出记录的楼栋」。
 */
router.get('/options', (req, res) => {
  const scope = rosterScope(req.user);
  const scopeSql = scope ? `WHERE ${scope.sql}` : '';
  const scopeParams = scope ? scope.params : [];
  const buildings = dbx.all(
    `SELECT DISTINCT d.building FROM dormitories d JOIN students s ON s.studentNo = d.studentNo ${scopeSql}
     ORDER BY d.building`,
    scopeParams,
  ).map((r) => r.building).filter((b) => String(b ?? '').trim() !== '');
  const classNames = dbx.all(
    `SELECT DISTINCT s.className FROM dormitories d JOIN students s ON s.studentNo = d.studentNo
     ${scope ? `${scopeSql} AND` : 'WHERE'} TRIM(COALESCE(s.className, '')) <> ''
     ORDER BY s.className`,
    scopeParams,
  ).map((r) => r.className);
  res.json({ buildings, classNames });
});

/** 列表：五项模糊筛选 + 分页（按宿舍楼、房间号、学号排序，便于按楼栋核对） */
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const { where, params } = buildFilter(req.query);
  const scope = rosterScope(req.user);
  const conds = [where];
  if (scope) {
    conds.push(scope.sql);
    params.push(...scope.params);
  }
  const finalWhere = conds.join(' AND ');

  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM dormitories d JOIN students s ON s.studentNo = d.studentNo WHERE ${finalWhere}`,
    params,
  ).c;
  const rows = dbx.all(
    `${LIST_SELECT} WHERE ${finalWhere} ORDER BY d.building, d.room, d.studentNo LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows, total, page, pageSize });
});

/** 详情（查看）：无权限范围限制之外的额外校验，列表可见即可查看详情 */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的寝室记录' });
  const row = byId(id);
  if (!row) return res.status(404).json({ message: '寝室记录不存在' });
  const scope = rosterScope(req.user);
  if (scope) {
    const inScope = dbx.get(
      `SELECT 1 FROM dormitories d JOIN students s ON s.studentNo = d.studentNo
       WHERE d.id = ? AND ${scope.sql}`,
      [id, ...scope.params],
    );
    if (!inScope) return res.status(403).json({ message: '仅可查看其所带班级学生的寝室信息' });
  }
  res.json({ ...row, dorm: joinDorm(row.building, row.room) });
});

/** 新增分配：学号必须存在于名册且在维护权限内；一名学生仅一条分配 */
router.post('/', requireAction('dormitories', 'create'), (req, res) => {
  const body = req.body ?? {};
  const studentNo = String(body.studentNo ?? '').trim();
  const building = String(body.building ?? '').trim();
  const room = String(body.room ?? '').trim();

  if (!studentNo) return res.status(400).json({ message: '请选择学生（学号为必填项）' });
  if (!building) return res.status(400).json({ message: '宿舍楼为必填项' });
  if (building.length > MAX_BUILDING) {
    return res.status(400).json({ message: `宿舍楼不可超过 ${MAX_BUILDING} 个字` });
  }
  if (!room) return res.status(400).json({ message: '房间号为必填项' });
  if (room.length > MAX_ROOM) {
    return res.status(400).json({ message: `房间号不可超过 ${MAX_ROOM} 个字` });
  }

  const student = dbx.get('SELECT id, name FROM students WHERE studentNo = ?', [studentNo]);
  if (!student) {
    return res.status(400).json({ message: `学号 ${studentNo} 未在学生名册中，请先在「学生名册」录入` });
  }
  if (!canManageStudent(req.user, student.id)) {
    return res.status(403).json({ message: '无权维护该学生（仅所带班级的学生或管理员可操作）' });
  }
  if (dbx.get('SELECT id FROM dormitories WHERE studentNo = ?', [studentNo])) {
    return res.status(400).json({ message: `学生 ${student.name}（${studentNo}）已分配寝室，请直接在列表中编辑` });
  }

  const info = dbx.run(
    `INSERT INTO dormitories (studentNo, building, room, updatedBy, updatedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [studentNo, building, room, req.user?.displayName ?? req.user?.username ?? '系统', nowStr(), nowStr()],
  );
  mirrorStudentDorm(studentNo);
  logAccess(req, `新增寝室分配 ${student.name}（${studentNo}）→ ${joinDorm(building, room)}`);
  res.json(byId(Number(info.lastInsertRowid)));
});

/** 编辑分配：仅调整宿舍楼/房间号（学号归属不允许改，避免与名册脱节） */
router.put('/:id', requireAction('dormitories', 'edit'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的寝室记录' });
  const target = byId(id);
  if (!target) return res.status(404).json({ message: '寝室记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权维护该学生（仅所带班级的学生或管理员可操作）' });
  }

  const body = req.body ?? {};
  const building = body.building !== undefined ? String(body.building).trim() : target.building;
  const room = body.room !== undefined ? String(body.room).trim() : target.room;
  if (!building) return res.status(400).json({ message: '宿舍楼为必填项' });
  if (building.length > MAX_BUILDING) {
    return res.status(400).json({ message: `宿舍楼不可超过 ${MAX_BUILDING} 个字` });
  }
  if (!room) return res.status(400).json({ message: '房间号为必填项' });
  if (room.length > MAX_ROOM) {
    return res.status(400).json({ message: `房间号不可超过 ${MAX_ROOM} 个字` });
  }

  dbx.run(
    'UPDATE dormitories SET building = ?, room = ?, updatedBy = ?, updatedAt = ? WHERE id = ?',
    [building, room, req.user?.displayName ?? req.user?.username ?? '系统', nowStr(), id],
  );
  mirrorStudentDorm(target.studentNo);
  logAccess(req, `修改寝室分配 ${target.name}（${target.studentNo}）：${joinDorm(target.building, target.room)} → ${joinDorm(building, room)}`);
  res.json(byId(id));
});

/** 删除分配：同步清空学生表镜像，名册「宿舍」随之显示为未分配 */
router.delete('/:id', requireAction('dormitories', 'delete'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的寝室记录' });
  const target = byId(id);
  if (!target) return res.status(404).json({ message: '寝室记录不存在' });
  if (!canManageStudent(req.user, target.studentId)) {
    return res.status(403).json({ message: '无权维护该学生（仅所带班级的学生或管理员可操作）' });
  }

  dbx.run('DELETE FROM dormitories WHERE id = ?', [id]);
  mirrorStudentDorm(target.studentNo);
  logAccess(req, `删除寝室分配 ${target.name}（${target.studentNo}）：${joinDorm(target.building, target.room)}`);
  res.json({ ok: true });
});

/**
 * 批量删除：先校验全部记录存在且在维护权限内，再在一个事务里删除并同步名册镜像。
 * 任一条不满足则整批拒绝，避免出现「删了一半」的中间状态。
 */
router.post('/batch-delete', requireAction('dormitories', 'delete'), (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(
    raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0),
  )];
  if (ids.length === 0) return res.status(400).json({ message: '请选择要删除的寝室分配' });
  if (ids.length > 500) return res.status(400).json({ message: '单次最多删除 500 条，请分批操作' });

  const marks = ids.map(() => '?').join(', ');
  const targets = dbx.all(`${LIST_SELECT} WHERE d.id IN (${marks})`, ids);
  if (targets.length !== ids.length) {
    return res.status(409).json({
      message: `所选记录中有 ${ids.length - targets.length} 条已不存在，请刷新列表后重新选择`,
    });
  }
  const denied = targets.filter((t) => !canManageStudent(req.user, t.studentId));
  if (denied.length > 0) {
    return res.status(403).json({
      message: `所选记录中有 ${denied.length} 条不在您可维护的班级范围内，未执行删除`,
    });
  }

  dbx.db.exec('BEGIN IMMEDIATE');
  try {
    for (const target of targets) {
      dbx.run('DELETE FROM dormitories WHERE id = ?', [target.id]);
      mirrorStudentDorm(target.studentNo);
    }
    dbx.db.exec('COMMIT');
  } catch (e) {
    dbx.db.exec('ROLLBACK');
    console.error('[dormitories/batch-delete] 事务回滚：', e.message);
    return res.status(500).json({ message: '批量删除失败，已全部回滚，未产生任何数据变更' });
  }

  logAccess(
    req,
    `批量删除寝室分配 ${targets.length} 条：${targets.map((t) => `${t.name}（${t.studentNo}）`).join('、')}`,
  );
  res.json({ ok: true, deletedCount: targets.length });
});

/**
 * 批量导入寝室分配（upsert 语义）：以学号为唯一标识 ——
 * - 学号在名册中不存在 → 失败（寝室数据必须挂在真实学生上）；
 * - 学号不在维护权限内 → 失败（与名册编辑口径一致）；
 * - 本批内学号重复 → 失败（两行可能不同，避免互相覆盖）；
 * - 已存在 → 逐字段比对宿舍楼/房间号，完全相同跳过，有变化仅更新变化字段；
 * - 姓名/班级/年级/性别 选填，填写时须与名册一致（不一致判失败，用于拦截学号填错）。
 * 校验在事务外完成，写入包事务保证单次请求原子性。
 */
router.post('/import', (req, res) => {
  // 批量导入为高影响写入（upsert 全量覆盖），仅「寝室管理」主负责辅导员 / 管理员可操作
  if (!isModuleOwner(req.user, 'dormitories')) {
    return res.status(403).json({ message: '批量导入仅寝室管理主负责辅导员或管理员可操作' });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const failures = [];
  const pending = []; // 校验通过的待写入项
  let skippedCount = 0;

  const fileSeen = new Map(); // studentNo → 本批首次出现的行号
  for (const { row, data } of rows) {
    const reasons = [];
    const studentNo = String(data?.studentNo ?? '').trim();
    const name = String(data?.name ?? '').trim();
    const className = String(data?.className ?? '').trim();
    const grade = String(data?.grade ?? '').trim();
    const gender = String(data?.gender ?? '').trim();
    const building = String(data?.building ?? '').trim();
    const room = String(data?.room ?? '').trim();

    if (!studentNo) reasons.push('学号为必填项');
    if (!building) reasons.push('宿舍楼为必填项');
    else if (building.length > MAX_BUILDING) reasons.push(`宿舍楼不可超过 ${MAX_BUILDING} 个字`);
    if (!room) reasons.push('房间号为必填项');
    else if (room.length > MAX_ROOM) reasons.push(`房间号不可超过 ${MAX_ROOM} 个字`);

    if (studentNo && fileSeen.has(studentNo)) {
      reasons.push(`学号与本批第 ${fileSeen.get(studentNo)} 行重复`);
    }
    if (studentNo) fileSeen.set(studentNo, row);

    const student = studentNo
      ? dbx.get('SELECT id, name, gender, grade, className FROM students WHERE studentNo = ?', [studentNo])
      : null;
    if (studentNo && !student) {
      reasons.push(`学号 ${studentNo} 未在学生名册中，请先在「学生名册」录入`);
    } else if (student) {
      if (!canManageStudent(req.user, student.id)) {
        reasons.push(`学号 ${studentNo} 不在您所带班级范围内，无权限维护`);
      }
      // 选填的身份字段与名册比对：不一致判失败，防止学号填错导致宿舍挂到别人名下
      if (name && name !== String(student.name ?? '').trim()) {
        reasons.push(`姓名与名册不一致（名册为「${student.name}」）`);
      }
      if (className && className !== String(student.className ?? '').trim()) {
        reasons.push(`班级与名册不一致（名册为「${student.className ?? '—'}」）`);
      }
      if (grade && grade !== String(student.grade ?? '').trim()) {
        reasons.push(`年级与名册不一致（名册为「${student.grade ?? '—'}」）`);
      }
      if (gender && gender !== String(student.gender ?? '').trim()) {
        reasons.push(`性别与名册不一致（名册为「${student.gender ?? '—'}」）`);
      }
    }

    if (reasons.length > 0) {
      failures.push({
        row,
        studentNo: studentNo || '—',
        name: name || '—',
        building: building || '—',
        room: room || '—',
        reason: reasons.join('；'),
        data: { studentNo, name, className, grade, gender, building, room },
      });
      continue;
    }

    const existing = dbx.get('SELECT id, building, room FROM dormitories WHERE studentNo = ?', [studentNo]);
    if (!existing) {
      pending.push({ row, mode: 'insert', studentNo, building, room });
      continue;
    }
    if (existing.building === building && existing.room === room) {
      skippedCount += 1; // 与系统记录完全一致，跳过不导入
      continue;
    }
    pending.push({ row, mode: 'update', id: existing.id, studentNo, building, room });
  }

  let insertedCount = 0;
  let updatedCount = 0;
  if (pending.length > 0) {
    dbx.db.exec('BEGIN IMMEDIATE');
    try {
      for (const it of pending) {
        if (it.mode === 'insert') {
          dbx.run(
            `INSERT INTO dormitories (studentNo, building, room, updatedBy, updatedAt, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [it.studentNo, it.building, it.room,
              req.user?.displayName ?? req.user?.username ?? '系统', nowStr(), nowStr()],
          );
          insertedCount += 1;
        } else {
          dbx.run(
            'UPDATE dormitories SET building = ?, room = ?, updatedBy = ?, updatedAt = ? WHERE id = ?',
            [it.building, it.room,
              req.user?.displayName ?? req.user?.username ?? '系统', nowStr(), it.id],
          );
          updatedCount += 1;
        }
        // 镜像回写在事务内完成，保证名册「宿舍」与寝室数据同步生效
        mirrorStudentDorm(it.studentNo);
      }
      dbx.db.exec('COMMIT');
    } catch (e) {
      dbx.db.exec('ROLLBACK');
      console.error('[dormitories/import] 事务回滚：', e.message);
      return res.status(500).json({ message: '导入失败，已全部回滚，未产生任何数据变更' });
    }
  }

  logAccess(req, `批量导入寝室分配：新增 ${insertedCount}、更新 ${updatedCount}、跳过 ${skippedCount}，失败 ${failures.length} 条`);
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

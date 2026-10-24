/**
 * 心理健康：学生关注标记、谈心谈话联动与心理访谈。
 *
 * 数据范围（「主负责辅导员」模型）：
 * - 管理员 / 心理健康主负责角色用户：全院可见可维护（1=1）
 * - 其他角色：仅 classCounselors（用户管理分配的所辖班级）内学生
 * - 关注标记写操作：严格仅主负责/管理员（带班不再是写权通道）
 * - 心理访谈写操作：额外要求 mentalInterview 权限（班主任内置角色默认具备）
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess, nowStr } = require('../lib/audit');
const { isAdmin, canManageStudent, classIdsOfUser } = require('../lib/scope');
const { requirePermission, requireAction, isModuleOwner, hasPermission, hasAction, dataScopeOfUser } = require('../lib/permissions');
const { currentSemester } = require('../lib/semester');
const {
  REQUIRED_COUNT,
  getInterviewView,
  listExportRecords,
  createInterview,
  updateInterview,
  deleteInterview,
  listPending,
  listLevelLogs,
  logLevelChange,
} = require('../lib/mentalInterview');
const tpl = require('../lib/interviewTemplate');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('mentalHealth'));

/** 关注等级（展示顺序即紧急程度从高到低；末位「无需关注」为留档档位，不安排访谈）。
 *  与模版适用等级、访谈评估选项同源（lib/interviewTemplate.js）。 */
const LEVELS = tpl.LEVELS;

/** 可见范围条件：心理健康模块（mentalHealth）数据范围为全量（管理员/主负责/角色配置）→ 1=1（全院）；
 *  其他角色 s.classId 必须命中所辖班级（别名固定为 s）。写操作口径见文件头注释。 */
function classScopeSql(user) {
  if (dataScopeOfUser(user, 'mentalHealth') === 'all') return { sql: '1 = 1', params: [] };
  return {
    sql: 's.classId IN (SELECT classId FROM classCounselors WHERE userId = ?)',
    params: [user.id],
  };
}

/** 统一错误返回：业务层抛出的 status 优先，其余按 500 */
function sendError(res, err) {
  const status = Number(err?.status) || 500;
  if (status >= 500) console.error('[mental]', err);
  res.status(status).json({ message: err?.message ?? '操作失败' });
}

/* ---------- 关注等级汇总（页首分类卡） ---------- */
router.get('/summary', (req, res) => {
  const scope = classScopeSql(req.user);
  const rows = dbx.all(
    `SELECT mh.level, COUNT(*) AS count FROM mentalHealth mh
     JOIN students s ON s.id = mh.studentId
     WHERE ${scope.sql} GROUP BY mh.level`,
    scope.params,
  );
  const byLevel = new Map(rows.map((r) => [r.level, r.count]));
  res.json(LEVELS.map((level) => ({ level, count: byLevel.get(level) ?? 0 })));
});

/* ---------- 关注学生列表：等级/关键字/班级/访谈进度筛选 + 分页 ---------- */
router.get('/concerns', (req, res) => {
  const { level, keyword = '', classId, interview } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));
  const semester = currentSemester();

  const scope = classScopeSql(req.user);
  const conds = [scope.sql];
  // 参数顺序：子查询 semesterKey → 范围 → 业务筛选；顺序错位会导致条件整体串位
  const params = [semester.key, ...scope.params];
  if (level) { conds.push('mh.level = ?'); params.push(String(level)); }
  if (classId) { conds.push('s.classId = ?'); params.push(Number(classId)); }
  const kw = String(keyword).trim();
  if (kw) {
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ? OR s.className LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  if (interview === 'pending') conds.push(`COALESCE(iv.c, 0) < ${REQUIRED_COUNT}`);
  if (interview === 'done') conds.push(`COALESCE(iv.c, 0) >= ${REQUIRED_COUNT}`);
  const where = conds.join(' AND ');

  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM mentalHealth mh
     JOIN students s ON s.id = mh.studentId
     LEFT JOIN (
       SELECT studentId, COUNT(*) AS c FROM mentalInterviews
       WHERE semesterKey = ? AND deletedAt IS NULL GROUP BY studentId
     ) iv ON iv.studentId = mh.studentId
     WHERE ${where}`,
    params,
  ).c;

  // 与谈心谈话、心理访谈打通：谈话次数 / 最近一次 / 需跟进数 / 本学期访谈次数
  const rows = dbx.all(
    `SELECT s.id AS studentId, s.name, s.studentNo, s.className, s.grade, s.major, s.status, s.classId,
            mh.level, mh.note, mh.updatedAt, mh.updatedBy,
            t.talkCount, t.lastTalkTime, t.followCount,
            COALESCE(iv.c, 0) AS interviewDone
     FROM mentalHealth mh
     JOIN students s ON s.id = mh.studentId
     LEFT JOIN (
       SELECT studentId,
              COUNT(*) AS talkCount,
              MAX(talkTime) AS lastTalkTime,
              SUM(CASE WHEN needFollowUp = 1 THEN 1 ELSE 0 END) AS followCount
       FROM conversations GROUP BY studentId
     ) t ON t.studentId = mh.studentId
     LEFT JOIN (
       SELECT studentId, COUNT(*) AS c FROM mentalInterviews
       WHERE semesterKey = ? AND deletedAt IS NULL GROUP BY studentId
     ) iv ON iv.studentId = mh.studentId
     WHERE ${where}
     ORDER BY CASE mh.level WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 WHEN ? THEN 3 WHEN ? THEN 4 ELSE 5 END,
              mh.updatedAt DESC
     LIMIT ? OFFSET ?`,
    [...params, ...LEVELS, pageSize, (page - 1) * pageSize],
  );

  // 逐行判定用 Set 比对，避免 N 次查询
  const adminOrOwner = isAdmin(req.user) || isModuleOwner(req.user, 'mentalHealth');
  const classIdSet = new Set(adminOrOwner ? [] : classIdsOfUser(req.user));
  const hasInterviewPerm = hasPermission(req.user, 'mentalInterview');
  const canWriteRow = (record) => {
    if (!hasInterviewPerm) return false;
    if (!adminOrOwner && !(record.classId != null && classIdSet.has(record.classId))) return false;
    // 「无需关注」为留档档位：不再安排访谈（与 lib/mentalInterview.js canInterviewStudent 同口径）
    if (record.level === '无需关注') return false;
    return record.level === '一般关注'
      || (record.interviewDone > 0 && record.interviewDone < REQUIRED_COUNT);
  };

  res.json({
    list: rows.map((r) => ({
      ...r,
      talkCount: r.talkCount ?? 0,
      followCount: r.followCount ?? 0,
      interviewDone: r.interviewDone ?? 0,
      interviewRequired: REQUIRED_COUNT,
      canInterview: canWriteRow(r),
    })),
    total,
    page,
    pageSize,
    semester,
  });
});

/* ---------- 可标记学生候选（可见范围内、尚未标记；新增关注选择器用） ---------- */
router.get('/candidates', (req, res) => {
  const scope = classScopeSql(req.user);
  const kw = String(req.query.keyword ?? '').trim();
  const conds = ['NOT EXISTS (SELECT 1 FROM mentalHealth mh WHERE mh.studentId = s.id)', scope.sql];
  const params = [...scope.params];
  if (kw) {
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`);
  }
  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className, s.grade FROM students s
     WHERE ${conds.join(' AND ')} ORDER BY s.studentNo LIMIT 50`,
    params,
  );
  res.json(rows);
});

/* ---------- 批量导入关注学生（管理员 / 心理健康主负责） ----------
 * 逐条按「学号优先、姓名兜底」核对名册：
 * - 命中名册 → 写入关注标记（已有记录则更新），并记录等级变更审计；
 * - 未命中 → 不导入，原因统一为「学生未在学生名册中，确认学生是否在读」。
 * dryRun=true 只做校验与汇总（确认前预览），不落库、不写审计。
 */
const IMPORT_MAX_ROWS = 1000;
const IMPORT_DEFAULT_LEVEL = '一般关注';
const MISSING_STUDENT_REASON = '学生未在学生名册中，确认学生是否在读';

/** 按学号（优先）或姓名定位名册学生；返回 { student, reason } 二选一 */
function findRosterStudent({ studentNo, name }) {
  if (studentNo) {
    const student = dbx.get(
      'SELECT id, name, studentNo, className FROM students WHERE studentNo = ?',
      [studentNo],
    );
    if (!student) return { student: null, reason: MISSING_STUDENT_REASON };
    // 同时填了姓名时必须与学号对应学生一致，避免错行/错位导入
    if (name && name !== student.name) {
      return {
        student: null,
        reason: `学号与姓名不匹配：该学号在名册中为「${student.name}」，与填写的「${name}」不一致`,
      };
    }
    return { student, reason: null };
  }

  const matches = dbx.all(
    'SELECT id, name, studentNo, className FROM students WHERE name = ? ORDER BY studentNo',
    [name],
  );
  if (matches.length === 0) return { student: null, reason: MISSING_STUDENT_REASON };
  if (matches.length > 1) {
    return { student: null, reason: `名册中有 ${matches.length} 名同名学生，请填写学号后重试` };
  }
  return { student: matches[0], reason: null };
}

router.post('/import', (req, res) => {
  // 写权与关注标记维护同口径：管理员或心理健康主负责
  if (!isModuleOwner(req.user, 'mentalHealth')) {
    return res.status(403).json({ message: '仅管理员或心理健康主负责（心理辅导员）可批量导入关注学生' });
  }

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return res.status(400).json({ message: '没有可导入的数据行' });
  if (rows.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ message: `单次最多导入 ${IMPORT_MAX_ROWS} 行，请拆分文件后重试` });
  }
  const dryRun = req.body?.dryRun === true;

  const pending = [];
  const skipped = [];
  /** 本表内 学生ID → 首次出现行号（同一学生多行只取首行） */
  const seen = new Map();
  /** 已有记录且等级、备注均无变化：不写库，避免无谓刷新 updatedAt */
  const isNoop = (item) => !!item.before
    && item.before.level === item.level
    && (item.note === '' || item.note === item.before.note);

  rows.forEach((raw, index) => {
    const row = Number(raw?.row) || index + 2; // 第 1 行为表头
    const studentNo = String(raw?.studentNo ?? '').trim();
    const name = String(raw?.name ?? '').trim();
    const levelRaw = String(raw?.level ?? '').trim();
    const level = levelRaw || IMPORT_DEFAULT_LEVEL;
    const note = String(raw?.note ?? '').trim();

    const skip = (reason) => skipped.push({
      row,
      studentNo: studentNo || '—',
      name: name || '—',
      reason,
    });

    if (!studentNo && !name) return skip('学号与姓名均为空');
    if (!LEVELS.includes(level)) return skip(`关注等级需为：${LEVELS.join('、')}`);
    if (note.length > 200) return skip('关注备注不可超过 200 字');

    const { student, reason } = findRosterStudent({ studentNo, name });
    if (!student) return skip(reason);

    if (seen.has(student.id)) {
      return skip(`与第 ${seen.get(student.id)} 行指向同一名学生（${student.name}·${student.studentNo}），重复行已跳过`);
    }
    seen.set(student.id, row);

    const before = dbx.get('SELECT level, note FROM mentalHealth WHERE studentId = ?', [student.id]) ?? null;
    pending.push({ row, student, level, note, before });
  });

  if (!dryRun && pending.length > 0) {
    dbx.withTransaction(() => {
      for (const item of pending) {
        if (isNoop(item)) continue;
        const { row, student, level, note, before } = item;
        // 未填写备注时保留原备注，避免批量导入覆盖手工维护的说明
        const nextNote = note || before?.note || null;
        dbx.run(
          `INSERT INTO mentalHealth (studentId, level, note, updatedBy, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(studentId) DO UPDATE SET
             level = excluded.level, note = excluded.note,
             updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
          [student.id, level, nextNote, req.user.displayName, nowStr()],
        );
        if ((before?.level ?? null) !== level) {
          logLevelChange({
            studentId: student.id,
            studentName: student.name,
            fromLevel: before?.level ?? null,
            toLevel: level,
            source: 'manual',
            user: req.user,
            note: `批量导入（第 ${row} 行）`,
          });
        }
      }
    });
  }

  const successes = pending.map((item) => {
    const { row, student, level, before } = item;
    return {
      row,
      studentId: student.id,
      studentNo: student.studentNo,
      name: student.name,
      className: student.className,
      level,
      previousLevel: before?.level ?? null,
      // created：新建标记；updated：等级或备注变化；unchanged：已有记录且无变化
      action: !before ? 'created' : isNoop(item) ? 'unchanged' : 'updated',
    };
  });

  const countOf = (action) => successes.filter((s) => s.action === action).length;

  if (!dryRun) {
    logAccess(
      req,
      `批量导入心理关注学生：成功 ${successes.length} 名（新增 ${countOf('created')} / 更新 ${countOf('updated')} / 无变化 ${countOf('unchanged')}），跳过 ${skipped.length} 名`,
    );
  }

  res.json({
    dryRun,
    total: rows.length,
    successCount: successes.length,
    skippedCount: skipped.length,
    createdCount: countOf('created'),
    updatedCount: countOf('updated'),
    unchangedCount: countOf('unchanged'),
    successes,
    skipped,
  });
});

/* ---------- 心理访谈：某学生某学期的记录与进度 ---------- */
router.get('/interviews', (req, res) => {
  const studentId = String(req.query.studentId ?? '');
  if (!studentId) return res.status(400).json({ message: '缺少学生' });
  try {
    res.json(getInterviewView(req.user, studentId, req.query.semesterKey));
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 心理访谈：新增（幂等 + 等级联动） ---------- */
router.post('/interviews', requireAction('mentalInterview', 'create'), (req, res) => {
  try {
    const out = createInterview(req.user, req.body ?? {});
    logAccess(req, `填写心理访谈：${out.studentName}（第 ${out.done} 次，评估 ${out.levelAfter}）`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 心理访谈：编辑（仅作者/管理员，限本学期） ---------- */
router.put('/interviews/:id', requireAction('mentalInterview', 'edit'), (req, res) => {
  try {
    const out = updateInterview(req.user, req.params.id, req.body ?? {});
    logAccess(req, `修订心理访谈记录：${out.studentName}`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 心理访谈：软删（计数回退，不回滚等级） ---------- */
router.delete('/interviews/:id', requireAction('mentalInterview', 'void'), (req, res) => {
  try {
    const out = deleteInterview(req.user, req.params.id);
    logAccess(req, `作废心理访谈记录：${out.studentName}（本学期剩余 ${out.done} 次）`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 心理访谈：本学期未达标清单（页面横幅） ---------- */
router.get('/interview-overview', (req, res) => {
  if (!hasPermission(req.user, 'mentalInterview')) {
    return res.status(403).json({ message: '当前角色无权查看心理访谈任务' });
  }
  const semester = currentSemester();
  const pending = listPending(req.user, semester);
  res.json({
    semester,
    required: REQUIRED_COUNT,
    pendingCount: pending.length,
    pending,
  });
});

/* ---------- 批量导出用：跨学生访谈记录查询（管理员 / 心理健康主负责） ----------
 * 支持筛选：关注等级（学生当前档位，默认「一般关注」）、班级、访谈日期范围、关键字。
 * 前端分页循环拉取全部数据后，在浏览器端生成 Excel（与既有导出模式一致）。
 */
router.get('/interview-records', (req, res) => {
  try {
    res.json(listExportRecords(req.user, {
      level: req.query.level,
      classId: req.query.classId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      keyword: req.query.keyword,
      page: req.query.page,
      pageSize: req.query.pageSize,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 关注等级变更记录（审计时间线） ---------- */
router.get('/level-logs', (req, res) => {
  try {
    res.json(listLevelLogs(req.user, req.query.studentId, req.query.limit));
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 心理访谈记录单模板 ---------- */

/** 模板写权限：管理员或心理健康主负责（心理辅导员） */
function canManageTemplate(user) {
  return isModuleOwner(user, 'mentalHealth');
}

/** 模板列表（含引用数；渲染表单需先取到生效模板，故对所有登录用户开放读） */
router.get('/interview-templates', (req, res) => {
  try {
    res.json(tpl.listTemplates());
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/interview-templates', (req, res) => {
  if (!canManageTemplate(req.user)) {
    return res.status(403).json({ message: '仅管理员或心理健康主负责（心理辅导员）可维护访谈记录单模板' });
  }
  try {
    const out = tpl.createTemplate(req.user, req.body ?? {});
    logAccess(req, `新增访谈记录单模板：${out.name}（适用年级：${out.grades.length ? out.grades.join('、') : '全部'}；适用等级：${out.levels.length ? out.levels.join('、') : '不限'}）`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/interview-templates/:id', (req, res) => {
  if (!canManageTemplate(req.user)) {
    return res.status(403).json({ message: '仅管理员或心理健康主负责（心理辅导员）可维护访谈记录单模板' });
  }
  try {
    const out = tpl.updateTemplate(req.user, req.params.id, req.body ?? {});
    logAccess(req, `修改访谈记录单模板：${out.name}（v${out.version}，适用年级：${out.grades.length ? out.grades.join('、') : '全部'}；适用等级：${out.levels.length ? out.levels.join('、') : '不限'}）`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/interview-templates/:id', (req, res) => {
  if (!canManageTemplate(req.user)) {
    return res.status(403).json({ message: '仅管理员或心理健康主负责（心理辅导员）可维护访谈记录单模板' });
  }
  try {
    const out = tpl.deleteTemplate(req.params.id);
    logAccess(req, `删除访谈记录单模板：${out.name}`);
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

/* ---------- 设置 / 调整 / 取消关注标记 ---------- */
router.put('/:studentId', (req, res) => {
  const studentId = String(req.params.studentId ?? '');
  const student = dbx.get('SELECT id, name FROM students WHERE id = ?', [studentId]);
  if (!student) return res.status(404).json({ message: '学生不存在' });
  // 严格口径：写操作仅「心理健康主负责辅导员」或管理员（带班不再是写权通道）
  if (!isModuleOwner(req.user, 'mentalHealth')) {
    return res.status(403).json({ message: '仅「心理健康主负责辅导员」或管理员可维护关注标记' });
  }

  const level = String(req.body?.level ?? '').trim();
  if (level && !LEVELS.includes(level)) {
    return res.status(400).json({ message: `关注等级需为：${LEVELS.join('、')}` });
  }
  const note = String(req.body?.note ?? '').trim();
  const before = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [studentId])?.level ?? null;

  if (!level) {
    dbx.withTransaction(() => {
      dbx.run('DELETE FROM mentalHealth WHERE studentId = ?', [studentId]);
      if (before) {
        logLevelChange({
          studentId,
          studentName: student.name,
          fromLevel: before,
          toLevel: null,
          source: 'manual',
          user: req.user,
          note: '手工取消关注标记',
        });
      }
    });
    logAccess(req, `取消心理健康关注标记（${student.name}）`);
    return res.json({ ok: true, cleared: true });
  }

  dbx.withTransaction(() => {
    dbx.run(
      `INSERT INTO mentalHealth (studentId, level, note, updatedBy, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(studentId) DO UPDATE SET
         level = excluded.level, note = excluded.note,
         updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
      [studentId, level, note || null, req.user.displayName, nowStr()],
    );
    if (before !== level) {
      logLevelChange({
        studentId,
        studentName: student.name,
        fromLevel: before,
        toLevel: level,
        source: 'manual',
        user: req.user,
        note: note || '手工调整关注等级',
      });
    }
  });
  logAccess(req, `设置心理健康关注标记：${level}（${student.name}）`);
  res.json({ ok: true });
});

/* ---------- 与谈心谈话打通：某学生的全部谈话记录（只读） ---------- */
router.get('/timeline', (req, res) => {
  const studentId = String(req.query.studentId ?? '');
  // 查看不收紧：主负责/管理员全院可看；其他带班角色仍限本班学生（与列表范围一致）
  if (!studentId || !(isModuleOwner(req.user, 'mentalHealth') || canManageStudent(req.user, studentId))) {
    return res.status(403).json({ message: '仅主负责辅导员、管理员或该学生所辖班级辅导员可查看谈话记录' });
  }
  const student = dbx.get('SELECT id, name, studentNo, className FROM students WHERE id = ?', [studentId]);
  if (!student) return res.status(404).json({ message: '学生不存在' });

  const rows = dbx.all(
    'SELECT * FROM conversations WHERE studentId = ? ORDER BY talkTime DESC, createdAt DESC',
    [studentId],
  );
  res.json({
    student,
    list: rows.map((r) => ({ ...r, needFollowUp: r.needFollowUp === 1 })),
  });
});

module.exports = router;

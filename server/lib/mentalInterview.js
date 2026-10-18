/**
 * 心理访谈业务层（表 mentalInterviews / mentalLevelLogs / mentalInterviewTemplates）。
 *
 * 业务约束：
 * - 一名学生每学期至少 2 次；不设上限（「至少」不是「最多」）。
 * - 首次访谈要求当前为「一般关注」；同学期已有记录后放宽为「本班在册即可继续」，
 *   否则首次评估改为其他等级后学生离开关注列表，第二访谈永远无法完成。
 * - 访谈题目以「记录单模板」为准（按学生年级解析；历史记录用填写时的题目快照）。
 * - 提交后按 levelAfter 同步 mentalHealth：无需关注→标记为「无需关注」并保留在模块内；
 *   其他→更新等级；每次变化写审计日志。
 * - 记录软删：计数回退，但不回滚关注等级（等级可能已被主负责再次调整）。
 * - 学生删除后记录保留（无外键），姓名/班级冗余快照。
 */
const dbx = require('./db');
const { hasPermission, isSystemAdmin, isModuleOwner } = require('./permissions');
const { canManageStudent, classIdsOfUser } = require('./scope');
const { currentSemester, previousSemester, semesterOf, todayCN, inSemester, parseYmd } = require('./semester');
const {
  formModelFromGroups,
  resolveFormModel,
  validateAnswers,
} = require('./interviewTemplate');

/** 访谈后评估：含「无需关注」，与关注列表 5 档 ATTENTION_LEVELS 对齐 */
const INTERVIEW_LEVELS = ['无需关注', '一般关注', '日常关注', '重点关注', '密切关注'];
const REQUIRED_COUNT = 2;
const FORM_VERSION = 2;
const SEMESTER_RE = /^\d{4}-\d{4}-[12]$/;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function countDone(studentId, semesterKey) {
  return dbx.get(
    `SELECT COUNT(*) AS c FROM mentalInterviews
     WHERE studentId = ? AND semesterKey = ? AND deletedAt IS NULL`,
    [studentId, semesterKey],
  ).c;
}

/**
 * 访谈写权（服务端唯一口径）：
 * 有 mentalInterview 权限 + 数据范围内（管理员/心理主负责/带班）；
 * 且首次必须「一般关注」，已开始未达标可继续。
 * 「无需关注」学生不再安排访谈（已退出关注，仅留档可查）。
 */
function canInterviewStudent(user, studentId, level, done) {
  if (!hasPermission(user, 'mentalInterview')) return false;
  const inScope = isSystemAdmin(user) || isModuleOwner(user, 'mentalHealth') || canManageStudent(user, studentId);
  if (!inScope) return false;
  if (level === '无需关注') return false;
  return level === '一般关注' || (done > 0 && done < REQUIRED_COUNT);
}

/** 只读范围：管理员/心理主负责全院；其他人限带班 */
function canViewStudent(user, studentId) {
  return isSystemAdmin(user) || isModuleOwner(user, 'mentalHealth') || canManageStudent(user, studentId);
}

/** 解析并校验表单；返回规范化后的 values（answers 按模板题目白名单重建） */
function validatePayload(body, { model, semesterKey } = {}) {
  const interviewDate = String(body?.interviewDate ?? '').trim();
  if (!parseYmd(interviewDate)) throw fail('访谈时间格式需为 YYYY-MM-DD');
  if (interviewDate > todayCN()) throw fail('访谈时间不能晚于今天');

  const sem = semesterOf(interviewDate);
  const cur = currentSemester();
  const prev = previousSemester(cur);
  if (!sem || (sem.key !== cur.key && sem.key !== prev.key)) {
    throw fail('访谈时间只能选择本学期或上一学期（假期补录）');
  }
  if (semesterKey && sem.key !== semesterKey) {
    throw fail('跨学期记录不可改期，请作废后在新学期重录', 409);
  }
  if (!inSemester(interviewDate, sem)) throw fail('访谈时间不在学期区间内');

  const levelAfter = String(body?.levelAfter ?? '').trim();
  if (!INTERVIEW_LEVELS.includes(levelAfter)) {
    throw fail(`访谈后关注等级评估需为：${INTERVIEW_LEVELS.join('、')}`);
  }

  if (body?.signatureConfirmed !== true) {
    throw fail('请勾选签字确认后再提交');
  }

  const answers = validateAnswers(model, body?.answers);

  return { interviewDate, levelAfter, answers, semester: sem };
}

/** 写关注等级变更审计 */
function logLevelChange({ studentId, studentName, fromLevel, toLevel, source, refId, user, note }) {
  dbx.run(
    `INSERT INTO mentalLevelLogs
       (studentId, studentName, fromLevel, toLevel, source, refId, operatorId, operatorName, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      studentId,
      studentName || '（已删除学生）',
      fromLevel ?? null,
      toLevel ?? null,
      source,
      refId ?? null,
      user?.id ?? null,
      user?.displayName ?? '系统',
      note ?? null,
      new Date().toISOString().slice(0, 16).replace('T', ' '),
    ],
  );
}

/**
 * 应用等级变化（事务内调用，禁止 await）：
 * - 目标为空（手工取消关注）→ 删除关注标记，学生离开心理健康模块；
 * - 目标「无需关注」或其他等级 → UPSERT 等级（保留 note），学生始终留在模块内。
 *   访谈评估为「无需关注」不再删除学生：留档可查，也不再安排访谈。
 * - 变化才写日志
 */
function applyLevelInTx({ student, fromLevel, toLevel, user, refId, source, note }) {
  if ((fromLevel ?? null) === (toLevel ?? null)) return false;
  if (!toLevel) {
    dbx.run('DELETE FROM mentalHealth WHERE studentId = ?', [student.id]);
  } else {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    dbx.run(
      `INSERT INTO mentalHealth (studentId, level, note, updatedBy, updatedAt)
       VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(studentId) DO UPDATE SET
         level = excluded.level,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`,
      [student.id, toLevel, user?.displayName ?? '系统', now],
    );
  }
  logLevelChange({
    studentId: student.id,
    studentName: student.name,
    fromLevel: fromLevel ?? null,
    toLevel: toLevel ?? null,
    source,
    refId,
    user,
    note,
  });
  return true;
}

function listRecords(studentId, semesterKey) {
  return dbx.all(
    `SELECT * FROM mentalInterviews
     WHERE studentId = ? AND semesterKey = ? AND deletedAt IS NULL
     ORDER BY interviewDate DESC, createdAt DESC`,
    [studentId, semesterKey],
  ).map((r) => {
    let answers = {};
    try { answers = JSON.parse(r.answers ?? '{}'); } catch { answers = {}; }
    let formGroups = null;
    try { formGroups = r.formSnapshot ? JSON.parse(r.formSnapshot) : null; } catch { formGroups = null; }
    return {
      id: r.id,
      studentId: r.studentId,
      studentName: r.studentName,
      className: r.className,
      semesterKey: r.semesterKey,
      semesterLabel: r.semesterLabel,
      interviewDate: r.interviewDate,
      interviewerId: r.interviewerId,
      interviewerName: r.interviewerName,
      levelBefore: r.levelBefore,
      levelAfter: r.levelAfter,
      answers,
      summary: r.summary,
      signatureName: r.signatureName,
      signedAt: r.signedAt,
      formVersion: r.formVersion,
      templateId: r.templateId ?? null,
      templateVersion: r.templateVersion ?? null,
      formGroups,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    };
  });
}

/** 由 key 还原学期对象（历史学期也返回正确的起止日期） */
function semesterFromKey(key) {
  const m = /^(\d{4})-(\d{4})-([12])$/.exec(String(key ?? ''));
  if (!m) return null;
  const [, sy, ey, term] = m;
  return {
    key,
    label: `${sy}-${ey}学年${term === '1' ? '第一' : '第二'}学期`,
    startDate: term === '1' ? `${sy}-08-01` : `${ey}-02-01`,
    endDate: term === '1' ? `${ey}-01-31` : `${ey}-07-31`,
    daysLeft: 0,
  };
}

/** 某学生某学期的访谈视图（含进度与写权） */
function getInterviewView(user, studentId, semesterKeyRaw) {
  const student = dbx.get('SELECT id, name, studentNo, className, grade, classId FROM students WHERE id = ?', [studentId]);
  if (!student) throw fail('学生不存在', 404);
  if (!canViewStudent(user, studentId)) throw fail('无权查看该学生的访谈记录', 403);

  const cur = currentSemester();
  const semesterKey = SEMESTER_RE.test(String(semesterKeyRaw ?? '')) ? String(semesterKeyRaw) : cur.key;
  const semester = semesterKey === cur.key ? cur : (semesterFromKey(semesterKey) ?? cur);

  const mh = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [studentId]);
  const done = countDone(studentId, semesterKey);
  const list = listRecords(studentId, semesterKey);
  const form = resolveFormModel(student.grade);
  return {
    student,
    semester,
    required: REQUIRED_COUNT,
    done,
    canWrite: canInterviewStudent(user, studentId, mh?.level ?? null, done),
    level: mh?.level ?? null,
    list,
    /** 该生当前生效的记录单模板（按年级解析；前端渲染表单与历史问答兜底用） */
    form,
  };
}

/** 由 key 还原展示名（落库冗余，历史记录仍用写入时的 label） */
function semesterLabelOf(key) {
  const m = /^(\d{4})-(\d{4})-([12])$/.exec(String(key ?? ''));
  if (!m) return String(key ?? '');
  return `${m[1]}-${m[2]}学年${m[3] === '1' ? '第一' : '第二'}学期`;
}

/** 新增访谈（幂等 + 事务） */
function createInterview(user, body) {
  const studentId = String(body?.studentId ?? '').trim();
  if (!studentId) throw fail('缺少学生');
  const student = dbx.get('SELECT id, name, studentNo, className, grade FROM students WHERE id = ?', [studentId]);
  if (!student) throw fail('学生不存在', 404);

  // 按学生年级解析生效记录单模板（写入时快照，后续改题不影响本条记录）
  const model = resolveFormModel(student.grade);
  const values = validatePayload(body, { model });

  const { semester } = values;

  const clientRequestId = String(body?.clientRequestId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
    throw fail('提交标识无效，请刷新后重试');
  }

  // 幂等：同一提交标识直接返回已有记录
  const existed = dbx.get('SELECT * FROM mentalInterviews WHERE clientRequestId = ?', [clientRequestId]);
  if (existed) {
    return {
      id: existed.id,
      done: countDone(existed.studentId, existed.semesterKey),
      levelSynced: false,
      duplicate: true,
      semester: { key: existed.semesterKey, label: existed.semesterLabel },
    };
  }

  const mhBefore = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [studentId]);
  const doneBefore = countDone(studentId, semester.key);
  if (!canInterviewStudent(user, studentId, mhBefore?.level ?? null, doneBefore)) {
    throw fail('当前无权为该学生填写心理访谈（仅限所带班级的「一般关注」学生）', 403);
  }

  const id = `mi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const result = dbx.withTransaction(() => {
    const mh = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [studentId]);
    const done = countDone(studentId, semester.key);
    if (done === 0 && mh?.level !== '一般关注') {
      throw fail('该学生当前已不是「一般关注」，请刷新后重试', 409);
    }
    if (!canInterviewStudent(user, studentId, mh?.level ?? null, done)) {
      throw fail('当前无权为该学生填写心理访谈', 403);
    }

    dbx.run(
      `INSERT INTO mentalInterviews
        (id, studentId, studentName, className, grade, semesterKey, semesterLabel, interviewDate,
         interviewerId, interviewerName, levelBefore, levelAfter, answers, summary,
         signatureName, signedAt, formVersion, clientRequestId, templateId, templateVersion,
         formSnapshot, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        student.id,
        student.name,
        student.className ?? null,
        student.grade ?? null,
        semester.key,
        semester.label,
        values.interviewDate,
        user.id ?? null,
        user.displayName ?? '',
        mh?.level ?? null,
        values.levelAfter,
        JSON.stringify(values.answers),
        String(values.answers.summary ?? ''),
        user.displayName ?? '',
        now,
        FORM_VERSION,
        clientRequestId,
        model.id,
        model.id ? (model.version ?? 1) : null,
        JSON.stringify(model.groups),
        now,
      ],
    );

    const levelSynced = applyLevelInTx({
      student,
      fromLevel: mh?.level ?? null,
      toLevel: values.levelAfter,
      user,
      refId: id,
      source: 'interview',
      note: `心理访谈第 ${done + 1} 次：${mh?.level ?? '未标记'} → ${values.levelAfter}`,
    });

    return { id, done: done + 1, levelSynced };
  });

  return {
    ...result,
    studentName: student.name,
    levelAfter: values.levelAfter,
    semester: { key: semester.key, label: semester.label },
  };
}

/** 编辑访谈：仅作者本人或管理员；限本学期；改期不可跨学期 */
function updateInterview(user, id, body) {
  const record = dbx.get('SELECT * FROM mentalInterviews WHERE id = ? AND deletedAt IS NULL', [String(id ?? '')]);
  if (!record) throw fail('访谈记录不存在', 404);

  const isAdminUser = isSystemAdmin(user);
  const isAuthor = Number(record.interviewerId) === Number(user.id);
  if (!isAdminUser && !isAuthor) throw fail('仅记录提交人或管理员可编辑', 403);
  if (!isAdminUser && !hasPermission(user, 'mentalInterview')) throw fail('当前角色无权编辑心理访谈', 403);

  const cur = currentSemester();
  if (record.semesterKey !== cur.key) throw fail('仅可编辑本学期的访谈记录', 409);

  // 题目口径：优先用本条记录填写时的模板快照（模板改题不追溯）；
  // 老记录无快照时按当前生效模板解析，并在保存时补写快照（幂等升级）。
  let snapshotGroups = null;
  try { snapshotGroups = record.formSnapshot ? JSON.parse(record.formSnapshot) : null; } catch { snapshotGroups = null; }
  let model;
  if (snapshotGroups) {
    model = formModelFromGroups(snapshotGroups);
  } else {
    const student = dbx.get('SELECT grade FROM students WHERE id = ?', [record.studentId]);
    model = resolveFormModel(student?.grade);
  }

  const values = validatePayload(body, { model, semesterKey: record.semesterKey });
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  // 老记录首次编辑时补记模板信息（快照已解析为当前生效模板）
  const backfillTemplate = !record.templateId && model.id
    ? { id: model.id, version: model.version ?? 1, snapshot: JSON.stringify(model.groups) }
    : null;

  const result = dbx.withTransaction(() => {
    const mh = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [record.studentId]);
    let levelSynced = false;
    let levelSyncSkipped = false;
    if (values.levelAfter !== record.levelAfter) {
      // CAS：仅当当前等级仍等于本次记录上次评估值时才同步，避免覆盖主负责的后续调整
      if ((mh?.level ?? null) === (record.levelAfter ?? null)) {
        levelSynced = applyLevelInTx({
          student: { id: record.studentId, name: record.studentName },
          fromLevel: mh?.level ?? null,
          toLevel: values.levelAfter,
          user,
          refId: record.id,
          source: 'interview-edit',
          note: `访谈记录修订：${record.levelAfter} → ${values.levelAfter}`,
        });
      } else {
        levelSyncSkipped = true;
      }
    }

    dbx.run(
      `UPDATE mentalInterviews SET
         interviewDate = ?, semesterKey = ?, semesterLabel = ?, levelAfter = ?,
         answers = ?, summary = ?, signatureName = ?, signedAt = ?,
         templateId = COALESCE(?, templateId),
         templateVersion = COALESCE(?, templateVersion),
         formSnapshot = COALESCE(?, formSnapshot),
         updatedBy = ?, updatedAt = ?
       WHERE id = ?`,
      [
        values.interviewDate,
        values.semester.key,
        values.semester.label,
        values.levelAfter,
        JSON.stringify(values.answers),
        String(values.answers.summary ?? ''),
        user.displayName ?? '',
        now,
        backfillTemplate?.id ?? null,
        backfillTemplate?.version ?? null,
        backfillTemplate?.snapshot ?? null,
        user.displayName ?? '',
        now,
        record.id,
      ],
    );
    return { levelSynced, levelSyncSkipped };
  });

  return {
    ok: true,
    ...result,
    studentName: record.studentName,
    done: countDone(record.studentId, record.semesterKey),
  };
}

/** 软删：计数回退；不回滚等级 */
function deleteInterview(user, id) {
  const record = dbx.get('SELECT * FROM mentalInterviews WHERE id = ? AND deletedAt IS NULL', [String(id ?? '')]);
  if (!record) throw fail('访谈记录不存在', 404);

  const isAdminUser = isSystemAdmin(user);
  const isAuthor = Number(record.interviewerId) === Number(user.id);
  if (!isAdminUser && !isAuthor) throw fail('仅记录提交人或管理员可删除', 403);
  if (!isAdminUser && !hasPermission(user, 'mentalInterview')) throw fail('当前角色无权删除心理访谈', 403);
  if (!isAdminUser && record.semesterKey !== currentSemester().key) {
    throw fail('仅可删除本学期的访谈记录', 409);
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  dbx.withTransaction(() => {
    dbx.run(
      'UPDATE mentalInterviews SET deletedAt = ?, deletedBy = ? WHERE id = ?',
      [now, user.displayName ?? '', record.id],
    );
    const mh = dbx.get('SELECT level FROM mentalHealth WHERE studentId = ?', [record.studentId]);
    if (mh?.level) {
      logLevelChange({
        studentId: record.studentId,
        studentName: record.studentName,
        fromLevel: mh.level,
        toLevel: mh.level,
        source: 'interview-delete',
        refId: record.id,
        user,
        note: '访谈记录作废（本学期计数回退），关注等级未回滚',
      });
    }
  });

  return {
    ok: true,
    studentName: record.studentName,
    done: countDone(record.studentId, record.semesterKey),
  };
}

/** 未达标清单：当前一般关注未满 2 次 ∪ 本学期已开始但未满 2 次（无需关注不占名额） */
function listPending(user, semester = currentSemester()) {
  const scopeSql = isSystemAdmin(user) || isModuleOwner(user, 'mentalHealth')
    ? '1 = 1'
    : 's.classId IN (SELECT classId FROM classCounselors WHERE userId = ?)';
  const params = [semester.key, REQUIRED_COUNT];
  if (!(isSystemAdmin(user) || isModuleOwner(user, 'mentalHealth'))) params.push(user.id);

  const rows = dbx.all(
    `SELECT s.id, s.name, s.studentNo, s.className, s.classId, mh.level,
            COALESCE(iv.c, 0) AS done
     FROM students s
     LEFT JOIN mentalHealth mh ON mh.studentId = s.id
     LEFT JOIN (
       SELECT studentId, COUNT(*) AS c FROM mentalInterviews
       WHERE semesterKey = ? AND deletedAt IS NULL
       GROUP BY studentId
     ) iv ON iv.studentId = s.id
     WHERE (mh.level = '一般关注' OR COALESCE(iv.c, 0) > 0)
       AND COALESCE(iv.c, 0) < ?
       AND (mh.level IS NULL OR mh.level <> '无需关注')
       AND ${scopeSql}
     ORDER BY CASE mh.level WHEN '一般关注' THEN 0 ELSE 1 END, s.className, s.studentNo`,
    params,
  );

  return rows.map((r) => ({
    ...r,
    required: REQUIRED_COUNT,
    canWrite: canInterviewStudent(user, r.id, r.level ?? null, r.done),
  }));
}

/** 等级变更时间线（按可见范围） */
function listLevelLogs(user, studentId, limit = 100) {
  const student = dbx.get('SELECT id, name FROM students WHERE id = ?', [String(studentId ?? '')]);
  if (!student) throw fail('学生不存在', 404);
  if (!canViewStudent(user, student.id)) throw fail('无权查看该学生的等级变更记录', 403);
  return dbx.all(
    `SELECT id, studentId, studentName, fromLevel, toLevel, source, refId,
            operatorName, note, createdAt
     FROM mentalLevelLogs WHERE studentId = ? ORDER BY id DESC LIMIT ?`,
    [student.id, Math.min(200, Math.max(1, Number(limit) || 100))],
  );
}

module.exports = {
  INTERVIEW_LEVELS,
  REQUIRED_COUNT,
  FORM_VERSION,
  SEMESTER_RE,
  countDone,
  canInterviewStudent,
  canViewStudent,
  logLevelChange,
  applyLevelInTx,
  getInterviewView,
  createInterview,
  updateInterview,
  deleteInterview,
  listPending,
  listLevelLogs,
  semesterLabelOf,
};

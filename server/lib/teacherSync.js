/**
 * 教师唯一来源的派生与同步（班级管理 → 教师名单 为唯一写入口）。
 *
 * 派生口径（必须全局唯一，任何模块不得另算）：
 * - students.counselor   = 该班 roleType='counselor' 的教师姓名，按 users.id 升序以「、」连接；
 * - students.headTeacher = 该班 roleType='headTeacher' 的教师姓名，同上；
 * - 排序必须稳定（按 users.id），否则同一份数据两次导入会产生假 diff。
 * 两个字段在学生表中仅为只读冗余列（导出/历史留档），不再由学生导入写入。
 */
const dbx = require('./db');
const { ROLE_TYPE_COUNSELOR, ROLE_TYPE_HEAD_TEACHER, ROLE_TYPES } = require('./teacherSourceMigrate');

/** 身份 → 中文名 */
const ROLE_LABEL = {
  [ROLE_TYPE_COUNSELOR]: '辅导员',
  [ROLE_TYPE_HEAD_TEACHER]: '班主任',
};

/** 中文名 → 身份（导入模板填写值） */
const ROLE_BY_LABEL = Object.fromEntries(Object.entries(ROLE_LABEL).map(([k, v]) => [v, k]));

/**
 * 某班某身份的教师姓名串（按 users.id 升序，保证拼接结果稳定）。
 * @param {number|null} classId
 * @param {'counselor'|'headTeacher'} roleType
 * @returns {string} 无教师时返回空串
 */
function teacherNamesOfClass(classId, roleType) {
  const cid = Number(classId);
  if (!Number.isInteger(cid) || cid <= 0) return '';
  const rows = dbx.all(
    `SELECT u.displayName AS name FROM classCounselors cc
     JOIN users u ON u.id = cc.userId
     WHERE cc.classId = ? AND cc.roleType = ?
     ORDER BY u.id`,
    [cid, roleType],
  );
  return rows.map((r) => r.name).join('、');
}

/** 某班的派生责任人：{ counselor, headTeacher }（无人时为 null，便于直接落库） */
function derivedTeachersOfClass(classId) {
  return {
    counselor: teacherNamesOfClass(classId, ROLE_TYPE_COUNSELOR) || null,
    headTeacher: teacherNamesOfClass(classId, ROLE_TYPE_HEAD_TEACHER) || null,
  };
}

/**
 * 按班级批量回填学生表的派生冗余列（只更新有差异的行）。
 * 事务内调用可保证「教师变动 → 学生责任人文本」保持一致的原子性。
 * @param {number[]} classIds
 * @returns {{ classCount: number, changedCount: number }}
 */
function refillStudentsByClass(classIds) {
  const ids = [...new Set((classIds ?? [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0))];
  let changedCount = 0;
  for (const classId of ids) {
    const { counselor, headTeacher } = derivedTeachersOfClass(classId);
    const info = dbx.run(
      `UPDATE students SET counselor = ?, headTeacher = ?
       WHERE classId = ?
         AND (COALESCE(counselor, '') <> ? OR COALESCE(headTeacher, '') <> ?)`,
      [counselor, headTeacher, classId, counselor ?? '', headTeacher ?? ''],
    );
    changedCount += Number(info.changes ?? 0);
  }
  return { classCount: ids.length, changedCount };
}

/** 全部班级 id（回填脚本与全量同步用） */
function allClassIds() {
  return dbx.all('SELECT id FROM classes ORDER BY id').map((r) => r.id);
}

/**
 * 教师名单（人视角）：按身份/在职状态/关键字/班级过滤。
 * @returns {Array<{ id, employeeNo, name, mobile, roleTypes, roleLabels, classIds, classNames, disabled, teacherSource }>}
 */
function listTeachers({ roleType, status, keyword, classId } = {}) {
  const conds = ['1 = 1'];
  const params = [];
  if (roleType && ROLE_TYPES.includes(roleType)) {
    conds.push('EXISTS (SELECT 1 FROM classCounselors cc WHERE cc.userId = u.id AND cc.roleType = ?)');
    params.push(roleType);
  }
  if (status === 'active') conds.push('u.disabled = 0');
  if (status === 'leave') conds.push('u.disabled = 1');
  const kw = String(keyword ?? '').trim();
  if (kw) {
    conds.push('(u.username LIKE ? OR u.displayName LIKE ? OR COALESCE(u.mobile, \'\') LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  const cid = Number(classId);
  if (Number.isInteger(cid) && cid > 0) {
    conds.push('EXISTS (SELECT 1 FROM classCounselors cc2 WHERE cc2.userId = u.id AND cc2.classId = ?)');
    params.push(cid);
  }
  // 教师池 = 具备 counselor / headTeacher 身份的账号（用户管理不再新增这两类账号）
  conds.push(`EXISTS (SELECT 1 FROM userRoles ur WHERE ur.userId = u.id AND ur.roleKey IN (${ROLE_TYPES.map(() => '?').join(', ')}))`);
  params.push(...ROLE_TYPES);

  const users = dbx.all(
    `SELECT u.id, u.username, u.displayName, u.mobile, u.disabled, u.teacherSource
     FROM users u WHERE ${conds.join(' AND ')} ORDER BY u.disabled, u.username`,
    params,
  );

  const bindings = dbx.all(
    `SELECT cc.userId, cc.classId, cc.roleType, c.name AS className, g.name AS gradeName
     FROM classCounselors cc
     JOIN classes c ON c.id = cc.classId
     JOIN grades g ON g.id = c.gradeId
     ORDER BY g.name DESC, c.name`,
  );
  const rolesOf = dbx.all('SELECT userId, roleKey FROM userRoles ORDER BY roleKey');

  return users.map((u) => {
    const own = bindings.filter((b) => b.userId === u.id);
    const classIds = [...new Set(own.map((b) => b.classId))];
    return {
      id: u.id,
      employeeNo: u.username,
      name: u.displayName,
      mobile: u.mobile ?? '',
      roleTypes: [...new Set(own.map((b) => b.roleType))],
      roleLabels: [...new Set(own.map((b) => ROLE_LABEL[b.roleType]))],
      classIds,
      classNames: [...new Set(own.map((b) => `${b.gradeName}·${b.className}`))],
      disabled: !!u.disabled,
      teacherSource: u.teacherSource ?? '',
      allRoleKeys: rolesOf.filter((r) => r.userId === u.id).map((r) => r.roleKey),
    };
  });
}

module.exports = {
  ROLE_LABEL,
  ROLE_BY_LABEL,
  teacherNamesOfClass,
  derivedTeachersOfClass,
  refillStudentsByClass,
  allClassIds,
  listTeachers,
};

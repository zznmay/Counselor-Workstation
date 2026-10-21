/**
 * 教师唯一来源的派生与同步（班级管理录入工号 + 同步用户管理建号为唯一写入口）。
 *
 * 派生口径（必须全局唯一，任何模块不得另算）：
 * - students.counselor   = 该班 roleType='counselor' 的教师姓名，按 users.id 升序以「、」连接；
 * - students.headTeacher = 该班 roleType='headTeacher' 的教师姓名，同上；
 * - 排序必须稳定（按 users.id），否则同一份数据两次导入会产生假 diff。
 * 两个字段在学生表中仅为只读冗余列（导出/历史留档），不再由学生导入写入。
 */
const dbx = require('./db');
const { ROLE_TYPE_COUNSELOR, ROLE_TYPE_HEAD_TEACHER } = require('./teacherSourceMigrate');

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

module.exports = {
  teacherNamesOfClass,
  derivedTeachersOfClass,
  refillStudentsByClass,
  allClassIds,
};

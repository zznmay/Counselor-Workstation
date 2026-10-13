/** 数据可见范围：按学生归属隔离（主责辅导员 + 共管老师）；管理员可见全部 */
const db = require('./db');

function isAdmin(user) {
  return user?.role === 'admin';
}

/**
 * 生成学生可见性 SQL 条件与参数。
 * 管理员：全部可见；辅导员：主责或共管的学生。
 */
function studentScope(user) {
  if (isAdmin(user)) return { where: '', params: [] };
  return {
    where: `AND (s.ownerId = ? OR EXISTS (
      SELECT 1 FROM studentCounselors sc WHERE sc.studentId = s.id AND sc.userId = ?))`,
    params: [user.id, user.id],
  };
}

/** 用户可见的学生 id 列表 */
function visibleStudentIds(user) {
  if (isAdmin(user)) {
    return db.prepare('SELECT id FROM students').all().map((r) => r.id);
  }
  return db.prepare(
    `SELECT id FROM students s WHERE s.ownerId = ? OR EXISTS (
      SELECT 1 FROM studentCounselors sc WHERE sc.studentId = s.id AND sc.userId = ?)`,
  ).all(user.id, user.id).map((r) => r.id);
}

/** 某学生是否对该用户可见 */
function canSeeStudent(user, studentId) {
  if (isAdmin(user)) return true;
  const row = db.prepare(
    `SELECT 1 FROM students s WHERE s.id = ? AND (s.ownerId = ? OR EXISTS (
      SELECT 1 FROM studentCounselors sc WHERE sc.studentId = s.id AND sc.userId = ?))`,
  ).get(studentId, user.id, user.id);
  return !!row;
}

/** 敏感记录（谈话/预警/审批）的可见性过滤：随学生归属联动 */
function sensitiveScope(user, alias = 'x') {
  if (isAdmin(user)) return { where: '', params: [] };
  return {
    where: `AND EXISTS (SELECT 1 FROM students s WHERE s.id = ${alias}.studentId
      AND (s.ownerId = ? OR EXISTS (
        SELECT 1 FROM studentCounselors sc WHERE sc.studentId = s.id AND sc.userId = ?)))`,
    params: [user.id, user.id],
  };
}

module.exports = { isAdmin, studentScope, visibleStudentIds, canSeeStudent, sensitiveScope };

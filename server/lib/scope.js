/** 数据权限：按「带班」判定（用户管理分配的所辖班级，classCounselors）；管理员全量 */
const dbx = require('./db');

function isAdmin(user) {
  // 主角色规则：集合含 admin 时 users.role 已同步为 admin；roleKeys 兜底防御脏数据
  return user?.role === 'admin' || (Array.isArray(user?.roleKeys) && user.roleKeys.includes('admin'));
}

/**
 * 学生基础信息编辑/删除权：管理员，或该学生的归属班级在用户所辖班级内。
 * 学生 classId 为空（历史数据）时仅管理员可维护。
 */
function canManageStudent(user, studentId) {
  if (isAdmin(user)) return true;
  const row = dbx.get(
    `SELECT 1 FROM students s WHERE s.id = ? AND s.classId IN (
      SELECT classId FROM classCounselors WHERE userId = ?)`,
    [studentId, user.id],
  );
  return !!row;
}

/** 敏感记录（谈话/预警/审批）过滤：记录所属学生必须在用户所辖班级内 */
function sensitiveScope(user, alias = 'x') {
  if (isAdmin(user)) return { where: '', params: [] };
  return {
    where: `AND EXISTS (SELECT 1 FROM students s WHERE s.id = ${alias}.studentId
      AND s.classId IN (SELECT classId FROM classCounselors WHERE userId = ?))`,
    params: [user.id],
  };
}

/** 会话下发用：用户所辖班级 id 列表（管理员返回空数组） */
function classIdsOfUser(user) {
  if (!user || isAdmin(user)) return [];
  return dbx.all('SELECT classId FROM classCounselors WHERE userId = ? ORDER BY classId', [user.id])
    .map((r) => r.classId);
}

module.exports = { isAdmin, canManageStudent, sensitiveScope, classIdsOfUser };

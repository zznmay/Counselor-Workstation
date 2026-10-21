/** 数据权限：按「带班」判定（用户管理分配的所辖班级，classCounselors）；管理员全量 */
const dbx = require('./db');
const { roleKeysOfUser } = require('./permissions');

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

/**
 * 名册查看范围：管理员或角色集合含 counselor（辅导员）→ null（全员可见）；
 * 其他用户一律按带班收口（classCounselors），带班为空则可见 0 人。
 * 多角色并存按最大范围合并（含 counselor 即放行）；roleKeys 缺失时由 roleKeysOfUser 回退主角色。
 * 学生 classId 为空（历史数据）对收口用户天然不可见，仅管理员/辅导员可见。
 */
function rosterScope(user, alias = 's') {
  if (isAdmin(user)) return null;
  const keys = roleKeysOfUser(user);
  if (keys.includes('counselor')) return null;
  return {
    sql: `${alias}.classId IN (SELECT classId FROM classCounselors WHERE userId = ?)`,
    params: [user.id],
  };
}

/** 会话下发用：用户所辖班级 id 列表（管理员返回空数组） */
function classIdsOfUser(user) {
  if (!user || isAdmin(user)) return [];
  // DISTINCT：同一人可同时以辅导员与班主任身份绑定同一班级，去重避免列表与前端 key 重复
  return dbx.all(
    'SELECT DISTINCT classId FROM classCounselors WHERE userId = ? ORDER BY classId',
    [user.id],
  ).map((r) => r.classId);
}

module.exports = { isAdmin, canManageStudent, sensitiveScope, classIdsOfUser, rosterScope };

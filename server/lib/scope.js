/**
 * 数据权限：按「带班」判定（用户管理分配的所辖班级，classCounselors）。
 * 全量 vs 带班由角色的数据范围配置（roles.dataScopes）决定，解析口径见 permissions.dataScopeOfUser：
 * 管理员或模块主负责 → 全量；角色配 'all' → 全量；未配置 → 带班。
 * 全量仅作用于查看/导出；写操作仍由 canManageStudent 按带班收口。
 */
const dbx = require('./db');
const { dataScopeOfUser } = require('./permissions');

function isAdmin(user) {
  // 主角色规则：集合含 admin 时 users.role 已同步为 admin；roleKeys 兜底防御脏数据
  return user?.role === 'admin' || (Array.isArray(user?.roleKeys) && user.roleKeys.includes('admin'));
}

/**
 * 学生基础信息编辑/删除权：管理员，或该学生的归属班级在用户所辖班级内。
 * 学生 classId 为空（历史数据）时仅管理员可维护。
 * 注意：与查看范围（rosterScope）解耦——名册全量的角色仍只能维护所带班级学生。
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

/**
 * 敏感记录（谈话/预警/审批/资助）过滤：记录所属学生必须在用户可见范围内。
 * moduleKey 传关联业务模块（conversations/warnings/funding）：该模块配置全量范围即全院可见；
 * 不传（如审批，无独立可配模块）沿用原口径：仅管理员全量，其余按带班收口。
 */
function sensitiveScope(user, moduleKey = null, alias = 'x') {
  const wide = moduleKey
    ? dataScopeOfUser(user, moduleKey) === 'all'
    : isAdmin(user);
  if (wide) return { where: '', params: [] };
  return {
    where: `AND EXISTS (SELECT 1 FROM students s WHERE s.id = ${alias}.studentId
      AND s.classId IN (SELECT classId FROM classCounselors WHERE userId = ?))`,
    params: [user.id],
  };
}

/**
 * 名册查看范围：学生模块（students）数据范围为全量 → null（全员可见）；
 * 否则按带班收口（classCounselors），带班为空则可见 0 人。
 * 多角色并存取最宽（任一角色配全量即放行）；学生 classId 为空（历史数据）
 * 对收口用户天然不可见。
 */
function rosterScope(user, alias = 's') {
  if (dataScopeOfUser(user, 'students') === 'all') return null;
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

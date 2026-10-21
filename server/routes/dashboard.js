/** 首页工作台聚合统计（学生数为名册口径：管理员/辅导员全校，其他用户所带班级；谈话/预警/审批按带班口径；待办按创建人隔离） */
const express = require('express');
const dayjs = require('dayjs');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { sensitiveScope, rosterScope } = require('../lib/scope');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('dashboard'));

router.get('/', (req, res) => {
  const todayStr = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const nextMonthStart = dayjs().add(1, 'month').startOf('month').format('YYYY-MM-DD');

  const wScope = sensitiveScope(req.user, 'x');
  // 在读学生数与名册同口径：管理员/辅导员全校，其他用户仅所带班级（rosterScope 需表别名）
  const rScope = rosterScope(req.user, 's');
  const studentCount = dbx.get(
    `SELECT COUNT(*) AS c FROM students s WHERE s.status = '在读'${rScope ? ` AND ${rScope.sql}` : ''}`,
    rScope ? rScope.params : [],
  ).c;

  // 月份用左闭右开区间，命中 conversations(talkTime) 索引；substr 函数会导致全表扫描
  const monthTalkCount = dbx.get(
    `SELECT COUNT(*) AS c FROM conversations x
     WHERE x.talkTime >= ? AND x.talkTime < ? ${wScope.where}`,
    [monthStart, nextMonthStart, ...wScope.params],
  ).c;

  // 预警：全部在 SQL 内聚合。必须 JOIN students 以保持原口径——
  // 学生删除后历史预警保留，原实现用 INNER JOIN 天然排除了找不到学生的记录。
  const activeWarningsFrom = `FROM warnings x JOIN students s ON s.id = x.studentId
     WHERE x.status != '已解除' ${wScope.where}`;
  const pendingWarningCount = dbx.get(
    `SELECT COUNT(*) AS c ${activeWarningsFrom}`,
    [...wScope.params],
  ).c;
  const warningByType = dbx.all(
    `SELECT x.type AS label, COUNT(*) AS count ${activeWarningsFrom}
     GROUP BY x.type ORDER BY MIN(x.rowid)`,
    [...wScope.params],
  );
  const recentWarnings = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className ${activeWarningsFrom}
     ORDER BY x.raisedAt DESC, x.rowid ASC LIMIT 6`,
    [...wScope.params],
  );

  // 谈话类型分布：原实现把全量谈话 type 捞回 Node 再计数，改为 SQL GROUP BY
  const talkByType = dbx.all(
    `SELECT x.type AS label, COUNT(*) AS count FROM conversations x
     WHERE 1 = 1 ${wScope.where} GROUP BY x.type ORDER BY MIN(x.rowid)`,
    [...wScope.params],
  );

  // 待办按创建人严格隔离：只统计当前用户自己创建的待办（与 todos 列表同口径）
  const openTodoWhere = "status = '未完成' AND createdBy = ?";
  const todayTodoCount = dbx.get(
    `SELECT COUNT(*) AS c FROM todos WHERE ${openTodoWhere} AND dueDate <= ?`,
    [req.user.id, todayStr],
  ).c;
  const overdueTodoCount = dbx.get(
    `SELECT COUNT(*) AS c FROM todos WHERE ${openTodoWhere} AND dueDate < ?`,
    [req.user.id, todayStr],
  ).c;
  const todayTodos = dbx.all(
    `SELECT * FROM todos WHERE ${openTodoWhere} AND dueDate <= ?
     ORDER BY dueDate ASC, COALESCE(dueTime, '23:59') ASC, rowid ASC LIMIT 6`,
    [req.user.id, todayStr],
  );

  const pendingApprovalCount = dbx.get(
    `SELECT COUNT(*) AS c FROM approvals x WHERE x.status = '待审批' ${wScope.where}`,
    [...wScope.params],
  ).c;

  res.json({
    studentCount,
    monthTalkCount,
    pendingWarningCount,
    todayTodoCount,
    overdueTodoCount,
    pendingApprovalCount,
    warningByType,
    talkByType,
    recentWarnings,
    todayTodos,
    pendingApprovals: dbx.all(
      `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM approvals x
       JOIN students s ON s.id = x.studentId WHERE x.status = '待审批' ${wScope.where} ORDER BY x.submittedAt DESC LIMIT 6`,
      [...wScope.params],
    ),
  });
});

module.exports = router;

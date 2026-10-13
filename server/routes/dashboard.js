/** 首页工作台聚合统计（按数据可见范围计算） */
const express = require('express');
const dayjs = require('dayjs');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { studentScope, sensitiveScope } = require('../lib/scope');

const router = express.Router();
router.use(auth.authMiddleware);

router.get('/', (req, res) => {
  const todayStr = dayjs().format('YYYY-MM-DD');
  const monthStr = dayjs().format('YYYY-MM');

  const sScope = studentScope(req.user);
  const wScope = sensitiveScope(req.user, 'x');

  const studentCount = dbx.get(
    `SELECT COUNT(*) AS c FROM students s WHERE s.status = '在读' ${sScope.where}`,
    [...sScope.params],
  ).c;

  const monthTalkCount = dbx.get(
    `SELECT COUNT(*) AS c FROM conversations x WHERE substr(x.talkTime, 1, 7) = ? ${wScope.where}`,
    [monthStr, ...wScope.params],
  ).c;

  const activeWarnings = dbx.all(
    `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM warnings x
     JOIN students s ON s.id = x.studentId WHERE x.status != '已解除' ${wScope.where}`,
    [...wScope.params],
  );

  const openTodos = dbx.all("SELECT * FROM todos WHERE status = '未完成'");
  const todayTodosAll = openTodos
    .filter((t) => t.dueDate <= todayStr)
    .sort((a, b) => `${a.dueDate} ${a.dueTime ?? '23:59'}`.localeCompare(`${b.dueDate} ${b.dueTime ?? '23:59'}`));
  const overdueTodoCount = openTodos.filter((t) => t.dueDate < todayStr).length;
  const pendingApprovalCount = dbx.get(
    `SELECT COUNT(*) AS c FROM approvals x WHERE x.status = '待审批' ${wScope.where}`,
    [...wScope.params],
  ).c;

  const countBy = (list) => {
    const map = new Map();
    list.forEach((label) => map.set(label, (map.get(label) ?? 0) + 1));
    return [...map.entries()].map(([label, count]) => ({ label, count }));
  };

  const talkRows = dbx.all(
    `SELECT x.type FROM conversations x WHERE 1 = 1 ${wScope.where}`,
    [...wScope.params],
  );

  res.json({
    studentCount,
    monthTalkCount,
    pendingWarningCount: activeWarnings.length,
    todayTodoCount: todayTodosAll.length,
    overdueTodoCount,
    pendingApprovalCount,
    warningByType: countBy(activeWarnings.map((w) => w.type)),
    talkByType: countBy(talkRows.map((c) => c.type)),
    recentWarnings: [...activeWarnings].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)).slice(0, 6),
    todayTodos: todayTodosAll.slice(0, 6),
    pendingApprovals: dbx.all(
      `SELECT x.*, s.name AS studentName, s.studentNo, s.className FROM approvals x
       JOIN students s ON s.id = x.studentId WHERE x.status = '待审批' ${wScope.where} ORDER BY x.submittedAt DESC LIMIT 6`,
      [...wScope.params],
    ),
  });
});

module.exports = router;

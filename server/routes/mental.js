/**
 * 心理健康：学生关注标记与谈心谈话联动（按「带班」严格限定数据范围）。
 * - 管理员：全校可见可维护
 * - 其他角色：仅 classCounselors（用户管理分配的所辖班级）内的学生，带班为空则看不到任何数据
 * - 谈话记录为只读打通（复用 conversations 表），查看仍需学生在带班范围内
 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { isAdmin, canManageStudent } = require('../lib/scope');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('mentalHealth'));

/** 关注等级（展示顺序即紧急程度从高到低） */
const LEVELS = ['密切关注', '重点关注', '日常关注', '一般关注'];

/** 可见范围条件：管理员 1=1；其他角色 s.classId 必须命中所辖班级（别名固定为 s） */
function classScopeSql(user) {
  if (isAdmin(user)) return { sql: '1 = 1', params: [] };
  return {
    sql: 's.classId IN (SELECT classId FROM classCounselors WHERE userId = ?)',
    params: [user.id],
  };
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

/* ---------- 关注学生列表：等级/关键字/班级筛选 + 分页 ---------- */
router.get('/concerns', (req, res) => {
  const { level, keyword = '', classId } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));

  const scope = classScopeSql(req.user);
  const conds = [scope.sql];
  const params = [...scope.params];
  if (level) { conds.push('mh.level = ?'); params.push(String(level)); }
  if (classId) { conds.push('s.classId = ?'); params.push(Number(classId)); }
  const kw = String(keyword).trim();
  if (kw) {
    conds.push('(s.name LIKE ? OR s.studentNo LIKE ? OR s.className LIKE ?)');
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }
  const where = conds.join(' AND ');

  const total = dbx.get(
    `SELECT COUNT(*) AS c FROM mentalHealth mh JOIN students s ON s.id = mh.studentId WHERE ${where}`,
    params,
  ).c;

  // 与谈心谈话打通：聚合每个学生的谈话次数 / 最近一次 / 需跟进数
  const rows = dbx.all(
    `SELECT s.id AS studentId, s.name, s.studentNo, s.className, s.grade, s.major, s.status,
            mh.level, mh.note, mh.updatedAt, mh.updatedBy,
            t.talkCount, t.lastTalkTime, t.followCount
     FROM mentalHealth mh
     JOIN students s ON s.id = mh.studentId
     LEFT JOIN (
       SELECT studentId,
              COUNT(*) AS talkCount,
              MAX(talkTime) AS lastTalkTime,
              SUM(CASE WHEN needFollowUp = 1 THEN 1 ELSE 0 END) AS followCount
       FROM conversations GROUP BY studentId
     ) t ON t.studentId = mh.studentId
     WHERE ${where}
     ORDER BY CASE mh.level WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 WHEN ? THEN 3 ELSE 4 END,
              mh.updatedAt DESC
     LIMIT ? OFFSET ?`,
    [...params, ...LEVELS, pageSize, (page - 1) * pageSize],
  );

  res.json({
    list: rows.map((r) => ({
      ...r,
      talkCount: r.talkCount ?? 0,
      followCount: r.followCount ?? 0,
    })),
    total,
    page,
    pageSize,
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

/* ---------- 设置 / 调整 / 取消关注标记 ---------- */
router.put('/:studentId', (req, res) => {
  const studentId = String(req.params.studentId ?? '');
  const student = dbx.get('SELECT id, name FROM students WHERE id = ?', [studentId]);
  if (!student) return res.status(404).json({ message: '学生不存在' });
  if (!canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '仅可维护所带班级学生的关注标记' });
  }

  const level = String(req.body?.level ?? '').trim();
  if (level && !LEVELS.includes(level)) {
    return res.status(400).json({ message: `关注等级需为：${LEVELS.join('、')}` });
  }
  const note = String(req.body?.note ?? '').trim();

  if (!level) {
    dbx.run('DELETE FROM mentalHealth WHERE studentId = ?', [studentId]);
    logAccess(req, `取消心理健康关注标记（${student.name}）`);
    return res.json({ ok: true, cleared: true });
  }

  dbx.run(
    `INSERT INTO mentalHealth (studentId, level, note, updatedBy, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(studentId) DO UPDATE SET
       level = excluded.level, note = excluded.note,
       updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
    [studentId, level, note || null, req.user.displayName, nowStr()],
  );
  logAccess(req, `设置心理健康关注标记：${level}（${student.name}）`);
  res.json({ ok: true });
});

/* ---------- 与谈心谈话打通：某学生的全部谈话记录（只读） ---------- */
router.get('/timeline', (req, res) => {
  const studentId = String(req.query.studentId ?? '');
  if (!studentId || !canManageStudent(req.user, studentId)) {
    return res.status(403).json({ message: '仅可查看所带班级学生的谈话记录' });
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

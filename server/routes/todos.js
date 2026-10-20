/** 待办提醒：按创建人严格隔离（仅本人可见 / 可编辑 / 可删除，管理员不加白） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(requirePermission('todos'));

const TODO_TYPES = ['谈话提醒', '材料提交', '会议安排', '宿舍走访', '数据填报', '其他'];
const TODO_PRIORITIES = ['高', '中', '低'];
const TODO_STATUSES = ['未完成', '已完成'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 归属校验：先查待办是否存在（404），再校验创建人是否为当前登录用户（403）。
 * 编辑 / 删除 / 状态切换一律经过此函数，防止越权操作他人任务。
 */
function ownedTodo(req, res) {
  const target = dbx.get('SELECT * FROM todos WHERE id = ?', [req.params.id]);
  if (!target) {
    res.status(404).json({ message: '待办不存在' });
    return null;
  }
  if (Number(target.createdBy) !== Number(req.user.id)) {
    res.status(403).json({ message: '无权操作他人创建的待办' });
    return null;
  }
  return target;
}

/** 列表：关键字 + 类型/优先级/状态筛选（未完成按截止时间升序，已完成沉底）；恒限定当前用户创建 */
router.get('/', (req, res) => {
  const { keyword = '', type, priority, status } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
  const kw = String(keyword).trim();

  // 数据隔离：createdBy 条件无条件置于首位，任何筛选组合都无法绕过
  const conds = ['createdBy = ?'];
  const params = [req.user.id];
  if (kw) { conds.push('(title LIKE ? OR relatedStudent LIKE ? OR note LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  if (type) { conds.push('type = ?'); params.push(type); }
  if (priority) { conds.push('priority = ?'); params.push(priority); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const where = conds.join(' AND ');

  const rows = dbx.all(`SELECT * FROM todos WHERE ${where}`, params);
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === '未完成' ? -1 : 1;
    const timeOf = (t) => `${t.dueDate} ${t.dueTime ?? '23:59'}`;
    if (a.status === '未完成') return timeOf(a).localeCompare(timeOf(b));
    return timeOf(b).localeCompare(timeOf(a));
  });

  res.json({ list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
});

router.post('/', (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  if (!title) return res.status(400).json({ message: '请输入待办事项' });
  if (!String(body.dueDate ?? '').trim()) return res.status(400).json({ message: '请选择截止日期' });
  const type = body.type ?? '其他';
  if (!TODO_TYPES.includes(type)) return res.status(400).json({ message: '待办类型不合法' });
  const priority = body.priority ?? '中';
  if (!TODO_PRIORITIES.includes(priority)) return res.status(400).json({ message: '优先级不合法' });
  const dueTime = body.dueTime == null || body.dueTime === '' ? null : String(body.dueTime);
  if (dueTime !== null && !TIME_RE.test(dueTime)) return res.status(400).json({ message: '截止时间格式应为 HH:mm' });

  const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  dbx.run(`INSERT INTO todos (id, title, type, priority, dueDate, dueTime, status, relatedStudent, note, createdAt, createdBy)
    VALUES (?, ?, ?, ?, ?, ?, '未完成', ?, ?, ?, ?)`,
    [id, title, type, priority, String(body.dueDate).trim(), dueTime,
      strOrNull(body.relatedStudent), strOrNull(body.note), nowStr(), req.user.id],
  );
  logAccess(req, `新增待办「${title}」`);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const target = ownedTodo(req, res);
  if (!target) return;
  const body = req.body ?? {};

  // 标题：传了就必须非空（桌面切换状态只传 status，不触发该校验）
  if (body.title !== undefined && !String(body.title).trim()) {
    return res.status(400).json({ message: '请输入待办事项' });
  }
  if (body.type !== undefined && !TODO_TYPES.includes(body.type)) {
    return res.status(400).json({ message: '待办类型不合法' });
  }
  if (body.priority !== undefined && !TODO_PRIORITIES.includes(body.priority)) {
    return res.status(400).json({ message: '优先级不合法' });
  }
  if (body.status !== undefined && !TODO_STATUSES.includes(body.status)) {
    return res.status(400).json({ message: '待办状态不合法' });
  }
  if (body.dueTime != null && body.dueTime !== '' && !TIME_RE.test(String(body.dueTime))) {
    return res.status(400).json({ message: '截止时间格式应为 HH:mm' });
  }

  // 注意：UPDATE 不含 createdBy —— 归属不可通过接口转让
  dbx.run(`UPDATE todos SET title = ?, type = ?, priority = ?, dueDate = ?, dueTime = ?, status = ?, relatedStudent = ?, note = ? WHERE id = ?`,
    [body.title !== undefined ? String(body.title).trim() : target.title,
      body.type ?? target.type, body.priority ?? target.priority,
      body.dueDate ?? target.dueDate, body.dueTime !== undefined ? body.dueTime : target.dueTime,
      body.status ?? target.status,
      body.relatedStudent !== undefined ? strOrNull(body.relatedStudent) : target.relatedStudent,
      body.note !== undefined ? strOrNull(body.note) : target.note,
      req.params.id],
  );
  logAccess(req, `更新待办「${target.title}」`);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = ownedTodo(req, res);
  if (!target) return;
  dbx.run('DELETE FROM todos WHERE id = ?', [req.params.id]);
  logAccess(req, `删除待办「${target.title}」`);
  res.json({ ok: true });
});

/** 选填文本字段：空串 / 空白统一落 NULL */
function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

module.exports = router;

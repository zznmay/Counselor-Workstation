/** 实用工具-辅导员智能排班：共享数据文档读写 */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess, nowStr } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);

router.get('/', (req, res) => {
  const row = dbx.get('SELECT * FROM csScheduler WHERE id = 1');
  res.json({ data: row?.data ? JSON.parse(row.data) : null, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null });
});

router.put('/', (req, res) => {
  const data = req.body?.data;
  if (typeof data !== 'object' || data === null) {
    return res.status(400).json({ message: '数据格式无效' });
  }
  dbx.run(`INSERT INTO csScheduler (id, data, updatedAt, updatedBy) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`,
    [JSON.stringify(data), nowStr(), req.user.displayName],
  );
  logAccess(req, '保存排班工具数据');
  res.json({ ok: true, updatedAt: nowStr() });
});

module.exports = router;

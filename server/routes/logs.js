/** 访问日志查询（仅管理员） */
const express = require('express');

const dbx = require('../lib/db');
const auth = require('../lib/auth');
const { logAccess } = require('../lib/audit');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(auth.adminOnly);

router.get('/', (req, res) => {
  const { username = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));
  const kw = String(username).trim();

  const conds = ['1 = 1'];
  const params = [];
  if (kw) { conds.push('username LIKE ?'); params.push(`%${kw}%`); }
  const where = conds.join(' AND ');

  const total = dbx.get(`SELECT COUNT(*) AS c FROM accessLogs WHERE ${where}`, params).c;
  const rows = dbx.all(
    `SELECT * FROM accessLogs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ list: rows, total, page, pageSize });
});

module.exports = router;

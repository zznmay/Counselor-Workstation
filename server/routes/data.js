/**
 * 数据管理接口（备份 / 恢复 / 迁移 / 自动备份 / 操作日志）—— 仅管理员。
 *
 * 分层约定：本文件只做「解析请求 → 调 datamgmt → 组装响应」，业务逻辑全部在 lib/datamgmt.js。
 * 鉴权沿用 auth.authMiddleware + auth.adminOnly（与 users/roles/logs 同口径），
 * 写操作除自动审计（auditWrite）外，另记一份数据管理操作日志（oplog）。
 */
const express = require('express');

const auth = require('../lib/auth');
const { logAccess } = require('../lib/audit');
const dm = require('../lib/datamgmt');
const dbx = require('../lib/db');

const router = express.Router();
router.use(auth.authMiddleware);
router.use(auth.adminOnly);

/** 当前操作人（用于 oplog 与包内 exportedBy） */
const actorOf = (req) => req.user?.username ?? null;

/** 统一错误出口：带 status 的按原码返回，其余按 400（入参/校验问题） */
function fail(res, e, fallback = '操作失败') {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 400;
  res.status(status).json({ message: e.message || fallback });
}

/* ==================== 总览 ==================== */

router.get('/overview', (_req, res) => {
  try {
    res.json(dm.overview());
  } catch (e) {
    fail(res, e, '总览加载失败');
  }
});

/* ==================== 数据包列表 / 新增 / 编辑 / 删除 / 下载 ==================== */

/** 列表：关键词 + 类型 + 时间区间 + 分页 + 排序 */
router.get('/bundles', (req, res) => {
  try {
    res.json(dm.listBundles({
      keyword: req.query.keyword,
      kind: req.query.kind,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      pageSize: req.query.pageSize,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
    }));
  } catch (e) {
    fail(res, e, '数据包列表加载失败');
  }
});

/** 新增：立即创建一份备份 / 迁移包（label 必填，note 选填） */
router.post('/bundles', (req, res) => {
  try {
    const { label, note, kind } = req.body ?? {};
    if (!String(label ?? '').trim()) {
      return res.status(400).json({ message: '请填写数据包标签' });
    }
    const finalKind = dm.BUNDLE_KINDS.includes(kind) ? kind : (kind === '迁移包' ? '迁移包' : '手动备份');
    const row = dm.createBackup({ kind: finalKind, label, note, actor: actorOf(req) });
    logAccess(req, `创建数据包「${row.label}」`, '成功');
    res.json(row);
  } catch (e) {
    fail(res, e, '创建备份失败');
  }
});

/** 编辑：仅改标签与备注（包体内容不可变，保证 sha256 可复核） */
router.patch('/bundles/:id', (req, res) => {
  try {
    const row = dm.updateBundle(req.params.id, req.body ?? {}, actorOf(req));
    logAccess(req, `编辑数据包 #${req.params.id}`, '成功');
    res.json(row);
  } catch (e) {
    fail(res, e, '编辑数据包失败');
  }
});

/** 删除：同时清理落盘文件 */
router.delete('/bundles/:id', (req, res) => {
  try {
    const out = dm.deleteBundle(req.params.id, actorOf(req));
    logAccess(req, `删除数据包 #${req.params.id}`, '成功');
    res.json(out);
  } catch (e) {
    fail(res, e, '删除数据包失败');
  }
});

/** 下载数据包文件 */
router.get('/bundles/:id/download', (req, res) => {
  try {
    const { row, filePath } = dm.bundleFilePath(req.params.id);
    logAccess(req, `下载数据包 #${row.id}`, '成功');
    res.download(filePath, row.fileName);
  } catch (e) {
    fail(res, e, '下载失败');
  }
});

/** 上传数据包：base64（可 gzip）→ 校验后登记，供后续恢复使用 */
router.post('/bundles/upload', (req, res) => {
  try {
    const row = dm.saveUploadedBundle({
      fileName: req.body?.fileName,
      contentBase64: req.body?.contentBase64,
      label: req.body?.label,
      note: req.body?.note,
      actor: actorOf(req),
    });
    logAccess(req, `上传数据包 #${row.id}`, '成功');
    res.json(row);
  } catch (e) {
    fail(res, e, '上传失败');
  }
});

/* ==================== 恢复：预检（不落盘）→ 确认恢复 ==================== */

/** 解析数据源：已有包 id / 直接上传内容 / 指定文件名 */
function resolveBundleSource(body = {}) {
  if (body.bundleId) return dm.readBundleById(body.bundleId);
  if (body.contentBase64) {
    const raw = Buffer.from(String(body.contentBase64), 'base64');
    const text = raw[0] === 0x1f && raw[1] === 0x8b
      ? require('zlib').gunzipSync(raw).toString('utf8')
      : raw.toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error('内容不是合法 JSON 数据包');
      err.status = 400;
      throw err;
    }
  }
  const err = new Error('请提供 bundleId 或 contentBase64');
  err.status = 400;
  throw err;
}

router.post('/restore/preview', (req, res) => {
  try {
    const bundle = resolveBundleSource(req.body ?? {});
    res.json(dm.previewRestore(bundle));
  } catch (e) {
    fail(res, e, '恢复预检失败');
  }
});

router.post('/restore', (req, res) => {
  try {
    const bundle = resolveBundleSource(req.body ?? {});
    const out = dm.restore({ bundle, confirm: (req.body ?? {}).confirm, actor: actorOf(req) });
    logAccess(req, `恢复数据（来源包「${bundle.label ?? '未命名'}」）`, '成功');
    res.json(out);
  } catch (e) {
    fail(res, e, '恢复失败');
  }
});

/* ==================== 自动备份策略 ==================== */

router.get('/autobackup', (_req, res) => {
  res.json(dm.getAutoBackup());
});

router.post('/autobackup', (req, res) => {
  try {
    const cfg = dm.setAutoBackup(req.body ?? {}, actorOf(req));
    dm.scheduleAuto();
    logAccess(req, '配置自动备份', '成功');
    res.json(cfg);
  } catch (e) {
    fail(res, e, '配置保存失败');
  }
});

router.post('/autobackup/run', (req, res) => {
  try {
    const out = dm.runAutoBackup(actorOf(req));
    logAccess(req, '立即执行自动备份', '成功');
    res.json(out);
  } catch (e) {
    fail(res, e, '执行失败');
  }
});

/* ==================== 操作日志 ==================== */

router.get('/oplog', (req, res) => {
  try {
    res.json(dm.listOplog(req.query.limit));
  } catch (e) {
    fail(res, e, '操作日志加载失败');
  }
});

/** 各表条数（前端「数据总览」表格用，与 overview.counts 同口径） */
router.get('/counts', (_req, res) => {
  const counts = {};
  for (const table of dm.EXPORT_TABLES) counts[table] = dbx.get(`SELECT COUNT(*) AS c FROM ${table}`).c;
  res.json(counts);
});

module.exports = router;

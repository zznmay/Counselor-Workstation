import { Popconfirm } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDataBundle,
  deleteDataBundle,
  downloadBundleBytes,
  getDataBundles,
  getDataOplog,
  getDataOverview,
  getAutoBackup,
  previewRestore,
  restoreData,
  runAutoBackup,
  saveAutoBackup,
  updateDataBundle,
} from '@/api/data';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import {
  AUTO_BACKUP_INTERVALS,
  AUTO_BACKUP_KEEP_MAX,
  AUTO_BACKUP_KEEP_MIN,
  BUNDLE_CREATE_KINDS,
  BUNDLE_KINDS,
  RESTORE_CONFIRM_PHRASE,
} from '@/constants';
import type {
  AutoBackupConfig,
  BundleKind,
  DataBundle,
  DataOplogItem,
  DataOverview,
  RestorePreview,
} from '@/types';

const PAGE_SIZE = 10;

/** 语义标签色：与桌面端 Tag 色彩体系一致 */
const KIND_TAG: Record<BundleKind, string> = {
  手动备份: 'info',
  自动备份: 'info',
  恢复前快照: 'warning',
  迁移包: 'neutral',
  上传包: 'success',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const totalOf = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((a, b) => a + b, 0);

/**
 * 移动端数据管理：分段三视图（数据包 / 总览 / 日志）。
 * 数据包 = 搜索 + 类型筛选 + 卡片（下载 / 恢复 / 编辑 / 删除）；
 * 恢复沿用桌面同口径的三段式：预检 → 确认短语「恢复」→ 执行（服务端自动前快照）。
 */
export default function AdminDataMobile() {
  const [tab, setTab] = useState<'bundles' | 'overview' | 'oplog'>('bundles');
  const [toast, setToast] = useState('');

  const [list, setList] = useState<DataBundle[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<{ kind?: BundleKind; startDate?: string; endDate?: string }>({});
  const [filterDraft, setFilterDraft] = useState<{ kind?: BundleKind; startDate?: string; endDate?: string }>({});
  const [filterOpen, setFilterOpen] = useState(false);

  const [overview, setOverview] = useState<DataOverview | null>(null);
  const [oplog, setOplog] = useState<DataOplogItem[]>([]);

  /* 表单 */
  const [sheet, setSheet] = useState<{ open: boolean; mode: 'create' | 'edit'; bundle: DataBundle | null }>({
    open: false,
    mode: 'create',
    bundle: null,
  });
  const [draft, setDraft] = useState<{ label: string; kind: BundleKind; note: string }>({
    label: '',
    kind: '手动备份',
    note: '',
  });
  const [errors, setErrors] = useState<{ label?: string }>({});
  const [saving, setSaving] = useState(false);

  /* 恢复 */
  const [restoreTarget, setRestoreTarget] = useState<DataBundle | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  /* 自动备份 */
  const [autoCfg, setAutoCfg] = useState<AutoBackupConfig | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  const fetchPage = useCallback(
    async (targetPage: number, kw: string, f: { kind?: BundleKind; startDate?: string; endDate?: string }) => {
      setLoading(true);
      try {
        const res = await getDataBundles({
          page: targetPage,
          pageSize: PAGE_SIZE,
          ...(kw ? { keyword: kw } : {}),
          ...f,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
        setTotal(res.total);
        setPage(targetPage);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadMeta = useCallback(async () => {
    try {
      const [ov, log, cfg] = await Promise.all([getDataOverview(), getDataOplog(30), getAutoBackup()]);
      setOverview(ov);
      setOplog(log);
      setAutoCfg(cfg);
    } catch {
      /* 总览失败不阻断列表 */
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchPage(1, keyword, filters), keyword ? 400 : 0);
    return () => window.clearTimeout(t);
  }, [keyword, filters, fetchPage]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchPage(page + 1, keyword, filters);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, keyword, filters, fetchPage]);

  const openCreate = () => {
    setSheet({ open: true, mode: 'create', bundle: null });
    setDraft({ label: '', kind: '手动备份', note: '' });
    setErrors({});
  };

  const openEdit = (b: DataBundle) => {
    setSheet({ open: true, mode: 'edit', bundle: b });
    setDraft({ label: b.label, kind: b.kind, note: b.note ?? '' });
    setErrors({});
  };

  const closeSheet = () => {
    if (saving) return;
    setSheet({ open: false, mode: 'create', bundle: null });
  };

  const submit = async () => {
    if (!draft.label.trim()) {
      setErrors({ label: '请填写数据包标签' });
      return;
    }
    setSaving(true);
    try {
      if (sheet.mode === 'edit' && sheet.bundle) {
        await updateDataBundle(sheet.bundle.id, { label: draft.label.trim(), note: draft.note || null });
        showToast('数据包信息已更新');
      } else {
        await createDataBundle({ label: draft.label.trim(), kind: draft.kind, note: draft.note || null });
        showToast('备份已创建');
      }
      setSheet({ open: false, mode: 'create', bundle: null });
      await fetchPage(1, keyword, filters);
      void loadMeta();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b: DataBundle) => {
    try {
      await deleteDataBundle(b.id);
      showToast(`数据包「${b.label}」已删除`);
      await fetchPage(1, keyword, filters);
      void loadMeta();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handlePreview = async (b: DataBundle) => {
    setPreviewing(true);
    try {
      setPreview(await previewRestore({ bundleId: b.id }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '预检失败');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleRestore = async (b: DataBundle) => {
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      showToast(`请输入确认短语「${RESTORE_CONFIRM_PHRASE}」`);
      return;
    }
    setRestoring(true);
    try {
      const res = await restoreData({ bundleId: b.id, confirm: confirmText });
      showToast(`恢复完成，已生成前快照 #${res.snapshotId}`);
      setRestoreTarget(null);
      setPreview(null);
      setConfirmText('');
      await fetchPage(1, keyword, filters);
      void loadMeta();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '恢复失败');
    } finally {
      setRestoring(false);
    }
  };

  const saveAuto = async () => {
    if (!autoCfg) return;
    setAutoSaving(true);
    try {
      setAutoCfg(await saveAutoBackup({ enabled: autoCfg.enabled, intervalHours: autoCfg.intervalHours, keep: autoCfg.keep }));
      showToast('自动备份策略已保存');
      setAutoOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setAutoSaving(false);
    }
  };

  return (
    <>
      <div className="m-seg">
        <button type="button" className={`m-seg-btn${tab === 'bundles' ? ' on' : ''}`} onClick={() => setTab('bundles')}>
          数据包
        </button>
        <button type="button" className={`m-seg-btn${tab === 'overview' ? ' on' : ''}`} onClick={() => setTab('overview')}>
          总览
        </button>
        <button type="button" className={`m-seg-btn${tab === 'oplog' ? ' on' : ''}`} onClick={() => setTab('oplog')}>
          日志
        </button>
      </div>

      {tab === 'bundles' && (
        <>
          <div className="m-search-row" style={{ marginTop: 10 }}>
            <div className="m-search-field">
              <MIcon name="search" size={16} />
              <input
                className="m-inp"
                value={keyword}
                placeholder="搜索标签 / 备注 / 文件名"
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索数据包"
              />
            </div>
            <button
              type="button"
              className="m-btn m-btn-soft"
              onClick={() => {
                setFilterDraft(filters);
                setFilterOpen(true);
              }}
            >
              <MIcon name="funnel" size={16} />
              筛选
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span className="m-t4" style={{ flex: 1, minWidth: 0 }}>
              共 {total} 个数据包 · 恢复前自动快照
            </span>
            <button type="button" className="m-btn m-btn-primary" onClick={openCreate}>
              <MIcon name="plus" size={14} />
              创建备份
            </button>
          </div>

          {list.length === 0 && !loading ? (
            <div className="m-card empty">
              <MIcon name="shield" size={22} />
              <div className="m-t3" style={{ marginTop: 6 }}>
                {keyword || filters.kind ? '没有符合条件的数据包' : '还没有数据包'}
              </div>
              {!keyword && !filters.kind && (
                <div className="m-t4" style={{ marginTop: 4 }}>
                  点击「创建备份」生成第一份全量快照
                </div>
              )}
            </div>
          ) : (
            list.map((b) => (
              <div className="m-card" key={b.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="m-ava">
                    <MIcon name="shield" size={16} />
                  </span>
                  <div className="m-row-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="m-t1">{b.label}</span>
                      <span className={`m-tag ${KIND_TAG[b.kind]}`}>{b.kind}</span>
                    </div>
                    <div className="m-t4" style={{ marginTop: 3 }}>
                      {formatBytes(b.sizeBytes)} · {totalOf(b.counts)} 条 · {b.createdAt}
                    </div>
                    {b.note && <div className="m-t4" style={{ marginTop: 2 }}>{b.note}</div>}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    marginTop: 6,
                    borderTop: '1px solid var(--m-border)',
                    paddingTop: 4,
                  }}
                >
                  <a
                    className="m-act"
                    onClick={() =>
                      void downloadBundleBytes(b.id, b.fileName).catch((e: Error) => showToast(e.message))
                    }
                    aria-label={`下载数据包 ${b.label}`}
                  >
                    <MIcon name="download" size={18} />
                    下载
                  </a>
                  <a
                    className="m-act"
                    onClick={() => {
                      setRestoreTarget(b);
                      setPreview(null);
                      setConfirmText('');
                    }}
                    aria-label={`恢复数据包 ${b.label}`}
                  >
                    <MIcon name="refresh" size={18} />
                    恢复
                  </a>
                  <a className="m-act" onClick={() => openEdit(b)} aria-label={`编辑数据包 ${b.label}`}>
                    <MIcon name="edit" size={18} />
                    编辑
                  </a>
                  <Popconfirm title={`删除数据包「${b.label}」？`} onConfirm={() => void handleDelete(b)}>
                    <a className="m-act danger" aria-label={`删除数据包 ${b.label}`}>
                      <MIcon name="trash" size={18} />
                      删除
                    </a>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="m-loadmore">
              <MIcon name="spinner" size={16} className="m-spin" />
              加载中…
            </div>
          )}
          <div ref={sentinel} style={{ height: 1 }} />
          {!loading && hasMore && (
            <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void fetchPage(page + 1, keyword, filters)}>
              加载更多（还有 {total - list.length} 个）
            </button>
          )}
        </>
      )}

      {tab === 'overview' && (
        <>
          {overview ? (
            <>
              <div className="m-card" style={{ marginTop: 10, padding: 0, overflow: 'hidden' }}>
                <div className="m-stat-grid">
                  <div className="m-stat-cell">
                    <div className="m-stat-v">{overview.tables.length}</div>
                    <div className="m-stat-l">业务表（张）</div>
                  </div>
                  <div className="m-stat-cell">
                    <div className="m-stat-v">{Object.values(overview.counts).reduce((a, b) => a + b, 0)}</div>
                    <div className="m-stat-l">业务记录（条）</div>
                  </div>
                  <div className="m-stat-cell">
                    <div className="m-stat-v">{formatBytes(overview.db.sizeBytes)}</div>
                    <div className="m-stat-l">数据库体积</div>
                  </div>
                  <div className="m-stat-cell">
                    <div className="m-stat-v">{overview.bundles.total}</div>
                    <div className="m-stat-l">数据包（个）</div>
                  </div>
                </div>
              </div>

              <div className="m-card">
                <div className="m-sec-title" style={{ marginBottom: 6 }}>
                  <MIcon name="grid" size={15} />
                  各表条数
                </div>
                {Object.entries(overview.counts).map(([table, count]) => (
                  <div className="m-kv" key={table}>
                    <span className="m-kv-k" style={{ minWidth: 140 }}>{table}</span>
                    <span className="m-kv-v">{count}</span>
                  </div>
                ))}
              </div>

              <div className="m-card">
                <div className="m-sec-title" style={{ marginBottom: 6 }}>
                  <MIcon name="clock" size={15} />
                  自动备份
                </div>
                <div className="m-t4">
                  {autoCfg?.enabled
                    ? `已开启 · 每 ${autoCfg.intervalHours} 小时 · 保留 ${autoCfg.keep} 份`
                    : '未开启'}
                  {autoCfg?.lastRunAt ? ` · 上次 ${autoCfg.lastRunAt}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="m-btn m-btn-soft" style={{ flex: 1 }} onClick={() => setAutoOpen(true)}>
                    配置策略
                  </button>
                  <button
                    type="button"
                    className="m-btn m-btn-primary"
                    style={{ flex: 1 }}
                    onClick={async () => {
                      const res = await runAutoBackup();
                      showToast(res.skipped ? '内容未变化，已跳过写包' : `已生成备份 #${res.bundleId}`);
                      await fetchPage(1, keyword, filters);
                      void loadMeta();
                    }}
                  >
                    立即执行
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="m-loadmore">
              <MIcon name="spinner" size={16} className="m-spin" />
              加载中…
            </div>
          )}
        </>
      )}

      {tab === 'oplog' && (
        <div className="m-card" style={{ marginTop: 10 }}>
          <div className="m-sec-title" style={{ marginBottom: 6 }}>
            <MIcon name="file" size={15} />
            数据管理操作日志
          </div>
          {oplog.length === 0 ? (
            <div className="m-t4" style={{ padding: '20px 0', textAlign: 'center' }}>
              暂无操作记录
            </div>
          ) : (
            oplog.map((o) => (
              <div className="m-kv" key={o.id} style={{ alignItems: 'flex-start' }}>
                <div className="m-row-main">
                  <div className="m-t3">
                    {o.action}
                    <span className="m-t4" style={{ marginLeft: 8, fontWeight: 400 }}>
                      {o.actor || '系统'} · {o.ts}
                    </span>
                  </div>
                  {o.summary && <div className="m-t4" style={{ marginTop: 2 }}>{o.summary}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 筛选面板 */}
      <FilterSheet
        open={filterOpen}
        title="筛选数据包"
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setFilterDraft({})}>
              重置
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              onClick={() => {
                setFilters(filterDraft);
                setFilterOpen(false);
              }}
            >
              确定
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>数据包类型</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`m-seg-btn${filterDraft.kind === undefined ? ' on' : ''}`}
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
              onClick={() => setFilterDraft({ ...filterDraft, kind: undefined })}
            >
              全部
            </button>
            {BUNDLE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`m-seg-btn${filterDraft.kind === k ? ' on' : ''}`}
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
                onClick={() => setFilterDraft({ ...filterDraft, kind: k })}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="m-field">
          <label>创建时间（起）</label>
          <input
            type="date"
            className="m-inp"
            value={filterDraft.startDate ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, startDate: e.target.value || undefined })}
          />
        </div>
        <div className="m-field">
          <label>创建时间（止）</label>
          <input
            type="date"
            className="m-inp"
            value={filterDraft.endDate ?? ''}
            onChange={(e) => setFilterDraft({ ...filterDraft, endDate: e.target.value || undefined })}
          />
        </div>
      </FilterSheet>

      {/* 新增 / 编辑 */}
      <FilterSheet
        open={sheet.open}
        title={sheet.mode === 'edit' ? '编辑数据包' : '创建备份'}
        fullscreen
        dismissible={false}
        onClose={closeSheet}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" disabled={saving} onClick={closeSheet}>
              取消
            </button>
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={submit}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>
            数据包标签
            <span className="m-req">*</span>
          </label>
          <input
            className="m-inp"
            value={draft.label}
            maxLength={40}
            placeholder="如：学期初全量备份"
            onChange={(e) => {
              setDraft({ ...draft, label: e.target.value });
              if (errors.label) setErrors({});
            }}
          />
          <div className="m-form-err">
            {errors.label && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.label}
              </>
            )}
          </div>
        </div>

        {sheet.mode === 'create' && (
          <div className="m-field">
            <label>数据包类型</label>
            <div className="m-seg">
              {BUNDLE_CREATE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`m-seg-btn${draft.kind === k ? ' on' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: k })}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="m-field">
          <label>备注（选填）</label>
          <textarea
            className="m-inp"
            rows={2}
            maxLength={100}
            value={draft.note}
            placeholder="用途说明"
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </div>
      </FilterSheet>

      {/* 恢复：预检 → 确认短语 → 执行 */}
      <FilterSheet
        open={!!restoreTarget}
        title="恢复数据"
        fullscreen
        dismissible={false}
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setRestoreTarget(null)}>
              取消
            </button>
            <button
              type="button"
              className="m-btn m-btn-soft"
              disabled={!restoreTarget || previewing}
              onClick={() => restoreTarget && void handlePreview(restoreTarget)}
            >
              {previewing ? '预检中…' : '恢复预检'}
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              disabled={!preview?.ok || restoring}
              onClick={() => restoreTarget && void handleRestore(restoreTarget)}
            >
              {restoring ? '恢复中…' : '确认恢复'}
            </button>
          </>
        }
      >
        {restoreTarget && (
          <>
            <div className="m-card" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-bd)', color: 'var(--warning-fg)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <MIcon name="alertTriangle" size={16} style={{ flex: '0 0 auto', marginTop: 2 }} />
                <span className="m-t4" style={{ lineHeight: 1.7 }}>
                  恢复会用「{restoreTarget.label}」整体替换当前业务数据；服务端会先自动生成恢复前快照，如需回滚可再恢复该快照。
                </span>
              </div>
            </div>

            {preview && (
              <div className="m-card">
                <div className="m-sec-title" style={{ marginBottom: 6 }}>
                  <MIcon name="check" size={15} />
                  校验结果：{preview.ok ? '通过' : '未通过（禁止恢复）'}
                </div>
                {preview.checks.filter((c) => !c.ok).map((c) => (
                  <div className="m-t4" key={c.item} style={{ color: 'var(--danger-fg)' }}>
                    {c.item} · {c.detail}
                  </div>
                ))}
                {preview.diff.length > 0 && (
                  <>
                    <div className="m-sec-title" style={{ marginTop: 8, marginBottom: 4 }}>
                      条数变化（{preview.diff.length} 张表）
                    </div>
                    {preview.diff.slice(0, 12).map((d) => (
                      <div className="m-kv" key={d.table}>
                        <span className="m-kv-k" style={{ minWidth: 140 }}>{d.table}</span>
                        <span className="m-kv-v">
                          {d.current} → {d.incoming}（{d.delta > 0 ? `+${d.delta}` : d.delta}）
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="m-field">
              <label>
                请输入「{RESTORE_CONFIRM_PHRASE}」以确认恢复
                <span className="m-req">*</span>
              </label>
              <input
                className="m-inp"
                value={confirmText}
                placeholder={RESTORE_CONFIRM_PHRASE}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>
          </>
        )}
      </FilterSheet>

      {/* 自动备份配置 */}
      <FilterSheet
        open={autoOpen}
        title="自动备份策略"
        onClose={() => setAutoOpen(false)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setAutoOpen(false)}>
              取消
            </button>
            <button type="button" className="m-btn m-btn-primary" disabled={autoSaving} onClick={() => void saveAuto()}>
              {autoSaving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {autoCfg && (
          <>
            <div className="m-field">
              <label>启用状态</label>
              <div className="m-seg">
                <button
                  type="button"
                  className={`m-seg-btn${autoCfg.enabled ? ' on' : ''}`}
                  onClick={() => setAutoCfg({ ...autoCfg, enabled: true })}
                >
                  开启
                </button>
                <button
                  type="button"
                  className={`m-seg-btn${!autoCfg.enabled ? ' on' : ''}`}
                  onClick={() => setAutoCfg({ ...autoCfg, enabled: false })}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="m-field">
              <label>备份间隔（小时）</label>
              <div className="m-seg" style={{ flexWrap: 'wrap' }}>
                {AUTO_BACKUP_INTERVALS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`m-seg-btn${autoCfg.intervalHours === h ? ' on' : ''}`}
                    style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
                    onClick={() => setAutoCfg({ ...autoCfg, intervalHours: h })}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div className="m-field">
              <label>
                保留份数（{AUTO_BACKUP_KEEP_MIN}–{AUTO_BACKUP_KEEP_MAX}）
              </label>
              <input
                type="number"
                className="m-inp"
                min={AUTO_BACKUP_KEEP_MIN}
                max={AUTO_BACKUP_KEEP_MAX}
                value={autoCfg.keep}
                onChange={(e) => setAutoCfg({ ...autoCfg, keep: Number(e.target.value) })}
              />
            </div>
          </>
        )}
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

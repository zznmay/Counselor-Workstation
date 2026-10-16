import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getWarnings, updateWarning } from '@/api/warning';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import type { MIconName } from '@/components/mobile/icons';
import type { Warning, WarningLevel, WarningStatus } from '@/types';

const PAGE_SIZE = 10;

/** 预警三级：颜色 + 图标 + 文字三编码（不靠颜色单独表意） */
const LEVEL_META: Record<WarningLevel, { icon: MIconName; tag: string; bar: string; text: string }> = {
  红色: { icon: 'alertTriangle', tag: 'lv-red', bar: 'm-wbar-red', text: '红色预警' },
  橙色: { icon: 'alertCircle', tag: 'lv-orange', bar: 'm-wbar-orange', text: '橙色预警' },
  黄色: { icon: 'flag', tag: 'lv-yellow', bar: 'm-wbar-yellow', text: '黄色预警' },
};

const STATUS_FILTERS: { key: WarningStatus | '全部'; label: string }[] = [
  { key: '待处理', label: '待处理' },
  { key: '处理中', label: '处理中' },
  { key: '已解除', label: '已解除' },
  { key: '全部', label: '全部' },
];

/**
 * 移动端预警管理：三级卡片 + 处置闭环（记录措施 → 处理中 / 销号 → 已解除）。
 * 处置与销号在同卡完成，打开底部面板填写措施，避免跳页。
 */
export default function WarningsMobile() {
  const [searchParams] = useSearchParams();
  const [list, setList] = useState<Warning[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  /* 初始状态与桌面端一致：由 URL 的 status 参数驱动（工作台「去处理」会带上） */
  const [status, setStatus] = useState<WarningStatus | '全部'>(
    (searchParams.get('status') as WarningStatus) || '待处理',
  );
  /* 从学生卡片/详情「标记预警」进入时按学生过滤（接口无该筛选条件，故在客户端收敛） */
  const [studentFilter, setStudentFilter] = useState<string | null>(searchParams.get('studentId'));
  const [studentName, setStudentName] = useState<string | null>(null);

  const [panel, setPanel] = useState<{ warning: Warning; mode: 'progress' | 'close' } | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [toast, setToast] = useState('');

  const fetchPage = useCallback(async (targetPage: number, st: WarningStatus | '全部') => {
    setLoading(true);
    try {
      const res = await getWarnings({
        page: targetPage,
        pageSize: PAGE_SIZE,
        ...(st === '全部' ? {} : { status: st }),
      });
      setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
      setTotal(res.total);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(1, status);
  }, [status, fetchPage]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchPage(page + 1, status);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, status, fetchPage]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  /* 客户端按学生收敛（接口无 studentId 筛选条件）；同时回填学生姓名用于提示条 */
  const visibleList = useMemo(
    () => (studentFilter ? list.filter((w) => w.studentId === studentFilter) : list),
    [list, studentFilter],
  );
  useEffect(() => {
    if (studentFilter && !studentName) {
      const hit = list.find((w) => w.studentId === studentFilter);
      if (hit) setStudentName(hit.studentName);
    }
  }, [list, studentFilter, studentName]);

  const openPanel = (warning: Warning, mode: 'progress' | 'close') => {
    setPanel({ warning, mode });
    setNote(warning.handleNote ?? '');
    setNoteError('');
  };

  const submit = async () => {
    if (!panel) return;
    const text = note.trim();
    if (panel.mode === 'close' && !text) {
      setNoteError('销号必须填写处理措施，便于留痕与复核');
      return;
    }
    setSaving(true);
    try {
      const nextStatus: WarningStatus = panel.mode === 'close' ? '已解除' : '处理中';
      await updateWarning(panel.warning.id, {
        studentId: panel.warning.studentId,
        type: panel.warning.type,
        level: panel.warning.level,
        reason: panel.warning.reason,
        raisedAt: panel.warning.raisedAt,
        status: nextStatus,
        handleNote: text || panel.warning.handleNote,
      });
      setPanel(null);
      showToast(panel.mode === 'close' ? '已销号，预警状态更新为「已解除」' : '已记录措施，预警状态更新为「处理中」');
      await fetchPage(1, status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="m-seg">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`m-seg-btn${status === f.key ? ' on' : ''}`}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {studentFilter && (
        <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MIcon name="funnel" size={16} />
          <span className="m-t3" style={{ flex: 1 }}>
            仅显示 {studentName ?? '该学生'} 的预警
          </span>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            onClick={() => {
              setStudentFilter(null);
              setStudentName(null);
            }}
          >
            查看全部
          </button>
        </div>
      )}

      <div className="m-t4">
        共 {studentFilter ? visibleList.length : total} 条预警
        {status === '全部' ? '' : `（${status}）`}
      </div>

      {visibleList.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {studentFilter ? '该学生暂无符合条件的预警' : status === '已解除' ? '暂无已解除记录' : '当前没有需要处理的预警'}
          </div>
        </div>
      ) : (
        visibleList.map((w) => {
          const meta = LEVEL_META[w.level];
          const closed = w.status === '已解除';
          return (
            <div className={`m-card${closed ? '' : ' accent'}`} key={w.id} style={closed ? { opacity: 0.92, borderStyle: 'dashed' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`m-wbar ${meta.bar}`} />
                <span className={`m-ava${w.level === '红色' ? ' red' : w.level === '橙色' ? ' orange' : ''}`}>
                  {w.studentName.slice(0, 1)}
                </span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{w.studentName}</span>
                    <span className={`m-tag ${meta.tag}`}>
                      <MIcon name={meta.icon} size={12} />
                      {meta.text}
                    </span>
                    <span className={`m-tag ${closed ? 'success' : w.status === '处理中' ? 'info' : 'danger'}`}>
                      {w.status}
                    </span>
                  </div>
                  <div className="m-t4" style={{ marginTop: 3 }}>
                    {w.className} · {w.type} · {w.raisedAt.slice(0, 16)}
                  </div>
                </div>
              </div>

              <div className="m-t3" style={{ marginTop: 8, lineHeight: 1.7 }}>{w.reason}</div>

              {w.handleNote && (
                <div className="m-t4" style={{ marginTop: 6, padding: '6px 8px', background: 'var(--m-sunken)', borderRadius: 8 }}>
                  处理措施：{w.handleNote}
                </div>
              )}

              {!closed && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="m-btn m-btn-soft" style={{ flex: 1 }} onClick={() => openPanel(w, 'progress')}>
                    <MIcon name="edit" size={16} />
                    记录措施
                  </button>
                  <button type="button" className="m-btn m-btn-primary" style={{ flex: 1 }} onClick={() => openPanel(w, 'close')}>
                    <MIcon name="check" size={16} />
                    处置销号
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {loading && (
        <div className="m-loadmore">
          <MIcon name="spinner" size={16} className="m-spin" />
          加载中…
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
      {!loading && hasMore && !studentFilter && (
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void fetchPage(page + 1, status)}>
          加载更多（还有 {total - list.length} 条）
        </button>
      )}

      <FilterSheet
        open={!!panel}
        title={panel?.mode === 'close' ? '处置销号' : '记录处理措施'}
        onClose={() => setPanel(null)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setPanel(null)}>取消</button>
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={submit}>
              {saving ? '提交中…' : panel?.mode === 'close' ? '确认销号' : '保存为处理中'}
            </button>
          </>
        }
      >
        {panel && (
          <>
            <div className="m-t3">
              {panel.warning.studentName} · {panel.warning.type} · {panel.warning.level}预警
            </div>
            <div className="m-field">
              <label>
                处理措施
                {panel.mode === 'close' && <span className="m-req">*</span>}
              </label>
              <textarea
                className="m-inp"
                rows={4}
                value={note}
                placeholder="如：已与本人谈心，联系家长确认情况，安排学业帮扶"
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError('');
                }}
              />
              <div className="m-form-err">
                {noteError && (
                  <>
                    <MIcon name="alertCircle" size={13} />
                    {noteError}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

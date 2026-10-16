import { useCallback, useEffect, useRef, useState } from 'react';

import { approveApproval, getApprovals } from '@/api/approval';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import type { Approval, ApprovalStatus } from '@/types';

const PAGE_SIZE = 10;

const STATUS_TAG: Record<ApprovalStatus, string> = { 待审批: 'warning', 已通过: 'success', 已驳回: 'danger' };

const STATUS_FILTERS: { key: ApprovalStatus | '全部'; label: string }[] = [
  { key: '待审批', label: '待审批' },
  { key: '已通过', label: '已通过' },
  { key: '已驳回', label: '已驳回' },
  { key: '全部', label: '全部' },
];

/**
 * 移动端审批中心：列表一屏看清「谁 / 什么事 / 何时」，
 * 点「去审批」展开全屏内联详情，通过一键完成，驳回强制填写意见并就近报错。
 */
export default function ApprovalsMobile() {
  const [list, setList] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ApprovalStatus | '全部'>('待审批');

  const [active, setActive] = useState<Approval | null>(null);
  const [result, setResult] = useState<'已通过' | '已驳回'>('已通过');
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const fetchPage = useCallback(async (targetPage: number, st: ApprovalStatus | '全部') => {
    setLoading(true);
    try {
      const res = await getApprovals({
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

  const openAudit = (a: Approval) => {
    setActive(a);
    setResult('已通过');
    setComment('');
    setCommentError('');
  };

  const submit = async () => {
    if (!active) return;
    const text = comment.trim();
    if (result === '已驳回' && !text) {
      setCommentError('驳回必须填写审批意见，学生将看到该意见');
      return;
    }
    setSaving(true);
    try {
      await approveApproval(active.id, result, text);
      setActive(null);
      showToast(result === '已通过' ? '已通过审批' : '已驳回申请');
      await fetchPage(1, status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="m-seg" style={{ flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`m-seg-btn${status === f.key ? ' on' : ''}`} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="m-t4">共 {total} 条申请{status === '全部' ? '' : `（${status}）`}</div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {status === '待审批' ? '没有待审批的申请' : '该状态下暂无记录'}
          </div>
        </div>
      ) : (
        list.map((a) => {
          const pending = a.status === '待审批';
          return (
            <div className="m-card" key={a.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="m-tag info">{a.type}</span>
                <span className="m-t1">{a.studentName}</span>
                <span className={`m-tag ${STATUS_TAG[a.status]}`}>{a.status}</span>
              </div>
              <div className="m-t4" style={{ marginTop: 5 }}>
                {a.className} · 学号 {a.studentNo} · {a.submittedAt.slice(0, 16)}
              </div>
              <div className="m-t3" style={{ marginTop: 8, lineHeight: 1.7 }}>{a.summary}</div>
              {a.comment && (
                <div className="m-t4" style={{ marginTop: 6, padding: '6px 8px', background: 'var(--m-sunken)', borderRadius: 8 }}>
                  审批意见：{a.comment}
                </div>
              )}
              {pending && (
                <button type="button" className="m-btn m-btn-primary m-btn-block" style={{ marginTop: 10 }} onClick={() => openAudit(a)}>
                  <MIcon name="file" size={16} />
                  去审批
                </button>
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
      {!loading && hasMore && (
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void fetchPage(page + 1, status)}>
          加载更多（还有 {total - list.length} 条）
        </button>
      )}

      {/* 审批详情与裁决：底部面板（内联展开，避免跳页丢上下文） */}
      <FilterSheet
        open={!!active}
        title="审批详情"
        onClose={() => setActive(null)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setActive(null)}>取消</button>
            <button
              type="button"
              className={`m-btn ${result === '已驳回' ? 'm-btn-danger' : 'm-btn-primary'}`}
              disabled={saving}
              onClick={submit}
            >
              {saving ? '提交中…' : result === '已通过' ? '确认通过' : '确认驳回'}
            </button>
          </>
        }
      >
        {active && (
          <>
            <div className="m-card" style={{ boxShadow: 'none' }}>
              <div className="m-t2">{active.studentName} · {active.type}</div>
              <div className="m-t4" style={{ marginTop: 4 }}>{active.className} · {active.submittedAt.slice(0, 16)}</div>
              <div className="m-t3" style={{ marginTop: 8, lineHeight: 1.7 }}>{active.summary}</div>
              {active.detail && <div className="m-t4" style={{ marginTop: 6, lineHeight: 1.7 }}>补充说明：{active.detail}</div>}
            </div>

            <div className="m-field">
              <label>审批结果</label>
              <div className="m-seg">
                <button type="button" className={`m-seg-btn${result === '已通过' ? ' on' : ''}`} onClick={() => { setResult('已通过'); setCommentError(''); }}>
                  <MIcon name="check" size={14} />
                  通过
                </button>
                <button type="button" className={`m-seg-btn${result === '已驳回' ? ' on' : ''}`} onClick={() => setResult('已驳回')}>
                  <MIcon name="x" size={14} />
                  驳回
                </button>
              </div>
            </div>

            <div className="m-field">
              <label>
                审批意见
                {result === '已驳回' && <span className="m-req">*</span>}
              </label>
              <textarea
                className="m-inp"
                rows={3}
                value={comment}
                placeholder={result === '已驳回' ? '请说明驳回原因，便于学生补充材料' : '可填写审批备注（选填）'}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (commentError) setCommentError('');
                }}
              />
              <div className="m-form-err">
                {commentError && (
                  <>
                    <MIcon name="alertCircle" size={13} />
                    {commentError}
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

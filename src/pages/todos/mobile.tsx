import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getTodos, updateTodo } from '@/api/todo';
import { MIcon } from '@/components/mobile/icons';
import type { Todo, TodoStatus } from '@/types';

const PAGE_SIZE = 10;

const PRIORITY_TAG: Record<Todo['priority'], string> = { 高: 'danger', 中: 'warning', 低: 'neutral' };

/**
 * 移动端待办提醒：优先级卡 + 44px 大热区打卡 + 逾期高亮（带文字，不只靠颜色）。
 * 未完成 / 已完成通过分段控件切换；已完成项在未完成列表中折叠展示。
 */
export default function TodosMobile() {
  const [list, setList] = useState<Todo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TodoStatus>('未完成');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const fetchPage = useCallback(async (targetPage: number, st: TodoStatus) => {
    setLoading(true);
    try {
      const res = await getTodos({ page: targetPage, pageSize: PAGE_SIZE, status: st });
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

  const toggle = async (t: Todo) => {
    setBusyId(t.id);
    try {
      const next: TodoStatus = t.status === '已完成' ? '未完成' : '已完成';
      await updateTodo(t.id, { status: next });
      showToast(next === '已完成' ? '已打卡完成' : '已恢复为未完成');
      await fetchPage(1, status);
    } finally {
      setBusyId(null);
    }
  };

  const overdue = (t: Todo) => t.status === '未完成' && t.dueDate < todayStr;
  const overdueCount = list.filter(overdue).length;

  return (
    <>
      <div className="m-seg">
        <button type="button" className={`m-seg-btn${status === '未完成' ? ' on' : ''}`} onClick={() => setStatus('未完成')}>
          未完成 {status === '未完成' && total > 0 ? `(${total})` : ''}
        </button>
        <button type="button" className={`m-seg-btn${status === '已完成' ? ' on' : ''}`} onClick={() => setStatus('已完成')}>
          已完成
        </button>
      </div>

      {status === '未完成' && overdueCount > 0 && (
        <div className="m-card" style={{ borderColor: 'var(--danger-bd)', background: 'var(--danger-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MIcon name="alertTriangle" size={18} style={{ color: 'var(--danger-fg)' }} />
            <span className="m-t2" style={{ color: 'var(--danger-fg)' }}>
              本页有 {overdueCount} 项已逾期，建议优先处理
            </span>
          </div>
        </div>
      )}

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {status === '未完成' ? '没有未完成的待办' : '还没有已完成的待办'}
          </div>
        </div>
      ) : (
        list.map((t) => {
          const isOverdue = overdue(t);
          const done = t.status === '已完成';
          return (
            <div className="m-card" key={t.id} style={done ? { opacity: 0.9, borderStyle: 'dashed' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <label className="m-check" style={{ marginTop: -6 }}>
                  <input
                    type="checkbox"
                    className="m-cbx"
                    checked={done}
                    disabled={busyId === t.id}
                    onChange={() => toggle(t)}
                    aria-label={`${done ? '恢复' : '完成'}待办：${t.title}`}
                  />
                  <span className="m-box">
                    <svg className="m-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                </label>
                <div className="m-row-main" style={{ paddingTop: 4 }}>
                  <div className="m-t2" style={{ lineHeight: 1.5, textDecoration: done ? 'line-through' : undefined }}>{t.title}</div>
                  <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className={`m-tag ${PRIORITY_TAG[t.priority]}`}>{t.priority}优先</span>
                    <span className="m-nowrap" style={{ color: isOverdue ? 'var(--danger-fg)' : undefined, fontWeight: isOverdue ? 600 : undefined }}>
                      <MIcon name="clock" size={11} /> 截止 {t.dueDate}
                      {t.dueTime ? ` ${t.dueTime}` : ''}
                    </span>
                    {isOverdue && (
                      <span className="m-tag danger">
                        <MIcon name="alertTriangle" size={11} />
                        已逾期
                      </span>
                    )}
                  </div>
                  <div className="m-t4" style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="m-nowrap">{t.type}</span>
                    {t.relatedStudent && <span className="m-nowrap">· {t.relatedStudent}</span>}
                  </div>
                  {t.note && <div className="m-t4" style={{ marginTop: 4 }}>{t.note}</div>}
                </div>
              </div>
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
          加载更多（还有 {total - list.length} 项）
        </button>
      )}

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

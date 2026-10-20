import { Popconfirm } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getStudentOptions } from '@/api/student';
import { createTodo, deleteTodo, getTodos, updateTodo } from '@/api/todo';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { TODO_PRIORITIES, TODO_TYPES } from '@/constants';
import type { StudentOption, Todo, TodoInput, TodoPriority, TodoStatus, TodoType } from '@/types';

const PAGE_SIZE = 10;

const PRIORITY_TAG: Record<Todo['priority'], string> = { 高: 'danger', 中: 'warning', 低: 'neutral' };

/** 表单草稿（截止时间/关联学生/备注为选填，空串表示不填） */
interface TodoDraft {
  title: string;
  type: TodoType;
  priority: TodoPriority;
  dueDate: string;
  dueTime: string;
  relatedStudent: string;
  note: string;
}

const emptyDraft = (today: string): TodoDraft => ({
  title: '',
  type: '其他',
  priority: '中',
  dueDate: today,
  dueTime: '',
  relatedStudent: '',
  note: '',
});

/** 本地日期 YYYY-MM-DD（待办归属当前用户，截止日期按用户本地日历计算） */
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 移动端待办提醒：优先级卡 + 44px 大热区打卡 + 逾期高亮（带文字，不只靠颜色）。
 * 未完成 / 已完成通过分段控件切换；已完成项在未完成列表中折叠展示。
 * 支持新增 / 编辑 / 删除（全屏 FilterSheet 表单，输入 ≥16px）；
 * 数据按创建人严格隔离——列表只返回本人创建的待办，编辑/删除越权由服务端 403 拦截。
 */
export default function TodosMobile() {
  const [list, setList] = useState<Todo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TodoStatus>('未完成');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  /* 新增 / 编辑面板 */
  const [sheet, setSheet] = useState<{ open: boolean; mode: 'create' | 'edit'; todo: Todo | null }>({
    open: false,
    mode: 'create',
    todo: null,
  });
  const [draft, setDraft] = useState<TodoDraft>(() => emptyDraft(localDate()));
  const [errors, setErrors] = useState<{ title?: string; dueDate?: string }>({});
  const [saving, setSaving] = useState(false);
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);

  const todayStr = useMemo(() => localDate(), []);

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

  /* 关联学生下拉：面板打开时懒加载（失败静默，下拉留空不影响保存） */
  useEffect(() => {
    if (!sheet.open || studentOptions.length > 0) return;
    let alive = true;
    getStudentOptions()
      .then((opts) => { if (alive) setStudentOptions(opts); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [sheet.open, studentOptions.length]);

  /* 编辑历史关联学生时，确保下拉能回显（该学生可能已不在当前可见范围） */
  const relatedOptions = useMemo(() => {
    const cur = sheet.todo?.relatedStudent;
    if (cur && !studentOptions.some((s) => s.name === cur)) {
      return [{ id: `__current__${cur}`, name: cur, studentNo: '', className: '' }, ...studentOptions];
    }
    return studentOptions;
  }, [studentOptions, sheet.todo]);

  const openCreate = () => {
    setSheet({ open: true, mode: 'create', todo: null });
    setDraft(emptyDraft(todayStr));
    setErrors({});
  };

  const openEdit = (t: Todo) => {
    setSheet({ open: true, mode: 'edit', todo: t });
    setDraft({
      title: t.title,
      type: t.type,
      priority: t.priority,
      dueDate: t.dueDate,
      dueTime: t.dueTime ?? '',
      relatedStudent: t.relatedStudent ?? '',
      note: t.note ?? '',
    });
    setErrors({});
  };

  const closeSheet = () => {
    if (saving) return; // 保存过程中禁止误触关闭
    setSheet({ open: false, mode: 'create', todo: null });
  };

  const submit = async () => {
    const errs: { title?: string; dueDate?: string } = {};
    if (!draft.title.trim()) errs.title = '请输入待办事项';
    if (!draft.dueDate) errs.dueDate = '请选择截止日期';
    if (errs.title || errs.dueDate) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const payload: TodoInput = {
        title: draft.title.trim(),
        type: draft.type,
        priority: draft.priority,
        dueDate: draft.dueDate,
        dueTime: draft.dueTime || undefined,
        relatedStudent: draft.relatedStudent || undefined,
        note: draft.note.trim() || undefined,
      };
      if (sheet.mode === 'edit' && sheet.todo) {
        await updateTodo(sheet.todo.id, payload);
        showToast('待办已更新');
        await fetchPage(1, status);
      } else {
        await createTodo(payload);
        showToast('待办已创建');
        // 新待办恒为「未完成」：当前在已完成分段时先切回（交由 effect 刷新），同分段则手动刷新
        if (status !== '未完成') setStatus('未完成');
        else await fetchPage(1, '未完成');
      }
      setSheet({ open: false, mode: 'create', todo: null });
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: Todo) => {
    setBusyId(t.id);
    try {
      const next: TodoStatus = t.status === '已完成' ? '未完成' : '已完成';
      await updateTodo(t.id, { status: next });
      showToast(next === '已完成' ? '已打卡完成' : '已恢复为未完成');
      await fetchPage(1, status);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (t: Todo) => {
    try {
      await deleteTodo(t.id);
      showToast('删除成功');
      await fetchPage(1, status);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败，请稍后重试');
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

      {/* 数据范围说明 + 新增入口（待办按创建人隔离，仅本人数据） */}
      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ flex: 1, minWidth: 0 }}>仅显示本人创建的待办</span>
        <button type="button" className="m-btn m-btn-soft" onClick={openCreate}>
          <MIcon name="plus" size={14} />
          新增待办
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
          {status === '未完成' && (
            <div className="m-t4" style={{ marginTop: 4 }}>
              点击「新增待办」创建第一条待办
            </div>
          )}
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

              {/* 卡片操作行：编辑 / 删除（越权操作由服务端 403 兜底） */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  marginTop: 6,
                  borderTop: '1px solid var(--m-border)',
                  paddingTop: 4,
                }}
              >
                <a className="m-act" onClick={() => openEdit(t)} aria-label={`编辑待办：${t.title}`}>
                  <MIcon name="edit" size={18} />
                  编辑
                </a>
                <Popconfirm title="确定删除该待办吗？" onConfirm={() => void handleDelete(t)}>
                  <a className="m-act danger" onClick={(e) => e.stopPropagation()} aria-label={`删除待办：${t.title}`}>
                    <MIcon name="trash" size={18} />
                    删除
                  </a>
                </Popconfirm>
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

      {/* 新增 / 编辑待办：全屏长表单，防误触关闭 */}
      <FilterSheet
        open={sheet.open}
        title={sheet.mode === 'edit' ? '编辑待办' : '新增待办'}
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
            待办事项
            <span className="m-req">*</span>
          </label>
          <input
            className="m-inp"
            value={draft.title}
            maxLength={50}
            placeholder="如：与张三进行心理约谈"
            onChange={(e) => {
              setDraft({ ...draft, title: e.target.value });
              if (errors.title) setErrors({ ...errors, title: '' });
            }}
          />
          <div className="m-form-err">
            {errors.title && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.title}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>类型</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            {TODO_TYPES.map((tp) => (
              <button
                key={tp}
                type="button"
                className={`m-seg-btn${draft.type === tp ? ' on' : ''}`}
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
                onClick={() => setDraft({ ...draft, type: tp })}
              >
                {tp}
              </button>
            ))}
          </div>
        </div>

        <div className="m-field">
          <label>优先级</label>
          <div className="m-seg">
            {TODO_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                className={`m-seg-btn${draft.priority === p ? ' on' : ''}`}
                onClick={() => setDraft({ ...draft, priority: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="m-field">
          <label>
            截止日期
            <span className="m-req">*</span>
          </label>
          <input
            type="date"
            className="m-inp"
            value={draft.dueDate}
            onChange={(e) => {
              setDraft({ ...draft, dueDate: e.target.value });
              if (errors.dueDate) setErrors({ ...errors, dueDate: '' });
            }}
          />
          <div className="m-form-err">
            {errors.dueDate && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.dueDate}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>截止时间（选填）</label>
          <input
            type="time"
            className="m-inp"
            value={draft.dueTime}
            onChange={(e) => setDraft({ ...draft, dueTime: e.target.value })}
          />
        </div>

        <div className="m-field">
          <label>关联学生（选填）</label>
          <select
            className="m-inp"
            value={draft.relatedStudent}
            onChange={(e) => setDraft({ ...draft, relatedStudent: e.target.value })}
          >
            <option value="">不关联</option>
            {relatedOptions.map((s) => (
              <option key={s.id} value={s.name}>
                {s.className ? `${s.name}（${s.className}）` : s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="m-field">
          <label>备注（选填）</label>
          <textarea
            className="m-inp"
            rows={3}
            value={draft.note}
            maxLength={200}
            placeholder="补充说明"
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </div>
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

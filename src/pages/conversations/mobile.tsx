import { Popconfirm } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  createConversation,
  deleteConversation,
  getConversationTimeline,
  getConversations,
  getTalkedStudents,
  updateConversation,
} from '@/api/conversation';
import { getStudentOptions } from '@/api/student';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { canManageStudentFront, getStoredUser } from '@/lib/auth';
import { TALK_TYPES, TALK_WAYS } from '@/constants';
import type {
  Conversation,
  StudentOption,
  TalkType,
  TalkWay,
  TalkedStudentOption,
} from '@/types';

const PAGE_SIZE = 10;

/** 谈话类型 → m-tag 语义色（与桌面 TALK_TYPE_COLOR 同族：蓝/紫/绿…归并到语义四件套） */
const TYPE_TAG: Record<TalkType, string> = {
  学业指导: 'info',
  心理疏导: 'warning',
  生活关怀: 'success',
  就业指导: 'info',
  违纪教育: 'danger',
  资助帮扶: 'warning',
};

interface ListFilters {
  type?: TalkType;
  way?: TalkWay;
  needFollowUp?: boolean;
  startDate?: string;
  endDate?: string;
}

const EMPTY_FILTERS: ListFilters = {};

/** 本地时间 YYYY-MM-DD HH:mm（谈话时间默认此刻） */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 记录表单草稿（talkTime 为 YYYY-MM-DD HH:mm） */
interface ConvDraft {
  studentId: string;
  talkTime: string;
  way: TalkWay;
  type: TalkType;
  needFollowUp: boolean;
  content: string;
  followUp: string;
}

/**
 * 移动端谈心谈话记录：列表 / 时间线双视图分段切换。
 * 列表 = 搜索 + 筛选面板（类型/方式/跟进/日期区间）+ 记录卡片（点卡片看详情）；
 * 时间线 = 学生选择面板 + 类型筛选 + 时间轴卡片；两端共用同一套增删改（全屏长表单）。
 * 与桌面同数据源、同权限口径（学生下拉按带班过滤；删除二次确认）。
 */
export default function ConversationsMobile() {
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [toast, setToast] = useState('');

  /* ---------- 列表视图 ---------- */
  const [list, setList] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<ListFilters>(EMPTY_FILTERS);

  /* ---------- 时间线视图 ---------- */
  const [talkedStudents, setTalkedStudents] = useState<TalkedStudentOption[]>([]);
  const [tlStudentId, setTlStudentId] = useState<string | undefined>();
  const [tlType, setTlType] = useState<TalkType | undefined>();
  const [tlData, setTlData] = useState<Conversation[]>([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKw, setPickerKw] = useState('');

  /* ---------- 表单与详情 ---------- */
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [sheet, setSheet] = useState<{ open: boolean; mode: 'create' | 'edit'; record: Conversation | null }>({
    open: false,
    mode: 'create',
    record: null,
  });
  const [draft, setDraft] = useState<ConvDraft>(() => ({
    studentId: '',
    talkTime: localNow(),
    way: '面对面',
    type: '学业指导',
    needFollowUp: false,
    content: '',
    followUp: '',
  }));
  const [errors, setErrors] = useState<{ studentId?: string; talkTime?: string; content?: string }>({});
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Conversation | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  /* 从移动端「发起谈心」入口进入时（/conversations?studentId=xxx），自动打开记录表单并预选该学生 */
  const [searchParams] = useSearchParams();
  const presetFromUrl = searchParams.get('studentId');
  useEffect(() => {
    if (!presetFromUrl) return;
    openCreate(presetFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetFromUrl]);

  /* ---------- 列表：关键字 400ms 防抖 + 筛选参数 ---------- */
  const fetchPage = useCallback(
    async (targetPage: number, kw: string, f: ListFilters) => {
      setLoading(true);
      try {
        const res = await getConversations({
          page: targetPage,
          pageSize: PAGE_SIZE,
          ...(kw ? { keyword: kw } : {}),
          ...f,
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

  /* ---------- 时间线 ---------- */
  const loadTalkedStudents = useCallback(() => {
    return getTalkedStudents()
      .then((l) => {
        setTalkedStudents(l);
        setTlStudentId((prev) => prev ?? l[0]?.id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadTalkedStudents();
  }, [loadTalkedStudents]);

  const loadTimeline = useCallback(() => {
    if (!tlStudentId) {
      setTlData([]);
      return;
    }
    setTlLoading(true);
    getConversationTimeline({ studentId: tlStudentId, type: tlType })
      .then(setTlData)
      .catch(() => showToast('时间线数据加载失败'))
      .finally(() => setTlLoading(false));
  }, [tlStudentId, tlType]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  /** 增删改后统一刷新：列表 + 时间线学生选项 + 时间线内容 */
  const refreshAll = useCallback(() => {
    void fetchPage(1, keyword, filters);
    void loadTalkedStudents();
    loadTimeline();
  }, [fetchPage, keyword, filters, loadTalkedStudents, loadTimeline]);

  /* 学生下拉：打开表单时懒加载（按带班过滤，与桌面同口径） */
  useEffect(() => {
    if (!sheet.open || studentOptions.length > 0) return;
    let alive = true;
    const authUser = getStoredUser();
    getStudentOptions()
      .then((opts) => {
        if (alive) setStudentOptions(opts.filter((s) => canManageStudentFront(authUser, s.classId)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sheet.open, studentOptions.length]);

  /* 编辑历史学生时确保下拉能回显 */
  const studentSelectOptions = useMemo(() => {
    const cur = sheet.record?.studentId;
    if (sheet.mode === 'edit' && cur && !studentOptions.some((s) => s.id === cur)) {
      return [{ id: cur, name: sheet.record!.studentName, studentNo: sheet.record!.studentNo, className: '' }, ...studentOptions];
    }
    return studentOptions;
  }, [studentOptions, sheet]);

  const openCreate = (presetStudentId?: string) => {
    setSheet({ open: true, mode: 'create', record: null });
    setDraft({
      studentId: presetStudentId ?? '',
      talkTime: localNow(),
      way: '面对面',
      type: '学业指导',
      needFollowUp: false,
      content: '',
      followUp: '',
    });
    setErrors({});
  };

  const openEdit = (c: Conversation) => {
    setSheet({ open: true, mode: 'edit', record: c });
    setDraft({
      studentId: c.studentId,
      talkTime: c.talkTime,
      way: c.way,
      type: c.type,
      needFollowUp: c.needFollowUp,
      content: c.content,
      followUp: c.followUp ?? '',
    });
    setErrors({});
  };

  const closeSheet = () => {
    if (saving) return; // 保存过程中禁止误触关闭
    setSheet({ open: false, mode: 'create', record: null });
  };

  const submit = async () => {
    const errs: { studentId?: string; talkTime?: string; content?: string } = {};
    if (!draft.studentId) errs.studentId = '请选择学生';
    if (!draft.talkTime) errs.talkTime = '请选择谈话时间';
    if (!draft.content.trim()) errs.content = '请填写谈话内容';
    if (errs.studentId || errs.talkTime || errs.content) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        studentId: draft.studentId,
        talkTime: draft.talkTime,
        way: draft.way,
        type: draft.type,
        needFollowUp: draft.needFollowUp,
        content: draft.content.trim(),
        followUp: draft.followUp.trim() || undefined,
      };
      if (sheet.mode === 'edit' && sheet.record) {
        await updateConversation(sheet.record.id, payload);
        showToast('谈话记录已更新');
      } else {
        await createConversation(payload);
        showToast('谈话记录已保存');
      }
      setSheet({ open: false, mode: 'create', record: null });
      refreshAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Conversation) => {
    try {
      await deleteConversation(c.id);
      showToast('删除成功');
      setDetail(null);
      refreshAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败，请稍后重试');
    }
  };

  const filterCount =
    (filters.type ? 1 : 0) + (filters.way ? 1 : 0) + (filters.needFollowUp === undefined ? 0 : 1) + (filters.startDate ? 1 : 0);

  const tlStudent = talkedStudents.find((s) => s.id === tlStudentId);
  const pickerList = useMemo(() => {
    const kw = pickerKw.trim();
    if (!kw) return talkedStudents;
    return talkedStudents.filter((s) => s.name.includes(kw) || s.studentNo.includes(kw) || s.className.includes(kw));
  }, [talkedStudents, pickerKw]);

  /** chip 组：withAll=true 时带「全部」项（筛选场景）；表单场景必填，不带 */
  const segChips = <T extends string>(opts: T[], cur: T | undefined, onPick: (v: T | undefined) => void, allLabel: string, withAll = true) => (
    <div className="m-seg" style={{ flexWrap: 'wrap' }}>
      {withAll && (
        <button
          type="button"
          className={`m-seg-btn${cur === undefined ? ' on' : ''}`}
          style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
          onClick={() => onPick(undefined)}
        >
          {allLabel}
        </button>
      )}
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          className={`m-seg-btn${cur === o ? ' on' : ''}`}
          style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
          onClick={() => onPick(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="m-seg">
        <button type="button" className={`m-seg-btn${view === 'list' ? ' on' : ''}`} onClick={() => setView('list')}>
          列表视图
        </button>
        <button type="button" className={`m-seg-btn${view === 'timeline' ? ' on' : ''}`} onClick={() => setView('timeline')}>
          时间线
        </button>
      </div>

      {view === 'list' ? (
        <>
          {/* 搜索 + 筛选 + 新增 */}
          <div className="m-search-row" style={{ marginTop: 10 }}>
            <div className="m-search-field">
              <MIcon name="search" size={16} />
              <input
                className="m-inp"
                value={keyword}
                placeholder="搜索学生姓名 / 学号 / 内容"
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索谈话记录"
              />
            </div>
            <button
              type="button"
              className="m-btn m-btn-soft"
              style={filterCount > 0 ? { borderColor: 'var(--info-bd)', color: 'var(--info-fg)' } : undefined}
              onClick={() => {
                setDraftFilters(filters);
                setFilterOpen(true);
              }}
              aria-label={`筛选（${filterCount} 项已启用）`}
            >
              <MIcon name="funnel" size={16} />
              筛选{filterCount > 0 ? `·${filterCount}` : ''}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span className="m-t4" style={{ flex: 1, minWidth: 0 }}>
              共 {total} 条谈话记录{filterCount > 0 || keyword ? '（已筛选）' : ''}
            </span>
            <button type="button" className="m-btn m-btn-primary" onClick={() => openCreate()}>
              <MIcon name="plus" size={14} />
              新增谈话
            </button>
          </div>

          {list.length === 0 && !loading ? (
            <div className="m-card empty">
              <MIcon name="comment" size={22} />
              <div className="m-t3" style={{ marginTop: 6 }}>
                {keyword || filterCount > 0 ? '没有符合条件的谈话记录' : '还没有谈话记录'}
              </div>
              {!keyword && filterCount === 0 && (
                <div className="m-t4" style={{ marginTop: 4 }}>
                  点击「新增谈话」记录第一次谈心
                </div>
              )}
            </div>
          ) : (
            list.map((c) => (
              <div
                className="m-card"
                key={c.id}
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => setDetail(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setDetail(c);
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="m-ava">{c.studentName.slice(0, 1)}</span>
                  <div className="m-row-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="m-t1">{c.studentName}</span>
                      <span className={`m-tag ${TYPE_TAG[c.type]}`}>{c.type}</span>
                      {c.needFollowUp && (
                        <span className="m-tag warning">
                          <MIcon name="flag" size={12} />
                          需跟进
                        </span>
                      )}
                    </div>
                    <div className="m-t4" style={{ marginTop: 3 }}>
                      {c.studentNo} · <MIcon name="clock" size={11} /> {c.talkTime} · {c.way}
                    </div>
                  </div>
                  <MIcon name="chevR" size={16} className="m-row-side" />
                </div>
                <div
                  className="m-t3"
                  style={{
                    marginTop: 8,
                    lineHeight: 1.7,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {c.content}
                </div>

                {/* 卡片操作行：时间线 / 编辑 / 删除（点卡片本体看详情） */}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setTlStudentId(c.studentId);
                      setTlType(undefined);
                      setView('timeline');
                    }}
                    aria-label={`查看 ${c.studentName} 的谈话时间线`}
                  >
                    <MIcon name="clock" size={18} />
                    时间线
                  </a>
                  <a
                    className="m-act"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(c);
                    }}
                    aria-label={`编辑 ${c.studentName} 的谈话记录`}
                  >
                    <MIcon name="edit" size={18} />
                    编辑
                  </a>
                  <Popconfirm title="确定删除该条谈话记录吗？" onConfirm={() => void handleDelete(c)}>
                    <a className="m-act danger" onClick={(e) => e.stopPropagation()} aria-label={`删除 ${c.studentName} 的谈话记录`}>
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
              加载更多（还有 {total - list.length} 条）
            </button>
          )}
        </>
      ) : (
        /* ==================== 时间线视图 ==================== */
        <>
          <div className="m-card" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MIcon name="user" size={18} style={{ color: 'var(--m-text-2)' }} />
            <div className="m-row-main">
              {tlStudent ? (
                <>
                  <div className="m-t2">
                    {tlStudent.name}
                    <span className="m-t4" style={{ marginLeft: 8, fontWeight: 400 }}>
                      {tlStudent.className} · {tlStudent.studentNo}
                    </span>
                  </div>
                  <div className="m-t4" style={{ marginTop: 2 }}>
                    累计 {tlStudent.count} 次谈话 · 最近一次 {tlStudent.lastTime.slice(0, 10)}
                    {tlStudent.followCount > 0 && ` · ${tlStudent.followCount} 条需跟进`}
                  </div>
                </>
              ) : (
                <div className="m-t3">{tlLoading ? '加载中…' : '暂无谈话记录'}</div>
              )}
            </div>
            <button type="button" className="m-btn m-btn-soft" onClick={() => setPickerOpen(true)}>
              换学生
            </button>
          </div>

          <div style={{ marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
            <div className="m-seg" style={{ flexWrap: 'nowrap', width: 'max-content' }}>
              <button type="button" className={`m-seg-btn${tlType === undefined ? ' on' : ''}`} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }} onClick={() => setTlType(undefined)}>
                全部类型
              </button>
              {TALK_TYPES.map((t) => (
                <button key={t} type="button" className={`m-seg-btn${tlType === t ? ' on' : ''}`} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }} onClick={() => setTlType(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {tlLoading ? (
            <div className="m-loadmore">
              <MIcon name="spinner" size={16} className="m-spin" />
              正在加载时间线…
            </div>
          ) : tlData.length === 0 ? (
            <div className="m-card empty">
              <MIcon name="comment" size={22} />
              <div className="m-t3" style={{ marginTop: 6 }}>该筛选条件下暂无谈话记录</div>
              {tlStudent && (
                <button type="button" className="m-btn m-btn-primary" style={{ marginTop: 10 }} onClick={() => openCreate(tlStudent.id)}>
                  <MIcon name="plus" size={14} />
                  记录谈话
                </button>
              )}
            </div>
          ) : (
            <div className="m-tl">
              {tlData.map((c) => (
                <div className="m-tl-item" key={c.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t2">{c.talkTime.slice(0, 10)}</span>
                    <span className="m-t4">{c.talkTime.slice(11)}</span>
                    <span className={`m-tag ${TYPE_TAG[c.type]}`}>{c.type}</span>
                    <span className="m-tag neutral">{c.way}</span>
                    {c.needFollowUp && (
                      <span className="m-tag warning">
                        <MIcon name="flag" size={12} />
                        需跟进
                      </span>
                    )}
                  </div>
                  <div className="m-t3" style={{ marginTop: 6, lineHeight: 1.7, overflowWrap: 'anywhere' }}>{c.content}</div>
                  {c.followUp && (
                    <div className="m-t4" style={{ marginTop: 6, padding: '6px 8px', background: 'var(--m-sunken)', borderRadius: 8, overflowWrap: 'anywhere' }}>
                      后续跟进：{c.followUp}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <a className="m-act" onClick={() => openEdit(c)} aria-label={`编辑 ${c.talkTime} 的谈话记录`}>
                      <MIcon name="edit" size={18} />
                      编辑
                    </a>
                    <Popconfirm title="确定删除该条谈话记录吗？" onConfirm={() => void handleDelete(c)}>
                      <a className="m-act danger" aria-label={`删除 ${c.talkTime} 的谈话记录`}>
                        <MIcon name="trash" size={18} />
                        删除
                      </a>
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ==================== 筛选面板 ==================== */}
      <FilterSheet
        open={filterOpen}
        title="筛选谈话记录"
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="m-btn m-btn-ghost"
              onClick={() => {
                setDraftFilters(EMPTY_FILTERS);
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              onClick={() => {
                setFilters(draftFilters);
                setFilterOpen(false);
              }}
            >
              确定
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>谈话类型</label>
          {segChips(TALK_TYPES, draftFilters.type, (v) => setDraftFilters({ ...draftFilters, type: v }), '全部')}
        </div>
        <div className="m-field">
          <label>谈话方式</label>
          {segChips(TALK_WAYS, draftFilters.way, (v) => setDraftFilters({ ...draftFilters, way: v }), '全部')}
        </div>
        <div className="m-field">
          <label>是否需跟进</label>
          {segChips(['需要跟进', '无需跟进'] as const, draftFilters.needFollowUp === undefined ? undefined : draftFilters.needFollowUp ? '需要跟进' : '无需跟进', (v) => setDraftFilters({ ...draftFilters, needFollowUp: v === undefined ? undefined : v === '需要跟进' }), '全部')}
        </div>
        <div className="m-field">
          <label>谈话时间（起）</label>
          <input
            type="date"
            className="m-inp"
            value={draftFilters.startDate ?? ''}
            onChange={(e) => setDraftFilters({ ...draftFilters, startDate: e.target.value || undefined })}
          />
        </div>
        <div className="m-field">
          <label>谈话时间（止）</label>
          <input
            type="date"
            className="m-inp"
            value={draftFilters.endDate ?? ''}
            onChange={(e) => setDraftFilters({ ...draftFilters, endDate: e.target.value || undefined })}
          />
        </div>
      </FilterSheet>

      {/* ==================== 学生选择面板（时间线） ==================== */}
      <FilterSheet open={pickerOpen} title="选择学生查看时间线" onClose={() => setPickerOpen(false)}>
        <div className="m-search-field" style={{ marginBottom: 8 }}>
          <MIcon name="search" size={16} />
          <input
            className="m-inp"
            value={pickerKw}
            placeholder="搜索姓名 / 学号 / 班级"
            onChange={(e) => setPickerKw(e.target.value)}
            aria-label="搜索学生"
          />
        </div>
        {pickerList.length === 0 ? (
          <div className="m-t4" style={{ textAlign: 'center', padding: '24px 0' }}>
            {talkedStudents.length === 0 ? '暂无谈话记录' : '没有匹配的学生'}
          </div>
        ) : (
          pickerList.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              className="m-kv"
              style={{ cursor: 'pointer', alignItems: 'center' }}
              onClick={() => {
                setTlStudentId(s.id);
                setTlType(undefined);
                setPickerOpen(false);
                setPickerKw('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setTlStudentId(s.id);
                  setTlType(undefined);
                  setPickerOpen(false);
                  setPickerKw('');
                }
              }}
            >
              <span className="m-ava" style={{ width: 32, height: 32, fontSize: 14 }}>{s.name.slice(0, 1)}</span>
              <div className="m-row-main">
                <div className="m-t2">
                  {s.name}
                  <span className="m-t4" style={{ marginLeft: 8, fontWeight: 400 }}>{s.className}</span>
                </div>
                <div className="m-t4" style={{ marginTop: 2 }}>
                  {s.studentNo} · 累计 {s.count} 次 · 最近 {s.lastTime.slice(0, 10)}
                </div>
              </div>
              <MIcon name="chevR" size={16} className="m-row-side" />
            </div>
          ))
        )}
      </FilterSheet>

      {/* ==================== 详情面板 ==================== */}
      <FilterSheet
        open={!!detail}
        title="谈话记录详情"
        onClose={() => setDetail(null)}
        footer={
          detail && (
            <>
              <button type="button" className="m-btn m-btn-ghost" onClick={() => setDetail(null)}>
                关闭
              </button>
              <button
                type="button"
                className="m-btn m-btn-primary"
                onClick={() => {
                  const d = detail;
                  setDetail(null);
                  openEdit(d);
                }}
              >
                编辑
              </button>
            </>
          )
        }
      >
        {detail && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="m-ava">{detail.studentName.slice(0, 1)}</span>
              <div>
                <div className="m-t1">
                  {detail.studentName}
                  <span className={`m-tag ${TYPE_TAG[detail.type]}`} style={{ marginLeft: 8 }}>{detail.type}</span>
                  {detail.needFollowUp && <span className="m-tag warning" style={{ marginLeft: 6 }}>需跟进</span>}
                </div>
                <div className="m-t4" style={{ marginTop: 2 }}>
                  {detail.studentNo} · {detail.way} · {detail.talkTime}
                </div>
              </div>
            </div>
            <div className="m-sec-title">谈话内容</div>
            <div className="m-t3" style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.content}</div>
            <div className="m-sec-title" style={{ marginTop: 12 }}>后续跟进事项</div>
            <div className="m-t3" style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {detail.followUp || '—'}
            </div>
          </>
        )}
      </FilterSheet>

      {/* ==================== 新增 / 编辑：全屏长表单，防误触关闭 ==================== */}
      <FilterSheet
        open={sheet.open}
        title={sheet.mode === 'edit' ? '编辑谈话记录' : '新增谈话记录'}
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
            学生
            <span className="m-req">*</span>
          </label>
          <select
            className="m-inp"
            value={draft.studentId}
            onChange={(e) => {
              setDraft({ ...draft, studentId: e.target.value });
              if (errors.studentId) setErrors({ ...errors, studentId: '' });
            }}
          >
            <option value="">请选择学生</option>
            {studentSelectOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.className ? `${s.name}（${s.className} · ${s.studentNo}）` : `${s.name}（${s.studentNo}）`}
              </option>
            ))}
          </select>
          <div className="m-form-err">
            {errors.studentId && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.studentId}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>
            谈话时间
            <span className="m-req">*</span>
          </label>
          <input
            type="datetime-local"
            className="m-inp"
            value={draft.talkTime.replace(' ', 'T')}
            onChange={(e) => {
              setDraft({ ...draft, talkTime: e.target.value.replace('T', ' ') });
              if (errors.talkTime) setErrors({ ...errors, talkTime: '' });
            }}
          />
          <div className="m-form-err">
            {errors.talkTime && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.talkTime}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>谈话类型</label>
          {segChips(TALK_TYPES, draft.type, (v) => v && setDraft({ ...draft, type: v }), '', false)}
        </div>

        <div className="m-field">
          <label>谈话方式</label>
          {segChips(TALK_WAYS, draft.way, (v) => v && setDraft({ ...draft, way: v }), '', false)}
        </div>

        <div className="m-field">
          <label>是否需要跟进</label>
          {segChips(['需要跟进', '无需跟进'] as const, draft.needFollowUp ? '需要跟进' : '无需跟进', (v) => v && setDraft({ ...draft, needFollowUp: v !== '无需跟进' }), '', false)}
        </div>

        <div className="m-field">
          <label>
            谈话内容
            <span className="m-req">*</span>
          </label>
          <textarea
            className="m-inp"
            rows={4}
            maxLength={2000}
            placeholder="记录谈话要点、学生反馈与处理方式"
            value={draft.content}
            onChange={(e) => {
              setDraft({ ...draft, content: e.target.value });
              if (errors.content) setErrors({ ...errors, content: '' });
            }}
          />
          <div className="m-form-err">
            {errors.content && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.content}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>后续跟进事项（选填）</label>
          <textarea
            className="m-inp"
            rows={2}
            maxLength={500}
            placeholder="需要持续关注或落实的事项"
            value={draft.followUp}
            onChange={(e) => setDraft({ ...draft, followUp: e.target.value })}
          />
        </div>
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteMentalInterview,
  getMentalCandidates,
  getMentalConcerns,
  getMentalInterviewOverview,
  getMentalInterviews,
  getMentalLevelLogs,
  getMentalSummary,
  getMentalTimeline,
  setAttention,
} from '@/api/mental';
import { getClassOptions } from '@/api/classes';
import { MIcon } from '@/components/mobile/icons';
import FilterSheet from '@/components/mobile/FilterSheet';
import { DEFAULT_INTERVIEW_FORM, INTERVIEW_REQUIRED } from '@/constants/interview';
import { ATTENTION_LEVELS, TALK_RECORD_EXTERNAL_URL, TALK_RECORD_TARGET_LEVELS } from '@/constants/mental';
import type {
  AttentionLevel,
  InterviewFormModel,
  InterviewOverview,
  MentalCandidate,
  MentalConcern,
  MentalInterview,
  MentalInterviewView,
  MentalLevelLog,
  MentalLevelSummary,
  MentalTimeline,
} from '@/types';
import { canAccessModule, canStartTalkRecord, getStoredUser, isModuleOwner, isSystemAdmin, subscribeSession } from '@/lib/auth';
import InterviewFormSheet, { type InterviewStudentRefM } from './interview/InterviewFormSheet';
import TemplateManageSheet from './interview/TemplateManageSheet';
import ExportInterviewDialog from './ExportInterviewDialog';
import ImportConcernDialog from './ImportConcernDialog';
import {
  LEVEL_LOG_SOURCE_LABELS,
  levelLogText,
  recordFormOf,
  recordQaPairs,
} from './interview/shared';

const PAGE_SIZE = 10;

/** 等级视觉三编码：色条 + 标签色（不靠颜色单独表意，文字始终可见） */
const LEVEL_TAG: Record<AttentionLevel, string> = {
  密切关注: 'm-tag lv-red',
  重点关注: 'm-tag lv-orange',
  日常关注: 'm-tag info',
  一般关注: 'm-tag neutral',
  无需关注: 'm-tag neutral',
};
const LEVEL_BAR: Record<AttentionLevel, string> = {
  密切关注: 'm-wbar m-wbar-red',
  重点关注: 'm-wbar m-wbar-orange',
  日常关注: 'm-wbar',
  一般关注: 'm-wbar',
  无需关注: 'm-wbar',
};
const LEVEL_BAR_COLOR: Record<AttentionLevel, string> = {
  密切关注: '',
  重点关注: '',
  日常关注: 'linear-gradient(180deg, #4a7ae0 0%, #3f66cb 100%)',
  一般关注: '#9aa7c2',
  无需关注: '#c3ccdd',
};

type LevelFilter = AttentionLevel | '全部';
const LEVEL_FILTERS: LevelFilter[] = [...ATTENTION_LEVELS, '全部'];

/** 标记面板：mode=adjust 调整已有 / create 新增（先选学生） */
interface SheetState {
  open: boolean;
  mode: 'adjust' | 'create';
  student: { id: string; name: string; studentNo: string; className: string } | null;
}

/**
 * 移动端心理健康：等级分段筛选 + 学生卡片；谈话记录只读打通；
 * 心理访谈入口在「一般关注」学生卡片内（不新增菜单/路由），写权由服务端逐行判定。
 */
export default function MentalMobile() {
  /** 角色/权限变更后实时重算（布局层 /auth/me 刷新时广播），避免沿用挂载时的旧角色快照 */
  const [authUser, setAuthUser] = useState(getStoredUser);
  useEffect(() => subscribeSession(setAuthUser), []);
  const isAdmin = isSystemAdmin(authUser);
  /** 心理健康主负责（含管理员）：查看全院 + 全部写操作 */
  const isMentalOwner = isModuleOwner(authUser, 'mentalHealth');
  /** 关注写权限（新增/调整/取消）：严格口径 —— 管理员或心理健康主负责 */
  const canMentalWrite = isAdmin || isMentalOwner;
  /**
   * 「新增谈话」外链显隐：系统管理员或角色列表含辅导员角色（counselor）的用户可见。
   * 单一班主任、心理健康主负责等其他角色一律隐藏（不看主负责、不看带班数量）。
   */
  const canWrite = canStartTalkRecord(authUser);
  /** 心理访谈任务提醒：仅持有访谈权限的角色拉取 */
  const canInterviewPerm = canAccessModule(authUser, 'mentalInterview');

  const [list, setList] = useState<MentalConcern[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('全部');
  const [summary, setSummary] = useState<MentalLevelSummary[]>([]);
  /** 班级筛选（与桌面同口径：主负责/管理员全量选项，普通带班仅本班） */
  const [classId, setClassId] = useState<number | ''>('');
  const [classOptions, setClassOptions] = useState<{ id: number; name: string; gradeName: string }[]>([]);
  /** 关键字搜索（姓名/学号/班级，防抖查询） */
  const [kw, setKw] = useState('');

  const [sheet, setSheet] = useState<SheetState>({ open: false, mode: 'adjust', student: null });
  const [markLevel, setMarkLevel] = useState<AttentionLevel>('重点关注');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [candidates, setCandidates] = useState<MentalCandidate[]>([]);
  const [candidateKw, setCandidateKw] = useState('');

  const [talks, setTalks] = useState<MentalTimeline | null>(null);
  const [talksOpen, setTalksOpen] = useState(false);
  const [talksLoading, setTalksLoading] = useState(false);

  /* ---------- 心理访谈 ---------- */
  const [overview, setOverview] = useState<InterviewOverview | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [ivView, setIvView] = useState<MentalInterviewView | null>(null);
  const [ivSheetOpen, setIvSheetOpen] = useState(false);
  const [ivLevelLogs, setIvLevelLogs] = useState<MentalLevelLog[]>([]);
  const [ivFormOpen, setIvFormOpen] = useState(false);
  const [ivFormStudent, setIvFormStudent] = useState<InterviewStudentRefM | null>(null);
  const [ivFormRecord, setIvFormRecord] = useState<MentalInterview | null>(null);
  /** 生效记录单模板（按学生年级解析；新增/修订共用） */
  const [ivFormForm, setIvFormForm] = useState<InterviewFormModel>(DEFAULT_INTERVIEW_FORM);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  /** 记录单模板管理面板（管理员/心理主负责） */
  const [tplSheetOpen, setTplSheetOpen] = useState(false);
  /** 批量导入关注学生（管理员/心理主负责） */
  const [importOpen, setImportOpen] = useState(false);
  /** 批量导出访谈记录（管理员/心理主负责） */
  const [exportOpen, setExportOpen] = useState(false);

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  };

  const fetchPage = useCallback(async (
    targetPage: number,
    lv: LevelFilter,
    cid: number | '',
    keyword: string,
  ) => {
    setLoading(true);
    try {
      const res = await getMentalConcerns({
        page: targetPage,
        pageSize: PAGE_SIZE,
        ...(lv === '全部' ? {} : { level: lv }),
        ...(cid === '' ? {} : { classId: cid }),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      });
      setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
      setTotal(res.total);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadAll = useCallback(async (lv: LevelFilter, cid: number | '', keyword: string) => {
    getMentalSummary().then(setSummary).catch(() => undefined);
    await fetchPage(1, lv, cid, keyword);
  }, [fetchPage]);

  const reloadOverview = useCallback(() => {
    if (!canInterviewPerm) return;
    getMentalInterviewOverview().then(setOverview).catch(() => undefined);
  }, [canInterviewPerm]);

  // 初始加载 + 等级切换（班级/关键字由各自控件显式触发，避免输入即查）
  useEffect(() => {
    void reloadAll(level, classId, kw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, reloadAll]);

  useEffect(() => {
    reloadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadOverview]);

  // 最新筛选值镜像：无限滚动加载下一页时携带当前筛选（与桌面「筛选条件下翻页」一致）
  const filterRef = useRef({ level, classId, kw });
  filterRef.current = { level, classId, kw };

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        const f = filterRef.current;
        void fetchPage(page + 1, f.level, f.classId, f.kw);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, fetchPage]);

  /** 班级筛选：切换即查并回到第一页 */
  const onClassChange = (v: number | '') => {
    setClassId(v);
    void reloadAll(level, v, kw);
  };

  /** 关键字搜索：400ms 防抖查询 */
  const kwTimer = useRef<number | undefined>(undefined);
  const onKwChange = (v: string) => {
    setKw(v);
    window.clearTimeout(kwTimer.current);
    kwTimer.current = window.setTimeout(() => {
      void reloadAll(level, classId, v.trim());
    }, 400);
  };

  const openAdjust = (c: MentalConcern) => {
    setSheet({ open: true, mode: 'adjust', student: { id: c.studentId, name: c.name, studentNo: c.studentNo, className: c.className } });
    setMarkLevel(c.level);
    setNote(c.note ?? '');
  };

  const openCreate = () => {
    setSheet({ open: true, mode: 'create', student: null });
    setMarkLevel('重点关注');
    setNote('');
    setCandidateKw('');
    setCandidates([]);
  };

  // 候选学生：与桌面一致走远端搜索（可见范围由服务端限定），300ms 防抖
  useEffect(() => {
    if (!sheet.open || sheet.mode !== 'create') return undefined;
    const t = window.setTimeout(() => {
      getMentalCandidates(candidateKw.trim())
        .then(setCandidates)
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(t);
  }, [sheet.open, sheet.mode, candidateKw]);

  // 班级选项：主负责/管理员全量，普通带班仅所辖班级（与桌面 classOptions 同口径）
  useEffect(() => {
    getClassOptions()
      .then((opts) => {
        setClassOptions(
          isAdmin || isMentalOwner ? opts : opts.filter((c) => (authUser?.classIds ?? []).includes(c.id)),
        );
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitMark = async () => {
    if (sheet.mode === 'create' && !sheet.student) return;
    if (!sheet.student) return;
    setSaving(true);
    try {
      await setAttention(sheet.student.id, { level: markLevel, note: note.trim() });
      setSheet({ open: false, mode: 'adjust', student: null });
      showToast(sheet.mode === 'adjust' ? `已更新「${sheet.student.name}」的关注等级` : `已将「${sheet.student.name}」纳入关注`);
      await reloadAll(level, classId, kw);
      reloadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const clearMark = async () => {
    if (!sheet.student) return;
    setSaving(true);
    try {
      await setAttention(sheet.student.id, { level: '' });
      setSheet({ open: false, mode: 'adjust', student: null });
      showToast(`已取消对「${sheet.student.name}」的关注标记`);
      await reloadAll(level, classId, kw);
      reloadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const openTalks = async (c: MentalConcern) => {
    setTalksOpen(true);
    setTalksLoading(true);
    setTalks(null);
    try {
      setTalks(await getMentalTimeline(c.studentId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '谈话记录加载失败');
      setTalksOpen(false);
    } finally {
      setTalksLoading(false);
    }
  };

  /* ---------- 心理访谈交互 ---------- */

  /** 访谈保存/作废后的统一刷新 */
  const afterInterviewChanged = (studentId?: string) => {
    setIvFormOpen(false);
    setIvFormRecord(null);
    setIvFormForm(DEFAULT_INTERVIEW_FORM);
    void reloadAll(level, classId, kw);
    reloadOverview();
    getMentalSummary().then(setSummary).catch(() => undefined);
    if (studentId) {
      getMentalInterviews(String(studentId))
        .then(setIvView)
        .catch(() => undefined);
      getMentalLevelLogs(String(studentId))
        .then(setIvLevelLogs)
        .catch(() => undefined);
    }
  };

  /**
   * 卡片「心理访谈」入口：
   * 本学期 0 条且可写 → 直接进记录单向导；否则打开记录 Sheet（查看/继续/补充）。
   */
  const openInterview = async (studentId: string) => {
    try {
      const view = await getMentalInterviews(String(studentId));
      const form = view.form ?? DEFAULT_INTERVIEW_FORM;
      if (view.done === 0 && view.canWrite) {
        setIvFormStudent(view.student);
        setIvFormRecord(null);
        setIvFormForm(form);
        setIvFormOpen(true);
        return;
      }
      setIvView(view);
      setIvLevelLogs([]);
      setIvSheetOpen(true);
      getMentalLevelLogs(String(studentId))
        .then(setIvLevelLogs)
        .catch(() => undefined);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '访谈记录加载失败');
    }
  };

  const handleDeleteRecord = async (record: MentalInterview) => {
    if (!window.confirm('作废这条访谈记录？作废后本学期计数回退，关注等级不会回滚。')) return;
    setDeletingRecordId(record.id);
    try {
      const res = await deleteMentalInterview(record.id);
      showToast(`已作废该条记录（本学期剩余 ${res.done} 次；关注等级不回滚）`);
      afterInterviewChanged(record.studentId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败');
    } finally {
      setDeletingRecordId(null);
    }
  };

  /** 横幅本学期忽略（key 带学期，跨学期自动重新提醒） */
  const bannerDismissKey = overview
    ? `mentalInterviewBannerDismissed:${authUser?.id ?? 0}:${overview.semester.key}`
    : '';
  const bannerVisible = !!overview
    && overview.pendingCount > 0
    && !bannerDismissed
    && !(bannerDismissKey && localStorage.getItem(bannerDismissKey));

  return (
    <>
      <div className="m-seg" style={{ flexWrap: 'wrap' }}>
        {LEVEL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`m-seg-btn${level === f ? ' on' : ''}`}
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 14 }}
            onClick={() => setLevel(f)}
          >
            {f}
            {f !== '全部' ? ` ${summary.find((s) => s.level === f)?.count ?? 0}` : ''}
          </button>
        ))}
      </div>

      {/* 数据范围提示：管理员不提示；主负责全院；普通带班只读；无带班引导（文案与桌面 Alert 一致） */}
      {!isAdmin && (
        <div className="m-card" style={{ padding: '10px 14px' }}>
          <div className="m-t4" style={{ lineHeight: 1.7 }}>
            {isMentalOwner
              ? '数据范围：全院所有被标记关注的学生（心理健康主负责）。'
              : (authUser?.classIds ?? []).length > 0
                ? '数据范围：仅您所辖班级内被标记为需要关注的学生（只读）；新增/调整关注请联系心理健康主负责辅导员或管理员。'
                : '您尚未分配带班班级，暂无可查看的关注学生；如需维护关注标记请联系心理健康主负责辅导员或管理员。'}
          </div>
        </div>
      )}

      {/* 心理访谈任务提醒卡 */}
      {bannerVisible && overview && (
        <div className="m-card m-notice-card" data-tone={overview.semester.daysLeft <= 30 ? 'warning' : 'info'}>
          <div className="m-t3" style={{ lineHeight: 1.7 }}>
            {overview.semester.label}：{isAdmin || isMentalOwner ? '全院' : '您所辖班级'}有{' '}
            <strong>{overview.pendingCount}</strong> 名学生心理访谈未完成（每人至少 {overview.required} 次
            {overview.semester.daysLeft <= 30 ? `，距学期结束还有 ${overview.semester.daysLeft} 天` : ''}）
          </div>
          <div className="m-notice-actions">
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setPendingOpen(true)}>
              查看待完成
            </button>
            <button
              type="button"
              className="m-btn m-btn-ghost"
              onClick={() => {
                if (bannerDismissKey) localStorage.setItem(bannerDismissKey, '1');
                setBannerDismissed(true);
              }}
            >
              本学期不再提醒
            </button>
          </div>
        </div>
      )}

      {/* 筛选栏：班级下拉 + 关键字搜索（与桌面工具栏同能力，样式走移动端规范） */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <select
          className="m-inp"
          style={{ flex: '0 0 auto', width: 'auto', minWidth: 112 }}
          value={classId === '' ? '' : String(classId)}
          onChange={(e) => onClassChange(e.target.value === '' ? '' : Number(e.target.value))}
          aria-label="按班级筛选"
        >
          <option value="">全部班级</option>
          {classOptions.map((c) => (
            <option key={c.id} value={c.id}>{c.gradeName}·{c.name}</option>
          ))}
        </select>
        <input
          className="m-inp"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="姓名 / 学号 / 班级"
          value={kw}
          onChange={(e) => onKwChange(e.target.value)}
          aria-label="搜索姓名、学号或班级"
        />
      </div>

      <div className="m-t4">
        共 {total} 名关注学生{level === '全部' ? '' : `（${level}）`}
      </div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {canMentalWrite ? '当前没有需要关注的学生' : '暂无可查看的关注学生'}
          </div>
          <div className="m-t4" style={{ marginTop: 4 }}>
            {canMentalWrite
              ? '可通过「新增关注」把学生纳入关注名单'
              : '未分配带班班级或班级内暂无标记；维护请联系心理健康主负责辅导员或管理员'}
          </div>
        </div>
      ) : (
        list.map((c) => {
          const ivDone = c.interviewDone ?? 0;
          const ivRequired = c.interviewRequired || INTERVIEW_REQUIRED;
          const ivVisible = c.canInterview || ivDone > 0;
          // 无写权且已有记录（如「无需关注」留档学生）→ 只读查看
          const ivLabel = !c.canInterview && ivDone > 0
            ? '查看访谈记录'
            : ivDone >= ivRequired ? '查看访谈记录' : ivDone > 0 ? '继续访谈' : '填写心理访谈';
          return (
            <div className="m-card accent" key={c.studentId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`m-wbar ${LEVEL_BAR[c.level]}`} style={LEVEL_BAR_COLOR[c.level] ? { background: LEVEL_BAR_COLOR[c.level] } : undefined} />
                <span className="m-ava">{c.name.slice(0, 1)}</span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{c.name}</span>
                    <span className={LEVEL_TAG[c.level]}>{c.level}</span>
                    {c.followCount > 0 && <span className="m-tag danger">需跟进 {c.followCount}</span>}
                  </div>
                  <div className="m-t4" style={{ marginTop: 3 }}>
                    {c.className} · {c.studentNo}
                  </div>
                </div>
              </div>

              {c.note && (
                <div className="m-t3" style={{ marginTop: 8, lineHeight: 1.7 }}>{c.note}</div>
              )}

              <div className="m-t4" style={{ marginTop: 6 }}>
                谈话 {c.talkCount} 次{c.lastTalkTime ? ` · 最近 ${c.lastTalkTime.slice(0, 16)}` : ''}
              </div>

              {ivVisible && (
                <div className="m-t4" style={{ marginTop: 4 }}>
                  心理访谈 本学期 {ivDone}/{ivRequired}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {ivVisible && (
                  <button
                    type="button"
                    className="m-btn m-btn-primary"
                    style={{ flex: '1 1 100%' }}
                    onClick={() => openInterview(c.studentId)}
                  >
                    <MIcon name="heart" size={16} />
                    {ivLabel}
                  </button>
                )}
                <button type="button" className="m-btn m-btn-soft" style={{ flex: '1 1 44%' }} onClick={() => openTalks(c)}>
                  <MIcon name="comment" size={16} />
                  谈话记录
                </button>
                {/* 新增谈话：管理员/辅导员角色 + 三类关注学生时显示；点击跳转学校外部谈话平台 */}
                {canWrite && TALK_RECORD_TARGET_LEVELS.includes(c.level) && (
                  <a
                    className="m-btn m-btn-soft"
                    style={{ flex: '1 1 44%', textDecoration: 'none' }}
                    href={TALK_RECORD_EXTERNAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MIcon name="extlink" size={16} />
                    新增谈话
                  </a>
                )}
                {canMentalWrite && (
                  <button type="button" className="m-btn m-btn-soft" style={{ flex: '1 1 44%' }} onClick={() => openAdjust(c)}>
                    <MIcon name="edit" size={16} />
                    调整关注
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {canMentalWrite && (
        <>
          <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => setTplSheetOpen(true)}>
            <MIcon name="file" size={16} />
            访谈记录单模板
          </button>
          <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => setImportOpen(true)}>
            <MIcon name="upload" size={16} />
            批量导入关注学生
          </button>
          <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => setExportOpen(true)}>
            <MIcon name="download" size={16} />
            导出访谈记录
          </button>
          <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={openCreate}>
            <MIcon name="plus" size={16} />
            新增关注
          </button>
        </>
      )}

      {loading && (
        <div className="m-loadmore">
          <MIcon name="spinner" size={16} className="m-spin" />
          加载中…
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
      {!loading && hasMore && (
        <button
          type="button"
          className="m-btn m-btn-ghost m-btn-block"
          onClick={() => {
            const f = filterRef.current;
            void fetchPage(page + 1, f.level, f.classId, f.kw);
          }}
        >
          加载更多（还有 {total - list.length} 条）
        </button>
      )}

      {/* 调整 / 新增关注标记 */}
      <FilterSheet
        open={sheet.open}
        title={sheet.mode === 'adjust' ? `调整关注 · ${sheet.student?.name ?? ''}` : '新增关注'}
        onClose={() => setSheet({ open: false, mode: 'adjust', student: null })}
        footer={
          <>
            {sheet.mode === 'adjust' && (
              <button type="button" className="m-btn m-btn-ghost" style={{ color: 'var(--danger-fg)' }} disabled={saving} onClick={clearMark}>
                取消关注
              </button>
            )}
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setSheet({ open: false, mode: 'adjust', student: null })}>
              取消
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              disabled={saving || (sheet.mode === 'create' && !sheet.student)}
              onClick={submitMark}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {sheet.mode === 'create' && (
          <div className="m-field">
            <label>选择学生（{isMentalOwner ? '全院' : '仅本班'}未标记学生）</label>
            <input
              className="m-inp"
              value={candidateKw}
              placeholder="输入姓名或学号搜索"
              onChange={(e) => setCandidateKw(e.target.value)}
            />
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {candidates.length === 0 && <span className="m-t4">没有可标记的学生</span>}
              {candidates.slice(0, 50).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`m-seg-btn${sheet.student?.id === c.id ? ' on' : ''}`}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 12 }}
                  onClick={() => setSheet((s) => ({ ...s, student: { id: String(c.id), name: c.name, studentNo: c.studentNo, className: c.className } }))}
                >
                  {c.name}·{c.className}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="m-field">
          <label>关注等级<span className="m-req">*</span></label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            {ATTENTION_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`m-seg-btn${markLevel === l ? ' on' : ''}`}
                onClick={() => setMarkLevel(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="m-field">
          <label>关注备注</label>
          <textarea
            className="m-inp"
            rows={3}
            maxLength={200}
            value={note}
            placeholder="记录关注事由与跟进安排（选填）"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </FilterSheet>

      {/* 谈心谈话记录（只读） */}
      <FilterSheet
        open={talksOpen}
        title={talks ? `谈心谈话 · ${talks.student.name}` : '谈心谈话记录'}
        onClose={() => setTalksOpen(false)}
      >
        {talksLoading && <div className="m-loadmore">加载中…</div>}
        {!talksLoading && talks && (
          <>
            <div className="m-t4" style={{ marginBottom: 8 }}>
              {talks.student.className} · {talks.student.studentNo} · 共 {talks.list.length} 条
            </div>
            {talks.list.length === 0 && (
              <div className="m-card empty">
                <div className="m-t3">该学生暂无谈心谈话记录</div>
              </div>
            )}
            {talks.list.map((c) => (
              <div className="m-card" key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="m-tag info">{c.type}</span>
                  <span className="m-tag neutral">{c.way}</span>
                  {c.needFollowUp && <span className="m-tag danger">需跟进</span>}
                  <span className="m-t4" style={{ marginLeft: 'auto' }}>{c.talkTime}</span>
                </div>
                <div className="m-t3" style={{ marginTop: 6, lineHeight: 1.7 }}>{c.content}</div>
                {c.followUp && (
                  <div className="m-t4" style={{ marginTop: 4, color: 'var(--warning-fg)' }}>跟进：{c.followUp}</div>
                )}
              </div>
            ))}
          </>
        )}
      </FilterSheet>

      {/* 心理访谈记录（查看/继续/补充） */}
      <FilterSheet
        open={ivSheetOpen}
        title={ivView ? `心理访谈 · ${ivView.student.name}` : '心理访谈'}
        onClose={() => setIvSheetOpen(false)}
        footer={
          ivView?.canWrite && (
            <button
              type="button"
              className="m-btn m-btn-primary"
              onClick={() => {
                setIvFormStudent(ivView.student);
                setIvFormRecord(null);
                setIvFormForm(ivView.form);
                setIvFormOpen(true);
              }}
            >
              <MIcon name="plus" size={16} />
              {ivView.done >= ivView.required ? '补充访谈' : '新增访谈'}
            </button>
          )
        }
      >
        {ivView && (
          <>
            <div className="m-t4">
              {ivView.student.className} · {ivView.student.studentNo} · {ivView.semester.label} ·
              本学期 {ivView.done}/{ivView.required} 次
            </div>

            {ivView.list.length === 0 && (
              <div className="m-card empty">
                <div className="m-t3">本学期暂无访谈记录</div>
              </div>
            )}

            {ivView.list.map((r) => {
              const canEditRecord = isAdmin || Number(r.interviewerId) === Number(authUser?.id);
              return (
                <div className="m-card" key={r.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-tag info">{r.interviewDate}</span>
                    <span className="m-tag neutral">评估：{r.levelAfter}</span>
                    <span className="m-t4" style={{ marginLeft: 'auto' }}>访谈教师 {r.interviewerName}</span>
                  </div>
                  <div className="m-t3" style={{ marginTop: 6, lineHeight: 1.7 }}>{r.summary}</div>
                  <details className="m-fold">
                    <summary>
                      查看全部问答
                      <MIcon name="chevD" size={14} className="m-fold-chev" />
                    </summary>
                    <div style={{ paddingTop: 6 }}>
                      {recordQaPairs(r, recordFormOf(r, ivView.form)).map((qa) => (
                        <div key={qa.key} style={{ marginBottom: 8 }}>
                          <div className="m-iv-qa-q">{qa.question}</div>
                          <div className="m-iv-qa-a">{qa.answer}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                  <div className="m-t4" style={{ marginTop: 6 }}>
                    签字：{r.signatureName} · {r.signedAt}{r.updatedBy ? `（修订 by ${r.updatedBy}）` : ''}
                  </div>
                  {canEditRecord && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="m-btn m-btn-soft"
                        style={{ flex: 1 }}
                        onClick={() => {
                          setIvFormStudent(ivView.student);
                          setIvFormRecord(r);
                          setIvFormForm(ivView.form);
                          setIvFormOpen(true);
                        }}
                      >
                        <MIcon name="edit" size={16} />
                        编辑
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn-soft"
                        style={{ flex: 1, color: 'var(--danger-fg)' }}
                        disabled={deletingRecordId === r.id}
                        onClick={() => handleDeleteRecord(r)}
                      >
                        <MIcon name="trash" size={16} />
                        作废
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="m-group-title" style={{ marginTop: 6 }}>关注等级变更</div>
            {ivLevelLogs.length === 0 ? (
              <div className="m-t4">暂无变更记录</div>
            ) : (
              ivLevelLogs.map((l) => (
                <div className="m-card" key={l.id} style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-tag neutral">{LEVEL_LOG_SOURCE_LABELS[l.source]}</span>
                    <span className="m-t4" style={{ marginLeft: 'auto' }}>{l.createdAt}</span>
                  </div>
                  <div className="m-t3" style={{ marginTop: 4 }}>
                    {levelLogText(l.fromLevel)} → {levelLogText(l.toLevel)}
                  </div>
                  {l.note && <div className="m-t4" style={{ marginTop: 2 }}>{l.note}</div>}
                </div>
              ))
            )}
          </>
        )}
      </FilterSheet>

      {/* 本学期待完成名单 */}
      <FilterSheet
        open={pendingOpen}
        title="本学期心理访谈待完成"
        onClose={() => setPendingOpen(false)}
      >
        {(overview?.pending ?? []).length === 0 ? (
          <div className="m-card empty">
            <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
            <div className="m-t3" style={{ marginTop: 6 }}>本学期全部达标</div>
          </div>
        ) : (
          (overview?.pending ?? []).map((p) => (
            <div className="m-card" key={p.id} style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="m-t2" style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="m-t4">{p.className}</span>
                {p.level && <span className="m-tag neutral">{p.level}</span>}
                <span className={`m-tag ${p.done >= p.required ? 'success' : p.done > 0 ? 'info' : 'danger'}`}>
                  {p.done}/{p.required}
                </span>
              </div>
              <button
                type="button"
                className="m-btn m-btn-soft m-btn-block"
                style={{ marginTop: 8 }}
                disabled={!p.canWrite}
                onClick={() => {
                  setPendingOpen(false);
                  void openInterview(String(p.id));
                }}
              >
                {p.done > 0 ? '继续访谈' : '填写访谈'}
              </button>
            </div>
          ))
        )}
      </FilterSheet>

      {/* 心理访谈记录单（动态分步向导） */}
      <InterviewFormSheet
        open={ivFormOpen}
        student={ivFormStudent}
        record={ivFormRecord}
        form={ivFormForm}
        onClose={() => {
          setIvFormOpen(false);
          setIvFormRecord(null);
        }}
        onSaved={(res) => {
          const syncTip = res.levelSynced
            ? res.levelAfter === '无需关注'
              ? '；已将该生标记为「无需关注」，保留在心理健康模块中'
              : `；关注等级已同步为「${res.levelAfter}」`
            : '';
          showToast(`已提交第 ${res.done} 次访谈（本学期 ${res.done}/${INTERVIEW_REQUIRED}）${syncTip}`);
          afterInterviewChanged(ivFormStudent?.id ?? ivFormRecord?.studentId);
        }}
      />

      {/* 心理访谈记录单模板（管理员/心理主负责） */}
      <TemplateManageSheet
        open={tplSheetOpen}
        onClose={() => setTplSheetOpen(false)}
        onSaved={(t) => showToast(`已保存模板「${t.name}」（v${t.version}）`)}
        onDeleted={(t) => showToast(`已删除模板「${t.name}」`)}
      />

      {/* 批量导入关注学生（管理员/心理主负责） */}
      <ImportConcernDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void reloadAll(level, classId, kw);
          reloadOverview();
        }}
      />

      {/* 批量导出访谈记录（管理员/心理主负责） */}
      <ExportInterviewDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

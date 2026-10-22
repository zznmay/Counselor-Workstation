import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getClassOptions } from '@/api/classes';
import {
  changeFundingStatus,
  createFunding,
  getFundingDetail,
  getFundingProfiles,
  getFundingStats,
  updateFunding,
} from '@/api/funding';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import {
  FUNDING_DIFFICULTY_TYPES,
  FUNDING_DISPLAY_STATUSES,
  FUNDING_LEVELS,
} from '@/constants';
import { useStudentOptions } from '@/hooks/useStudentOptions';
import type {
  ClassOption,
  FundingDetail,
  FundingDifficultyType,
  FundingDisplayStatus,
  FundingLevel,
  FundingLog,
  FundingProfile,
  FundingQuery,
  FundingStats,
  StudentOption,
} from '@/types';
import {
  academicYearRange,
  buildAcademicYearOptions,
  currentAcademicYear,
  formatFundingTypes,
} from '@/utils/funding';

const PAGE_SIZE = 10;

const STATUS_FILTERS: { key: FundingDisplayStatus | '全部'; label: string }[] = [
  { key: '全部', label: '全部' },
  ...FUNDING_DISPLAY_STATUSES.map((key) => ({ key, label: key })),
];

const LOG_LABEL: Record<FundingLog['action'], string> = {
  create: '新增认定',
  update: '更新信息',
  level_change: '调整等级',
  status_change: '状态变更',
  review: '复核确认',
  cancel: '取消认定',
  rollover: '学年结转',
  import: 'Excel 导入',
  reidentify: '重新认定',
};

function levelTagClass(level: FundingLevel): string {
  if (level === '特别困难') return 'danger';
  if (level === '困难') return 'warning';
  return 'neutral';
}

function statusTagClass(status: string): string {
  if (status === '已认定') return 'success';
  if (status === '待复核') return 'info';
  if (status === '已过期') return 'warning';
  return 'neutral';
}

function avatarClass(level: FundingLevel): string {
  if (level === '特别困难') return ' red';
  if (level === '困难') return ' orange';
  return '';
}

export default function FundingMobile() {
  const [status, setStatus] = useState<FundingDisplayStatus | '全部'>('全部');
  const [keyword, setKeyword] = useState('');
  const [year, setYear] = useState(currentAcademicYear());
  const [level, setLevel] = useState<FundingLevel | ''>('');
  const [grade, setGrade] = useState('');
  const [classId, setClassId] = useState<number | ''>('');

  const [draftYear, setDraftYear] = useState(year);
  const [draftLevel, setDraftLevel] = useState<FundingLevel | ''>('');
  const [draftGrade, setDraftGrade] = useState('');
  const [draftClassId, setDraftClassId] = useState<number | ''>('');
  const [filterOpen, setFilterOpen] = useState(false);

  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [stats, setStats] = useState<FundingStats | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);
  const [list, setList] = useState<FundingProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  const query = useMemo<FundingQuery>(() => ({
    page: 1,
    pageSize: PAGE_SIZE,
    academicYear: year,
    keyword: keyword.trim() || undefined,
    level: level || undefined,
    grade: grade || undefined,
    status: status === '全部' ? undefined : status,
    classIds: classId ? String(classId) : undefined,
  }), [year, keyword, level, grade, status, classId]);

  const loadPage = useCallback(async (targetPage: number, append: boolean) => {
    setLoading(true);
    try {
      const res = await getFundingProfiles({ ...query, page: targetPage, pageSize: PAGE_SIZE });
      setList((prev) => (append ? [...prev, ...res.list] : res.list));
      setTotal(res.total);
      setPage(targetPage);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [query, showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPage(1, false); }, 200);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  useEffect(() => {
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

  const gradeNames = useMemo(
    () => [...new Set(classOptions.map((c) => c.gradeName))],
    [classOptions],
  );

  const draftClassOptions = useMemo(
    () => (draftGrade ? classOptions.filter((c) => c.gradeName === draftGrade) : classOptions),
    [classOptions, draftGrade],
  );

  useEffect(() => {
    let alive = true;
    getFundingStats({ academicYear: year })
      .then((next) => { if (alive) setStats(next); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [year, statsVersion]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadPage(page + 1, true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, loadPage]);

  const reloadAll = useCallback(() => {
    setStatsVersion((v) => v + 1);
    void loadPage(1, false);
  }, [loadPage]);

  /* ---------- 详情 ---------- */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FundingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await getFundingDetail(id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  const openDetail = (record: FundingProfile) => {
    setDetailId(record.id);
    setDetail(null);
    void loadDetail(record.id);
  };

  /* ---------- 状态变更 ---------- */
  const [statusTarget, setStatusTarget] = useState<FundingProfile | null>(null);
  const [statusAction, setStatusAction] = useState<'confirm' | 'cancel'>('cancel');
  const [statusReason, setStatusReason] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const openStatus = (record: FundingProfile, action: 'confirm' | 'cancel') => {
    setStatusTarget(record);
    setStatusAction(action);
    setStatusReason('');
  };

  const submitStatus = async () => {
    if (!statusTarget) return;
    if (statusAction === 'cancel' && !statusReason.trim()) {
      showToast('请填写取消原因');
      return;
    }
    setStatusSaving(true);
    try {
      await changeFundingStatus(statusTarget.id, {
        action: statusAction,
        reason: statusReason.trim() || undefined,
      });
      showToast(statusAction === 'cancel' ? '已取消认定' : '已确认认定');
      setStatusTarget(null);
      setDetailId(null);
      reloadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败');
    } finally {
      setStatusSaving(false);
    }
  };

  /* ---------- 新增 / 编辑 / 重新认定 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FundingProfile | null>(null);
  const [source, setSource] = useState<FundingProfile | null>(null);
  const [pickedStudent, setPickedStudent] = useState<StudentOption | null>(null);
  const [formStudentId, setFormStudentId] = useState('');
  const [studentKeyword, setStudentKeyword] = useState('');
  const [formYear, setFormYear] = useState(currentAcademicYear());
  const [formLevel, setFormLevel] = useState<FundingLevel>('困难');
  const [formTypes, setFormTypes] = useState<FundingDifficultyType[]>([]);
  const [formIdentifiedAt, setFormIdentifiedAt] = useState('');
  const [formValidFrom, setFormValidFrom] = useState('');
  const [formValidTo, setFormValidTo] = useState('');
  const [formBasis, setFormBasis] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formReason, setFormReason] = useState('');
  const [saving, setSaving] = useState(false);

  const {
    options: studentOptions,
    loading: studentOptionsLoading,
    search: searchStudents,
  } = useStudentOptions({ enabled: formOpen, manageableOnly: true, selected: pickedStudent });

  const yearOptions = useMemo(() => {
    const options = buildAcademicYearOptions(5, 1);
    const extra = [editing?.academicYear, source?.academicYear].filter(Boolean) as string[];
    const values = new Set(options.map((o) => o.value));
    for (const value of extra) {
      if (!values.has(value)) options.push({ value, label: value });
    }
    return options.sort((a, b) => b.value.localeCompare(a.value));
  }, [editing, source]);

  const openForm = (record?: FundingProfile, reidentify?: FundingProfile) => {
    const nextYear = record?.academicYear ?? year;
    const range = academicYearRange(nextYear);
    setEditing(record && !reidentify ? record : null);
    setSource(reidentify ?? null);
    setPickedStudent(record ? {
      id: record.studentId,
      name: record.studentName,
      studentNo: record.studentNo,
      className: record.className,
    } : null);
    setFormStudentId(record?.studentId ?? '');
    setStudentKeyword('');
    setFormYear(nextYear);
    setFormLevel(record?.level ?? '困难');
    setFormTypes(record?.difficultyTypes ?? []);
    setFormIdentifiedAt(record && !reidentify ? record.identifiedAt : dayjs().format('YYYY-MM'));
    setFormValidFrom(reidentify ? range.validFrom : record?.validFrom ?? range.validFrom);
    setFormValidTo(reidentify ? range.validTo : record?.validTo ?? range.validTo);
    setFormBasis(record?.basis ?? '');
    setFormRemark(record?.remark ?? '');
    setFormReason('');
    searchStudents('');
    setFormOpen(true);
  };

  const toggleType = (type: FundingDifficultyType) => {
    setFormTypes((prev) => (
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    ));
  };

  const submitForm = async () => {
    if (!formStudentId) {
      showToast('请选择学生');
      return;
    }
    if (!formIdentifiedAt || !formValidFrom || !formValidTo) {
      showToast('请填写完整日期');
      return;
    }
    if (formValidTo < formValidFrom) {
      showToast('有效期止不能早于有效期起');
      return;
    }
    if ((editing || source) && !formReason.trim()) {
      showToast(source ? '请填写重新认定原因' : '请填写变更原因');
      return;
    }

    setSaving(true);
    try {
      const base = {
        level: formLevel,
        difficultyTypes: formTypes,
        identifiedAt: formIdentifiedAt,
        validFrom: formValidFrom,
        validTo: formValidTo,
        basis: formBasis,
        remark: formRemark,
        reason: formReason.trim() || undefined,
      };
      if (editing) {
        await updateFunding(editing.id, base);
        showToast('认定信息已更新');
      } else {
        await createFunding({
          ...base,
          studentId: formStudentId,
          academicYear: formYear,
          previousId: source?.id ?? null,
        });
        showToast(source ? '已重新认定' : '认定已建立');
      }
      setFormOpen(false);
      reloadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const applyFilters = () => {
    setYear(draftYear);
    setLevel(draftLevel);
    setGrade(draftGrade);
    setClassId(draftClassId);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setDraftYear(currentAcademicYear());
    setDraftLevel('');
    setDraftGrade('');
    setDraftClassId('');
    setYear(currentAcademicYear());
    setLevel('');
    setGrade('');
    setClassId('');
    setFilterOpen(false);
  };

  const classLabel = classId ? classOptions.find((c) => c.id === classId)?.name : '';

  return (
    <>
      <div className="m-card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="m-t1">本学年认定概览</span>
          <span className="m-t4">{year}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.summary.identifiedCount ?? 0}</div>
            <div className="m-t4">已认定</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.summary.pendingCount ?? 0}</div>
            <div className="m-t4">待复核</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.summary.expiringCount ?? 0}</div>
            <div className="m-t4">30 天内到期</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`m-seg-btn${status === item.key ? ' on' : ''}`}
            style={{ flex: '0 0 auto' }}
            onClick={() => setStatus(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="m-search-row">
        <div className="m-search-field">
          <MIcon name="search" size={16} />
          <input
            className="m-inp"
            type="search"
            value={keyword}
            placeholder="搜索学生 / 学号 / 班级"
            aria-label="搜索困难生认定"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="m-btn m-btn-ghost"
          onClick={() => {
            setDraftYear(year);
            setDraftLevel(level);
            setDraftGrade(grade);
            setDraftClassId(classId);
            setFilterOpen(true);
          }}
        >
          <MIcon name="funnel" size={16} />
          筛选
        </button>
      </div>

      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span>
          共 {total} 条认定
          {grade ? ` · ${grade}` : ''}
          {classLabel ? ` · ${classLabel}` : ''}
          {level ? ` · ${level}` : ''}
        </span>
        <button
          type="button"
          className="m-btn m-btn-soft"
          style={{ marginLeft: 'auto', minHeight: 32, padding: '4px 10px' }}
          onClick={() => openForm()}
        >
          <MIcon name="plus" size={14} />
          新增认定
        </button>
      </div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="gift" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>当前条件下没有困难生认定记录</div>
          <div className="m-t4" style={{ marginTop: 4 }}>可点击「新增认定」建立档案，或在桌面端批量导入</div>
        </div>
      ) : (
        list.map((item) => (
          <div className="m-card press" key={item.id} onClick={() => openDetail(item)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`m-ava${avatarClass(item.level)}`}>{item.studentName.slice(0, 1)}</span>
              <div className="m-row-main">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="m-t1">{item.studentName}</span>
                  <span className={`m-tag ${levelTagClass(item.level)}`}>{item.level}</span>
                  <span className={`m-tag ${statusTagClass(item.displayStatus)}`}>{item.displayStatus}</span>
                </div>
                <div className="m-t4" style={{ marginTop: 3 }}>
                  {item.className} · {item.studentNo} · {item.academicYear}
                </div>
              </div>
            </div>
            <div className="m-t3" style={{ marginTop: 8 }}>
              {formatFundingTypes(item.difficultyTypes) || '未填写困难类型'}
            </div>
            <div className="m-t4" style={{ marginTop: 4 }}>
              有效期至 {item.validTo}
              {item.studentStatus && item.studentStatus !== '在读' && ` · 学生${item.studentStatus}`}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {item.status === '待复核' && (
                <button
                  type="button"
                  className="m-btn m-btn-soft"
                  style={{ flex: 1 }}
                  onClick={(e) => { e.stopPropagation(); openStatus(item, 'confirm'); }}
                >
                  确认复核
                </button>
              )}
              {item.status !== '已取消' && (
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  style={{ flex: 1 }}
                  onClick={(e) => { e.stopPropagation(); openForm(item); }}
                >
                  <MIcon name="edit" size={14} />
                  编辑
                </button>
              )}
              {item.status === '已取消' && (
                <button
                  type="button"
                  className="m-btn m-btn-soft"
                  style={{ flex: 1 }}
                  onClick={(e) => { e.stopPropagation(); openForm(undefined, item); }}
                >
                  重新认定
                </button>
              )}
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
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void loadPage(page + 1, true)}>
          加载更多（还有 {total - list.length} 条）
        </button>
      )}

      {/* 筛选 */}
      <FilterSheet
        open={filterOpen}
        title="筛选困难生认定"
        onClose={() => setFilterOpen(false)}
        footer={(
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={resetFilters}>重置</button>
            <button type="button" className="m-btn m-btn-primary" onClick={applyFilters}>确定</button>
          </>
        )}
      >
        <div className="m-field">
          <label>认定学年</label>
          <select className="m-inp" value={draftYear} onChange={(e) => setDraftYear(e.target.value)}>
            {buildAcademicYearOptions(5, 1).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>困难等级</label>
          <select className="m-inp" value={draftLevel} onChange={(e) => setDraftLevel(e.target.value as FundingLevel | '')}>
            <option value="">全部等级</option>
            {FUNDING_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>年级</label>
          <select
            className="m-inp"
            value={draftGrade}
            onChange={(e) => {
              setDraftGrade(e.target.value);
              setDraftClassId('');
            }}
          >
            <option value="">全部年级</option>
            {gradeNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>班级</label>
          <select className="m-inp" value={draftClassId} onChange={(e) => setDraftClassId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">全部班级</option>
            {draftClassOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {draftGrade ? c.name : `${c.gradeName}·${c.name}`}
              </option>
            ))}
          </select>
        </div>
      </FilterSheet>

      {/* 详情 */}
      <FilterSheet
        open={!!detailId}
        title={detail ? `认定详情 · ${detail.studentName}` : '认定详情'}
        fullscreen
        onClose={() => setDetailId(null)}
      >
        {detailLoading && (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <MIcon name="spinner" size={20} className="m-spin" />
          </div>
        )}
        {!detailLoading && detail && (
          <>
            <div className="m-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`m-ava${avatarClass(detail.level)}`}>{detail.studentName.slice(0, 1)}</span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{detail.studentName}</span>
                    <span className={`m-tag ${levelTagClass(detail.level)}`}>{detail.level}</span>
                    <span className={`m-tag ${statusTagClass(detail.displayStatus)}`}>{detail.displayStatus}</span>
                  </div>
                  <div className="m-t4" style={{ marginTop: 3 }}>
                    {detail.className} · {detail.studentNo} · {detail.academicYear}
                  </div>
                </div>
              </div>
              <div className="m-t3" style={{ marginTop: 10 }}>
                困难类型：{formatFundingTypes(detail.difficultyTypes) || '—'}
              </div>
              <div className="m-t3" style={{ marginTop: 4 }}>认定日期：{detail.identifiedAt || '—'}</div>
              <div className="m-t3" style={{ marginTop: 4 }}>有效期：{detail.validFrom} ~ {detail.validTo}</div>
              <div className="m-t3" style={{ marginTop: 4 }}>认定依据：{detail.basis || '—'}</div>
              {detail.remark && <div className="m-t3" style={{ marginTop: 4 }}>备注：{detail.remark}</div>}
              {detail.cancelReason && (
                <div className="m-t3" style={{ marginTop: 4, color: 'var(--danger-fg)' }}>取消原因：{detail.cancelReason}</div>
              )}
            </div>

            {detail.warnings.length > 0 && (
              <div className="m-card">
                <div className="m-t1" style={{ marginBottom: 8 }}>关联经济困难预警</div>
                {detail.warnings.map((w) => (
                  <div className="m-t3" key={w.id} style={{ marginBottom: 6 }}>
                    [{w.level}] {w.reason}（{w.status}）
                  </div>
                ))}
              </div>
            )}

            <div className="m-card">
              <div className="m-t1" style={{ marginBottom: 8 }}>变更时间线</div>
              {detail.logs.length === 0 ? (
                <div className="m-t4">暂无变更记录</div>
              ) : (
                detail.logs.map((log) => (
                  <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--m-border)' }}>
                    <div className="m-t3">
                      {LOG_LABEL[log.action] ?? log.action}
                      {log.fromLevel && log.toLevel && log.fromLevel !== log.toLevel && `：${log.fromLevel} → ${log.toLevel}`}
                    </div>
                    <div className="m-t4" style={{ marginTop: 2 }}>
                      {log.operatorName ?? '系统'} · {log.createdAt}
                    </div>
                    {log.reason && <div className="m-t3" style={{ marginTop: 3 }}>{log.reason}</div>}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detail.status === '待复核' && (
                <button type="button" className="m-btn m-btn-primary" style={{ flex: 1 }} onClick={() => { setDetailId(null); openStatus(detail, 'confirm'); }}>
                  确认复核
                </button>
              )}
              {detail.status !== '已取消' && (
                <>
                  <button type="button" className="m-btn m-btn-soft" style={{ flex: 1 }} onClick={() => { setDetailId(null); openForm(detail); }}>
                    编辑
                  </button>
                  <button type="button" className="m-btn m-btn-ghost" style={{ flex: 1, color: 'var(--danger-fg)' }} onClick={() => { setDetailId(null); openStatus(detail, 'cancel'); }}>
                    取消认定
                  </button>
                </>
              )}
              {detail.status === '已取消' && (
                <button type="button" className="m-btn m-btn-primary" style={{ flex: 1 }} onClick={() => { setDetailId(null); openForm(undefined, detail); }}>
                  重新认定
                </button>
              )}
            </div>
          </>
        )}
      </FilterSheet>

      {/* 新增 / 编辑 / 重新认定 */}
      <FilterSheet
        open={formOpen}
        title={editing ? `编辑认定 · ${editing.studentName}` : source ? `重新认定 · ${source.studentName}` : '新增困难生认定'}
        fullscreen
        dismissible={false}
        onClose={() => setFormOpen(false)}
        footer={(
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setFormOpen(false)}>取消</button>
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={submitForm}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        )}
      >
        <div className="m-field">
          <label>学生<span className="m-req">*</span></label>
          {editing || source ? (
            <div className="m-inp" style={{ display: 'flex', alignItems: 'center' }}>
              {pickedStudent?.name}（{pickedStudent?.className} · {pickedStudent?.studentNo}）
            </div>
          ) : (
            <>
              <input
                className="m-inp"
                type="search"
                value={studentKeyword}
                placeholder="输入姓名或学号搜索学生"
                onChange={(e) => {
                  setStudentKeyword(e.target.value);
                  searchStudents(e.target.value);
                }}
              />
              <select
                className="m-inp"
                value={formStudentId}
                onChange={(e) => {
                  const id = e.target.value;
                  setFormStudentId(id);
                  setPickedStudent(studentOptions.find((s) => s.id === id) ?? null);
                }}
              >
                <option value="">{studentOptionsLoading ? '加载中…' : '请选择学生'}</option>
                {studentOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}（{s.className} · {s.studentNo}）</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="m-field">
          <label>认定学年<span className="m-req">*</span></label>
          <select
            className="m-inp"
            value={formYear}
            disabled={!!editing || !!source}
            onChange={(e) => {
              const next = e.target.value;
              const range = academicYearRange(next);
              setFormYear(next);
              setFormValidFrom(range.validFrom);
              setFormValidTo(range.validTo);
            }}
          >
            {yearOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>困难等级<span className="m-req">*</span></label>
          <select className="m-inp" value={formLevel} onChange={(e) => setFormLevel(e.target.value as FundingLevel)}>
            {FUNDING_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label>困难类型（可多选）</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FUNDING_DIFFICULTY_TYPES.map((type) => {
              const active = formTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`m-btn ${active ? 'm-btn-soft' : 'm-btn-ghost'}`}
                  style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
                  onClick={() => toggleType(type)}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
        <div className="m-field">
          <label>认定月份<span className="m-req">*</span></label>
          <input className="m-inp" type="month" value={formIdentifiedAt} onChange={(e) => setFormIdentifiedAt(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="m-field">
            <label>有效期起<span className="m-req">*</span></label>
            <input className="m-inp" type="month" value={formValidFrom} onChange={(e) => setFormValidFrom(e.target.value)} />
          </div>
          <div className="m-field">
            <label>有效期止<span className="m-req">*</span></label>
            <input className="m-inp" type="month" value={formValidTo} onChange={(e) => setFormValidTo(e.target.value)} />
          </div>
        </div>
        <div className="m-field">
          <label>认定依据</label>
          <textarea className="m-inp" rows={3} value={formBasis} placeholder="如低保、特困供养、突发严重困难等" onChange={(e) => setFormBasis(e.target.value)} />
        </div>
        <div className="m-field">
          <label>备注</label>
          <textarea className="m-inp" rows={2} value={formRemark} placeholder="其它需要说明的情况" onChange={(e) => setFormRemark(e.target.value)} />
        </div>
        {(editing || source) && (
          <div className="m-field">
            <label>{source ? '重新认定原因' : '本次变更原因'}<span className="m-req">*</span></label>
            <textarea className="m-inp" rows={2} value={formReason} placeholder="用于变更留痕" onChange={(e) => setFormReason(e.target.value)} />
          </div>
        )}
      </FilterSheet>

      {/* 状态变更 */}
      <FilterSheet
        open={!!statusTarget}
        title={statusAction === 'cancel' ? `取消认定 · ${statusTarget?.studentName ?? ''}` : `确认复核 · ${statusTarget?.studentName ?? ''}`}
        onClose={() => setStatusTarget(null)}
        footer={(
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setStatusTarget(null)}>返回</button>
            <button
              type="button"
              className={`m-btn ${statusAction === 'cancel' ? 'm-btn-danger' : 'm-btn-primary'}`}
              disabled={statusSaving}
              onClick={submitStatus}
            >
              {statusSaving ? '提交中…' : statusAction === 'cancel' ? '确认取消' : '确认认定'}
            </button>
          </>
        )}
      >
        <div className="m-t3">
          {statusAction === 'cancel'
            ? '取消后记录会保留为历史，可在「已取消」中查看并重新认定。'
            : '确认后记录状态变为「已认定」，本学年正式生效。'}
        </div>
        <div className="m-field">
          <label>{statusAction === 'cancel' ? '取消原因' : '复核说明'}{statusAction === 'cancel' && <span className="m-req">*</span>}</label>
          <textarea className="m-inp" rows={3} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder={statusAction === 'cancel' ? '请填写取消原因' : '选填'} />
        </div>
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

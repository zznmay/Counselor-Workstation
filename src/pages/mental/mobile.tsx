import { useCallback, useEffect, useRef, useState } from 'react';

import { getMentalCandidates, getMentalConcerns, getMentalSummary, getMentalTimeline, setAttention } from '@/api/mental';
import { MIcon } from '@/components/mobile/icons';
import FilterSheet from '@/components/mobile/FilterSheet';
import { ATTENTION_LEVELS } from '@/constants/mental';
import type { AttentionLevel, MentalCandidate, MentalConcern, MentalLevelSummary, MentalTimeline } from '@/types';
import { getStoredUser, isSystemAdmin } from '@/lib/auth';

const PAGE_SIZE = 10;

/** 等级视觉三编码：色条 + 标签色（不靠颜色单独表意，文字始终可见） */
const LEVEL_TAG: Record<AttentionLevel, string> = {
  密切关注: 'm-tag lv-red',
  重点关注: 'm-tag lv-orange',
  日常关注: 'm-tag info',
  一般关注: 'm-tag neutral',
};
const LEVEL_BAR: Record<AttentionLevel, string> = {
  密切关注: 'm-wbar m-wbar-red',
  重点关注: 'm-wbar m-wbar-orange',
  日常关注: 'm-wbar',
  一般关注: 'm-wbar',
};
const LEVEL_BAR_COLOR: Record<AttentionLevel, string> = {
  密切关注: '',
  重点关注: '',
  日常关注: 'linear-gradient(180deg, #4a7ae0 0%, #3f66cb 100%)',
  一般关注: '#9aa7c2',
};

type LevelFilter = AttentionLevel | '全部';
const LEVEL_FILTERS: LevelFilter[] = ['密切关注', '重点关注', '日常关注', '一般关注', '全部'];

/** 标记面板：mode=adjust 调整已有 / create 新增（先选学生） */
interface SheetState {
  open: boolean;
  mode: 'adjust' | 'create';
  student: { id: string; name: string; studentNo: string; className: string } | null;
}

/**
 * 移动端心理健康：等级分段筛选 + 学生卡片；谈话记录只读打通。
 * 数据范围与服务端一致：仅本班被标记学生（带班为空时列表恒空）。
 */
export default function MentalMobile() {
  const authUser = getStoredUser();
  const isAdmin = isSystemAdmin(authUser);
  const canWrite = isAdmin || (authUser?.classIds ?? []).length > 0;

  const [list, setList] = useState<MentalConcern[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('全部');
  const [summary, setSummary] = useState<MentalLevelSummary[]>([]);

  const [sheet, setSheet] = useState<SheetState>({ open: false, mode: 'adjust', student: null });
  const [markLevel, setMarkLevel] = useState<AttentionLevel>('重点关注');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [candidates, setCandidates] = useState<MentalCandidate[]>([]);
  const [candidateKw, setCandidateKw] = useState('');

  const [talks, setTalks] = useState<MentalTimeline | null>(null);
  const [talksOpen, setTalksOpen] = useState(false);
  const [talksLoading, setTalksLoading] = useState(false);

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  const fetchPage = useCallback(async (targetPage: number, lv: LevelFilter) => {
    setLoading(true);
    try {
      const res = await getMentalConcerns({
        page: targetPage,
        pageSize: PAGE_SIZE,
        ...(lv === '全部' ? {} : { level: lv }),
      });
      setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
      setTotal(res.total);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadAll = useCallback(async (lv: LevelFilter) => {
    getMentalSummary().then(setSummary).catch(() => undefined);
    await fetchPage(1, lv);
  }, [fetchPage]);

  useEffect(() => {
    void reloadAll(level);
  }, [level, reloadAll]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchPage(page + 1, level);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, level, fetchPage]);

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
    getMentalCandidates().then(setCandidates).catch(() => undefined);
  };

  /** 候选学生本地过滤（服务端已限定可见范围与未标记） */
  const visibleCandidates = candidates.filter((c) => {
    const kw = candidateKw.trim();
    if (!kw) return true;
    return c.name.includes(kw) || c.studentNo.includes(kw) || c.className.includes(kw);
  });

  const submitMark = async () => {
    if (sheet.mode === 'create' && !sheet.student) return;
    if (!sheet.student) return;
    setSaving(true);
    try {
      await setAttention(sheet.student.id, { level: markLevel, note: note.trim() });
      setSheet({ open: false, mode: 'adjust', student: null });
      showToast(sheet.mode === 'adjust' ? `已更新「${sheet.student.name}」的关注等级` : `已将「${sheet.student.name}」纳入关注`);
      await reloadAll(level);
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
      await reloadAll(level);
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

      <div className="m-t4">
        共 {total} 名关注学生{level === '全部' ? '' : `（${level}）`}
      </div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {canWrite ? '当前没有需要关注的学生' : '暂无可查看的关注学生'}
          </div>
          <div className="m-t4" style={{ marginTop: 4 }}>
            {canWrite ? '可通过「新增关注」把学生纳入关注名单' : '未分配带班班级或班级内暂无标记'}
          </div>
        </div>
      ) : (
        list.map((c) => (
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

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="m-btn m-btn-soft" style={{ flex: 1 }} onClick={() => openTalks(c)}>
                <MIcon name="comment" size={16} />
                谈话记录
              </button>
              {canWrite && (
                <button type="button" className="m-btn m-btn-primary" style={{ flex: 1 }} onClick={() => openAdjust(c)}>
                  <MIcon name="edit" size={16} />
                  调整关注
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {canWrite && (
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={openCreate}>
          <MIcon name="plus" size={16} />
          新增关注
        </button>
      )}

      {loading && (
        <div className="m-loadmore">
          <MIcon name="spinner" size={16} className="m-spin" />
          加载中…
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
      {!loading && hasMore && (
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void fetchPage(page + 1, level)}>
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
            <label>选择学生（仅本班未标记学生）</label>
            <input
              className="m-inp"
              value={candidateKw}
              placeholder="输入姓名或学号筛选"
              onChange={(e) => setCandidateKw(e.target.value)}
            />
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visibleCandidates.length === 0 && <span className="m-t4">没有可标记的学生</span>}
              {visibleCandidates.slice(0, 20).map((c) => (
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

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}

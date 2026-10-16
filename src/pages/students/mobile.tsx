import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getStudents } from '@/api/student';
import { getWarnings } from '@/api/warning';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { GRADES, MAJORS, STUDENT_STATUSES } from '@/constants';
import type { Student, StudentQuery, StudentStatus, WarningLevel } from '@/types';

const PAGE_SIZE = 10;

/** 预警级别 → 标签（颜色 + 图标 + 文字三编码） */
const LEVEL_TAG: Record<WarningLevel, { cls: string; icon: 'alertTriangle' | 'alertCircle' | 'flag'; text: string }> = {
  红色: { cls: 'lv-red', icon: 'alertTriangle', text: '红色预警' },
  橙色: { cls: 'lv-orange', icon: 'alertCircle', text: '橙色预警' },
  黄色: { cls: 'lv-yellow', icon: 'flag', text: '黄色预警' },
};

/** 手机号脱敏：保留前 3 后 4 */
function maskPhone(phone: string): string {
  if (!phone) return '—';
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : `${phone.slice(0, 2)}****${phone.slice(-2)}`;
}

/**
 * 移动端学生管理：卡片列表替代桌面 Table。
 * - 搜索常驻；筛选走底部抽屉（单手可达）
 * - 上拉加载更多（IntersectionObserver）+ 顶部手动刷新
 * - 卡片首屏必读：姓名·班级/专业·归属；一眼可见：预警·学号；折叠：宿舍/电话
 * - 卡内快捷操作热区 ≥44px；整卡可点进详情
 */
export default function StudentsMobile() {
  const navigate = useNavigate();

  const [list, setList] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<{ grade?: string; major?: string; status?: StudentStatus }>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  /** 未解除预警学生 → 级别（用于在卡片上标注预警状态） */
  const [warnMap, setWarnMap] = useState<Record<string, WarningLevel>>({});

  const loadWarnMap = useCallback(async () => {
    const [pending, handling] = await Promise.all([
      getWarnings({ page: 1, pageSize: 100, status: '待处理' }),
      getWarnings({ page: 1, pageSize: 100, status: '处理中' }),
    ]);
    const map: Record<string, WarningLevel> = {};
    [...pending.list, ...handling.list].forEach((w) => {
      // 同一学生取更严重级别
      const order: WarningLevel[] = ['黄色', '橙色', '红色'];
      const prev = map[w.studentId];
      if (!prev || order.indexOf(w.level) > order.indexOf(prev)) map[w.studentId] = w.level;
    });
    setWarnMap(map);
  }, []);

  const fetchPage = useCallback(
    async (targetPage: number, applied: { keyword: string; filters: typeof filters }) => {
      setLoading(true);
      try {
        const query: StudentQuery = {
          page: targetPage,
          pageSize: PAGE_SIZE,
          keyword: applied.keyword || undefined,
          grade: applied.filters.grade,
          major: applied.filters.major,
          status: applied.filters.status,
        };
        const res = await getStudents(query);
        setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
        setTotal(res.total);
        setPage(targetPage);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /* 关键词防抖 300ms；筛选变化立即回到第 1 页 */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void fetchPage(1, { keyword, filters });
      void loadWarnMap();
      return;
    }
    const timer = setTimeout(() => void fetchPage(1, { keyword, filters }), 300);
    return () => clearTimeout(timer);
  }, [keyword, filters, fetchPage, loadWarnMap]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchPage(page + 1, { keyword, filters });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, keyword, filters, fetchPage]);

  const openDetail = (s: Student) => navigate(`/students/${s.id}`);
  const resetFilters = () => {
    setDraft({});
    setFilters({});
    setSheetOpen(false);
  };

  return (
    <>
      <div className="m-search-row">
        <div className="m-search-field">
          <MIcon name="search" size={16} />
          <input
            className="m-inp"
            type="search"
            value={keyword}
            placeholder="搜索姓名 / 学号 / 班级"
            aria-label="搜索学生"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <button type="button" className="m-btn m-btn-ghost" onClick={() => { setDraft(filters); setSheetOpen(true); }}>
          <MIcon name="funnel" size={16} />
          筛选
        </button>
      </div>

      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        共 {total} 名学生{Object.values(filters).some(Boolean) ? '（已筛选）' : ''}
        <button type="button" className="m-refresh" style={{ marginLeft: 'auto', width: 32, height: 32 }} aria-label="刷新列表" onClick={() => void fetchPage(1, { keyword, filters })}>
          <MIcon name="refresh" size={16} />
        </button>
      </div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="search" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            没有符合条件的学生
          </div>
          <button type="button" className="m-btn m-btn-soft" style={{ marginTop: 10 }} onClick={resetFilters}>
            重置筛选
          </button>
        </div>
      ) : (
        list.map((s) => {
          const level = warnMap[s.id];
          const tag = level ? LEVEL_TAG[level] : null;
          return (
            <div className="m-card press" key={s.id} onClick={() => openDetail(s)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDetail(s); }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`m-ava${level === '红色' ? ' red' : level === '橙色' ? ' orange' : ''}`}>
                  {s.name.slice(0, 1)}
                </span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{s.name}</span>
                    {tag && (
                      <span className={`m-tag ${tag.cls}`}>
                        <MIcon name={tag.icon} size={12} />
                        {tag.text}
                      </span>
                    )}
                    {s.status !== '在读' && <span className="m-tag neutral">{s.status}</span>}
                  </div>
                  <div className="m-t3" style={{ marginTop: 3 }}>
                    {s.className} · {s.major}
                  </div>
                </div>
                <MIcon name="chevR" size={18} />
              </div>

              <div className="m-t4" style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span className="m-nowrap">学号 {s.studentNo}</span>
                <span className="m-nowrap">{s.grade}</span>
                <span className="m-nowrap">电话 {maskPhone(s.phone)}</span>
              </div>

              {/* 快捷操作：热区 ≥44px，与整卡点击解耦（阻止冒泡） */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6, borderTop: '1px solid var(--m-border)', paddingTop: 4 }}>
                {([
                  ['phone', '拨号', `tel:${s.phone}`],
                  ['message', '短信', `sms:${s.phone}`],
                  ['comment', '谈心', `/conversations?studentId=${s.id}`],
                  ['triangle', '预警', `/warnings?studentId=${s.id}`],
                ] as const).map(([icon, label, target]) => (
                  <a
                    key={label}
                    className="m-act"
                    href={target.startsWith('/') ? undefined : target}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (target.startsWith('/')) navigate(target);
                    }}
                    aria-label={`${label} ${s.name}`}
                  >
                    <MIcon name={icon} size={18} />
                    {label}
                  </a>
                ))}
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
        <button type="button" className="m-btn m-btn-ghost m-btn-block" onClick={() => void fetchPage(page + 1, { keyword, filters })}>
          加载更多（还有 {total - list.length} 人）
        </button>
      )}
      {!hasMore && list.length > 0 && <div className="m-loadmore">已加载全部 {total} 名学生</div>}

      <FilterSheet
        open={sheetOpen}
        title="筛选学生"
        onClose={() => setSheetOpen(false)}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={resetFilters}>重置</button>
            <button type="button" className="m-btn m-btn-primary" onClick={() => { setFilters(draft); setSheetOpen(false); }}>
              确定
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>年级</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`m-seg-btn${!draft.grade ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, grade: undefined }))}>全部</button>
            {GRADES.map((g) => (
              <button key={g} type="button" className={`m-seg-btn${draft.grade === g ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, grade: g }))}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="m-field">
          <label>专业</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`m-seg-btn${!draft.major ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, major: undefined }))}>全部</button>
            {MAJORS.map((m) => (
              <button key={m} type="button" className={`m-seg-btn${draft.major === m ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, major: m }))}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="m-field">
          <label>学籍状态</label>
          <div className="m-seg">
            <button type="button" className={`m-seg-btn${!draft.status ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, status: undefined }))}>全部</button>
            {STUDENT_STATUSES.map((st) => (
              <button key={st} type="button" className={`m-seg-btn${draft.status === st ? ' on' : ''}`} onClick={() => setDraft((d) => ({ ...d, status: st }))}>
                {st}
              </button>
            ))}
          </div>
        </div>
      </FilterSheet>
    </>
  );
}

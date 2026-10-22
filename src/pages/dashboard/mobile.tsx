import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import { updateTodo } from '@/api/todo';
import { MIcon } from '@/components/mobile/icons';
import type { MIconName } from '@/components/mobile/icons';
import { getStoredUser } from '@/lib/auth';
import type { DashboardStats, Todo, Warning, WarningLevel } from '@/types';

/** 预警级别 → 图标 + 标签样式（颜色 + 图标 + 文字三编码，不靠颜色单独表意） */
const LEVEL_META: Record<WarningLevel, { icon: MIconName; tag: string; bar: string; text: string }> = {
  红色: { icon: 'alertTriangle', tag: 'lv-red', bar: 'm-wbar-red', text: '红色预警' },
  橙色: { icon: 'alertCircle', tag: 'lv-orange', bar: 'm-wbar-orange', text: '橙色预警' },
  黄色: { icon: 'flag', tag: 'lv-yellow', bar: 'm-wbar-yellow', text: '黄色预警' },
};

const STATUS_TAG: Record<string, { cls: string; text: string }> = {
  待处理: { cls: 'danger', text: '待处理' },
  处理中: { cls: 'info', text: '处理中' },
  已解除: { cls: 'success', text: '已解除' },
};

/** 迷你条形图（纯 CSS，无图表库依赖；移动端紧凑版） */
function MiniBars({ data, gradient }: { data: { label: string; count: number }[]; gradient: string }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div>
      {data.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
          <span className="m-t4" style={{ flex: '0 0 72px' }}>{item.label}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--m-sunken)', overflow: 'hidden' }}>
            <div style={{ width: `${(item.count / max) * 100}%`, height: '100%', background: gradient }} />
          </div>
          <span className="m-t4 m-nowrap" style={{ minWidth: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function WarningRow({ w, onClick }: { w: Warning; onClick: () => void }) {
  const meta = LEVEL_META[w.level];
  const tag = STATUS_TAG[w.status] ?? { cls: 'neutral', text: w.status };
  return (
    <button type="button" className="m-row" onClick={onClick} style={{ width: '100%', background: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
      <span className={`m-wbar ${meta.bar}`} />
      <span className={`m-ava${w.level === '红色' ? ' red' : w.level === '橙色' ? ' orange' : ''}`}>
        {w.studentName.slice(0, 1)}
      </span>
      <span className="m-row-main">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="m-t1">{w.studentName}</span>
          <span className={`m-tag ${meta.tag}`}>
            <MIcon name={meta.icon} size={12} />
            {meta.text}
          </span>
        </span>
        <span className="m-t4" style={{ display: 'block', marginTop: 3 }}>
          {w.className} · {w.type} · {w.raisedAt.slice(0, 10)}
        </span>
      </span>
      <span className="m-row-side">
        <span className={`m-tag ${tag.cls}`}>{tag.text}</span>
      </span>
    </button>
  );
}

/** 移动端工作台：问候条 + 关键数据 2×2 + 预警 / 待办 / 审批三张核心卡 + 类型分布 */
export default function DashboardMobile() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [greetOpen, setGreetOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    getDashboardStats().then(setStats).catch(() => undefined);
  }, []);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  if (!stats) {
    return (
      <div className="m-loadmore" style={{ padding: '80px 0' }}>
        <MIcon name="spinner" size={18} className="m-spin" />
        正在加载工作台数据…
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const shownName = getStoredUser()?.displayName || '老师';

  const completeTodo = async (todo: Todo) => {
    setBusyId(todo.id);
    try {
      await updateTodo(todo.id, { status: '已完成' });
      const next = await getDashboardStats();
      setStats(next);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {greetOpen && (
        <div className="m-greet">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="m-greet-t">
              {greeting}，{shownName}
            </div>
            <div className="m-greet-s">
              当前 {stats.todayTodoCount} 项待办 · {stats.pendingWarningCount} 名预警学生待关注
            </div>
          </div>
          <button type="button" className="m-refresh m-greet-x" aria-label="关闭问候条" onClick={() => setGreetOpen(false)}>
            <MIcon name="x" size={18} />
          </button>
        </div>
      )}

      {/* 关键数据 2×2：同面板 + 发丝分隔，无独立卡壳 */}
      <div className="m-card m-stat-panel">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="grid4" size={16} />
            关键数据
          </span>
        </div>
        <div className="m-stat-grid">
          <div className="m-stat-cell">
            <div className="m-stat-v">{stats.studentCount}</div>
            <div className="m-stat-l">在读学生</div>
          </div>
          <div className="m-stat-cell">
            <div className="m-stat-v">{stats.monthTalkCount}</div>
            <div className="m-stat-l">本月谈心（次）</div>
          </div>
          <div className="m-stat-cell">
            <div className="m-stat-v" style={{ color: 'var(--danger-fg)' }}>{stats.pendingWarningCount}</div>
            <div className="m-stat-l">未解除预警</div>
          </div>
          <div className="m-stat-cell">
            <div className="m-stat-v" style={{ color: stats.overdueTodoCount > 0 ? 'var(--warning-fg)' : undefined }}>
              {stats.todayTodoCount}
            </div>
            <div className="m-stat-l">
              待办事项{stats.overdueTodoCount > 0 ? ` · 逾期 ${stats.overdueTodoCount}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* 预警名单卡（品牌身份条） */}
      <div className="m-card accent">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="triangle" size={16} style={{ color: 'var(--danger-fg)' }} />
            预警名单
          </span>
          <button type="button" className="m-sec-more" onClick={() => navigate('/warnings?status=待处理')}>
            全部 {stats.pendingWarningCount}
            <MIcon name="chevR" size={14} />
          </button>
        </div>
        {stats.recentWarnings.length === 0 ? (
          <div className="m-card empty" style={{ marginTop: 8 }}>
            <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
            <div className="m-t3" style={{ marginTop: 6 }}>暂无未解除预警</div>
          </div>
        ) : (
          stats.recentWarnings.map((w) => (
            <WarningRow key={w.id} w={w} onClick={() => navigate('/warnings?status=待处理')} />
          ))
        )}
      </div>

      {/* 待办事项卡（品牌身份条） */}
      <div className="m-card accent">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="checksq" size={16} />
            待办事项
          </span>
          <button type="button" className="m-sec-more" onClick={() => navigate('/todos')}>
            全部 {stats.todayTodoCount}
            <MIcon name="chevR" size={14} />
          </button>
        </div>
        {stats.todayTodos.length === 0 ? (
          <div className="m-card empty" style={{ marginTop: 8 }}>
            <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
            <div className="m-t3" style={{ marginTop: 6 }}>暂无未完成待办，保持节奏</div>
          </div>
        ) : (
          stats.todayTodos.map((t) => {
            const overdue = t.dueDate < todayStr;
            return (
              <div className="m-row" key={t.id}>
                <label className="m-check">
                  <input
                    type="checkbox"
                    className="m-cbx"
                    checked={t.status === '已完成'}
                    disabled={busyId === t.id}
                    onChange={() => completeTodo(t)}
                    aria-label={`完成待办：${t.title}`}
                  />
                  <span className="m-box">
                    <svg className="m-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                </label>
                <span className="m-row-main">
                  <span className="m-t2 m-clamp1" style={{ display: 'block' }}>{t.title}</span>
                  <span className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    <span className={`m-tag ${t.priority === '高' ? 'danger' : t.priority === '中' ? 'warning' : 'neutral'}`}>
                      {t.priority}
                    </span>
                    <span className="m-nowrap" style={{ color: overdue ? 'var(--danger-fg)' : undefined, fontWeight: overdue ? 600 : undefined }}>
                      <MIcon name="clock" size={11} /> 截止 {t.dueDate} {t.dueTime ?? ''}
                    </span>
                    {overdue && (
                      <span className="m-tag danger">
                        <MIcon name="alertTriangle" size={11} />
                        已逾期
                      </span>
                    )}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 待审批卡（品牌身份条） */}
      <div className="m-card accent">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="file" size={16} />
            待审批
          </span>
          <button type="button" className="m-sec-more" onClick={() => navigate('/approvals')}>
            共 {stats.pendingApprovalCount} 项
            <MIcon name="chevR" size={14} />
          </button>
        </div>
        {stats.pendingApprovals.length === 0 ? (
          <div className="m-card empty" style={{ marginTop: 8 }}>
            <MIcon name="check" size={22} style={{ color: 'var(--success-fg)' }} />
            <div className="m-t3" style={{ marginTop: 6 }}>没有待审批事项</div>
          </div>
        ) : (
          stats.pendingApprovals.map((a) => (
            <button type="button" className="m-row" key={a.id} onClick={() => navigate('/approvals')} style={{ width: '100%', background: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
              <span className="m-row-main">
                <span className="m-t2 m-clamp1" style={{ display: 'block' }}>
                  {a.studentName} · {a.type}
                </span>
                <span className="m-t4" style={{ display: 'block', marginTop: 3 }}>
                  {a.className} · {a.submittedAt.slice(0, 16)}
                </span>
              </span>
              <span className="m-row-side">
                <span className="m-tag warning">待审批</span>
              </span>
            </button>
          ))
        )}
      </div>

      {/* 类型分布（缩略） */}
      <div className="m-card">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="grid" size={16} />
            类型分布
          </span>
        </div>
        <div className="m-t3" style={{ marginBottom: 6 }}>未解除预警类型分布</div>
        <MiniBars data={stats.warningByType} gradient="linear-gradient(90deg,#f0a192,#d9645c)" />
        <div className="m-t3" style={{ margin: '12px 0 6px' }}>谈心谈话类型分布（累计）</div>
        <MiniBars data={stats.talkByType} gradient="linear-gradient(90deg,#a9c2ff,#5f86ff)" />
      </div>
    </>
  );
}

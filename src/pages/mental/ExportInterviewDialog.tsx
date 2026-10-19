import { DownloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Input, Modal, Progress, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useRef, useState } from 'react';

import { getClassOptions } from '@/api/classes';
import { listMentalInterviewRecords } from '@/api/mental';
import FilterSheet from '@/components/mobile/FilterSheet';
import { ATTENTION_LEVELS } from '@/constants/mental';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { InterviewExportRecord } from '@/types';
import { downloadInterviewExport } from '@/utils/interviewExport';

interface ExportInterviewDialogProps {
  open: boolean;
  onClose: () => void;
}

type Stage = 'filter' | 'exporting' | 'done';

/** 分页拉取页大小（服务端单页上限 500） */
const PAGE_SIZE = 200;

const LEVEL_OPTIONS = [
  ...ATTENTION_LEVELS.map((l) => ({ value: l, label: l })),
  { value: '全部', label: '全部等级' },
];

/**
 * 心理访谈记录批量导出（管理员 / 心理健康主负责）：
 * 筛选（关注等级默认「一般关注」/ 班级 / 访谈日期范围 / 姓名·学号）→ 查询数量 →
 * 分页拉取全部记录（带进度，可取消）→ 浏览器端生成 Excel 并自动下载。
 */
export default function ExportInterviewDialog({ open, onClose }: ExportInterviewDialogProps) {
  const isMobile = useIsMobile();
  const { message } = App.useApp();

  const [stage, setStage] = useState<Stage>('filter');
  const [level, setLevel] = useState<string>('一般关注');
  const [classId, setClassId] = useState<number | ''>('');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keyword, setKeyword] = useState('');
  const [classOptions, setClassOptions] = useState<{ id: number; name: string; gradeName: string }[]>([]);

  const [total, setTotal] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [exported, setExported] = useState(0);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  /** 导出循环的取消标志（ref 保证回调内读到最新值） */
  const cancelRef = useRef(false);

  useEffect(() => {
    if (open) {
      setStage('filter');
      setLevel('一般关注');
      setClassId('');
      setRange(null);
      setKeyword('');
      setTotal(null);
      setExported(0);
      setProgress(0);
      setFileName('');
      setError('');
      getClassOptions()
        .then(setClassOptions)
        .catch(() => undefined);
    }
  }, [open]);

  const queryParams = () => ({
    level,
    ...(classId === '' ? {} : { classId: Number(classId) }),
    ...(range?.[0] ? { dateFrom: range[0].format('YYYY-MM-DD') } : {}),
    ...(range?.[1] ? { dateTo: range[1].format('YYYY-MM-DD') } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  });

  const filterDesc = () => {
    const desc = [
      `关注等级：${level}`,
      classId === '' ? '班级：全部班级' : `班级：${classOptions.find((c) => c.id === classId)?.gradeName ?? ''}·${classOptions.find((c) => c.id === classId)?.name ?? classId}`,
    ];
    if (range?.[0] || range?.[1]) {
      desc.push(`访谈时间：${range?.[0]?.format('YYYY-MM-DD') ?? '不限'} 至 ${range?.[1]?.format('YYYY-MM-DD') ?? '不限'}`);
    }
    if (keyword.trim()) desc.push(`关键字：${keyword.trim()}`);
    return desc;
  };

  /** 第一步：查询符合条件的记录总数 */
  const handleCount = async () => {
    setCounting(true);
    setError('');
    try {
      const res = await listMentalInterviewRecords({ ...queryParams(), page: 1, pageSize: 1 });
      setTotal(res.total);
      if (res.total === 0) message.info('没有符合条件的访谈记录，请调整筛选条件');
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败');
    } finally {
      setCounting(false);
    }
  };

  /** 第二步：分页拉取全部记录 → 生成 Excel → 自动下载 */
  const handleExport = async () => {
    if (!total) return;
    cancelRef.current = false;
    setStage('exporting');
    setExported(0);
    setProgress(0);
    setError('');

    const collected: InterviewExportRecord[] = [];
    try {
      for (let page = 1; collected.length < total; page += 1) {
        if (cancelRef.current) return;
        const res = await listMentalInterviewRecords({ ...queryParams(), page, pageSize: PAGE_SIZE });
        collected.push(...res.list);
        setExported(collected.length);
        setProgress(Math.min(100, Math.round((collected.length / total) * 100)));
        if (res.list.length === 0) break; // 服务端无更多数据，防死循环
        if (collected.length >= total) break;
      }
      if (cancelRef.current) return;
      // 让「正在生成 Excel」先渲染，再执行同步的 xlsx 生成
      await new Promise((r) => window.setTimeout(r, 60));
      const name = downloadInterviewExport(collected, filterDesc());
      setFileName(name);
      setExported(collected.length);
      setProgress(100);
      setStage('done');
      message.success(`已导出 ${collected.length} 条访谈记录`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请稍后重试');
      setStage('filter');
    }
  };

  const cancelExport = () => {
    cancelRef.current = true;
    setStage('filter');
  };

  const rangeText = range?.[0] || range?.[1]
    ? `${range?.[0]?.format('YYYY-MM-DD') ?? '不限'} ~ ${range?.[1]?.format('YYYY-MM-DD') ?? '不限'}`
    : '全部时间';

  /* ---------- 筛选区（双端共用结构） ---------- */
  const filterBody = (
    <Space direction="vertical" size={isMobile ? 12 : 14} style={{ width: '100%' }}>
      {isMobile ? (
        <>
          <div className="m-field">
            <label>关注等级（学生当前档位）</label>
            <select className="m-inp" value={level} onChange={(e) => { setLevel(e.target.value); setTotal(null); }}>
              {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="m-field">
            <label>班级</label>
            <select className="m-inp" value={classId === '' ? '' : String(classId)} onChange={(e) => { setClassId(e.target.value === '' ? '' : Number(e.target.value)); setTotal(null); }}>
              <option value="">全部班级</option>
              {classOptions.map((c) => <option key={c.id} value={c.id}>{c.gradeName}·{c.name}</option>)}
            </select>
          </div>
          <div className="m-field">
            <label>访谈时间范围</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="m-inp"
                type="date"
                value={range?.[0]?.format('YYYY-MM-DD') ?? ''}
                onChange={(e) => { setRange([e.target.value ? dayjs(e.target.value) : null, range?.[1] ?? null]); setTotal(null); }}
              />
              <span className="m-t4">至</span>
              <input
                className="m-inp"
                type="date"
                value={range?.[1]?.format('YYYY-MM-DD') ?? ''}
                onChange={(e) => { setRange([range?.[0] ?? null, e.target.value ? dayjs(e.target.value) : null]); setTotal(null); }}
              />
            </div>
          </div>
          <div className="m-field">
            <label>关键字（姓名 / 学号）</label>
            <input className="m-inp" value={keyword} placeholder="选填" onChange={(e) => { setKeyword(e.target.value); setTotal(null); }} />
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>关注等级（学生当前档位）</Typography.Text>
              <Select
                style={{ width: 150 }}
                value={level}
                options={LEVEL_OPTIONS}
                onChange={(v) => { setLevel(v); setTotal(null); }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>班级</Typography.Text>
              <Select
                style={{ width: 180 }}
                value={classId === '' ? undefined : classId}
                allowClear
                placeholder="全部班级"
                options={classOptions.map((c) => ({ value: c.id, label: `${c.gradeName}·${c.name}` }))}
                onChange={(v) => { setClassId(v ?? ''); setTotal(null); }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>访谈时间范围</Typography.Text>
              <DatePicker.RangePicker
                value={range}
                onChange={(v) => { setRange(v); setTotal(null); }}
                allowEmpty={[true, true]}
              />
            </div>
            <div style={{ flex: '1 1 160px', minWidth: 160 }}>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>关键字（姓名 / 学号）</Typography.Text>
              <Input
                allowClear
                value={keyword}
                placeholder="选填"
                onChange={(e) => { setKeyword(e.target.value); setTotal(null); }}
              />
            </div>
          </div>
        </>
      )}

      <Alert
        type="info"
        showIcon
        message={total === null ? '请先查询符合条件的记录数量' : `共 ${total} 条符合条件的访谈记录（${level === '全部' ? '全部等级' : level} · ${rangeText}）`}
        description={total === 0 ? '没有可导出的记录；可放宽筛选条件后重新查询。' : '导出内容包含学生基本信息、访谈关键字段与逐题问答，生成 Excel 后自动下载。'}
      />

      {error && <Alert type="error" showIcon message={error} />}
    </Space>
  );

  /* ---------- 导出进度 ---------- */
  const exportingBody = (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert type="info" showIcon message={`正在获取访谈记录（${level === '全部' ? '全部等级' : level} · ${rangeText}）…`} />
      {isMobile ? (
        <div className="m-card" style={{ padding: '12px 14px' }}>
          <div className="m-t3">已获取 {exported} / {total} 条</div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--neutral-bg, #e8ecf5)', marginTop: 10, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--app-primary, #5f86ff)', transition: 'width 0.2s ease' }} />
          </div>
          <div className="m-t4" style={{ marginTop: 6 }}>{progress}%</div>
        </div>
      ) : (
        <div className="import-step">
          <Progress percent={progress} strokeColor="#5f86ff" />
          <Typography.Text type="secondary">已获取 {exported} / {total} 条记录，获取完成后将生成 Excel 文件</Typography.Text>
        </div>
      )}
      {progress >= 100 && (
        <Typography.Text type="secondary">正在生成 Excel 文件，请稍候…</Typography.Text>
      )}
    </Space>
  );

  /* ---------- 完成态 ---------- */
  const doneBody = (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Alert
        type="success"
        showIcon
        message={`导出完成：共 ${exported} 条访谈记录`}
        description={<>文件「{fileName}」已开始下载；如浏览器未弹出下载，请检查弹窗拦截设置后重新导出。</>}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        筛选条件：{filterDesc().join('；')}
      </Typography.Text>
    </Space>
  );

  const footer = (() => {
    if (isMobile) {
      if (stage === 'exporting') {
        return (
          <button type="button" className="m-btn m-btn-ghost" onClick={cancelExport}>取消导出</button>
        );
      }
      if (stage === 'done') {
        return (
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={() => setStage('filter')}>再次导出</button>
            <button type="button" className="m-btn m-btn-primary" onClick={onClose}>完成</button>
          </>
        );
      }
      return (
        <>
          <button type="button" className="m-btn m-btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="m-btn m-btn-ghost" disabled={counting} onClick={handleCount}>
            {counting ? '查询中…' : '查询数量'}
          </button>
          <button type="button" className="m-btn m-btn-primary" disabled={counting || !total || total === 0} onClick={handleExport}>
            开始导出
          </button>
        </>
      );
    }

    if (stage === 'exporting') {
      return <Button onClick={cancelExport}>取消导出</Button>;
    }
    if (stage === 'done') {
      return [
        <Button key="again" onClick={() => setStage('filter')}>再次导出</Button>,
        <Button key="close" type="primary" onClick={onClose}>完成</Button>,
      ];
    }
    return [
      <Button key="cancel" onClick={onClose}>取消</Button>,
      <Button key="count" disabled={counting} onClick={handleCount}>
        {counting ? '查询中…' : '查询数量'}
      </Button>,
      <Button key="export" type="primary" icon={<DownloadOutlined />} disabled={counting || !total || total === 0} onClick={handleExport}>
        开始导出{total ? `（${total} 条）` : ''}
      </Button>,
    ];
  })();

  const content = stage === 'exporting' ? exportingBody : stage === 'done' ? doneBody : filterBody;

  if (isMobile) {
    return (
      <FilterSheet
        open={open}
        title="导出访谈记录"
        fullscreen
        dismissible={false}
        onClose={stage === 'exporting' ? () => undefined : onClose}
        footer={footer}
      >
        {content}
      </FilterSheet>
    );
  }

  return (
    <Modal
      title="导出心理访谈记录"
      width="min(720px, calc(100vw - 32px))"
      open={open}
      onCancel={stage === 'exporting' ? () => undefined : onClose}
      maskClosable={false}
      footer={footer}
    >
      {content}
    </Modal>
  );
}

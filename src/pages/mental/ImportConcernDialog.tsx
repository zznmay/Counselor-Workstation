import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Empty, Modal, Space, Table, Tag, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useRef, useState } from 'react';

import { importMentalConcerns } from '@/api/mental';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { ATTENTION_TAG_COLORS } from '@/constants/mental';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { MentalImportResult, MentalImportRow, MentalImportSkip, MentalImportSuccess } from '@/types';
import {
  downloadMentalImportTemplate,
  exportMentalImportSkips,
  MENTAL_IMPORT_DEFAULT_LEVEL,
  parseMentalImportExcel,
} from '@/utils/mentalImport';

interface ImportConcernDialogProps {
  open: boolean;
  onClose: () => void;
  /** 实际写入成功后回调（刷新汇总卡、列表与访谈待办） */
  onImported: () => void;
}

type Stage = 'pick' | 'preview' | 'done';

const ACTION_LABEL: Record<MentalImportSuccess['action'], string> = {
  created: '新增',
  updated: '更新',
  unchanged: '无变化',
};

const ACTION_COLOR: Record<MentalImportSuccess['action'], string> = {
  created: 'green',
  updated: 'blue',
  unchanged: 'default',
};

/**
 * 心理关注学生批量导入：
 * 上传 → 服务端 dryRun 逐条核对名册并预览 → 确认写入 → 成功/跳过分组汇总。
 * 桌面用 Modal、移动端用全屏 FilterSheet，两步内容与判定口径完全一致。
 */
export default function ImportConcernDialog({ open, onClose, onImported }: ImportConcernDialogProps) {
  const isMobile = useIsMobile();
  const { message } = App.useApp();

  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<MentalImportRow[]>([]);
  const [preview, setPreview] = useState<MentalImportResult | null>(null);
  const [result, setResult] = useState<MentalImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setStage('pick');
    setFileName('');
    setRows([]);
    setPreview(null);
    setResult(null);
    setBusy(false);
    setImporting(false);
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = await parseMentalImportExcel(file);
      const res = await importMentalConcerns(parsed, true);
      setRows(parsed);
      setFileName(file.name);
      setPreview(res);
      setStage('preview');
      if (res.successCount === 0) {
        message.warning('没有可导入的学生，请按跳过原因修正后重新上传');
      } else if (res.skippedCount > 0) {
        message.warning(`可导入 ${res.successCount} 名，${res.skippedCount} 名将跳过，请核对后确认`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '文件解析失败，请使用标准模板填写');
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview || preview.successCount === 0) return;
    setImporting(true);
    try {
      const res = await importMentalConcerns(rows, false);
      setResult(res);
      setStage('done');
      if (res.successCount > 0) onImported();
      message.success(`成功导入 ${res.successCount} 名关注学生`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败，请稍后重试');
    } finally {
      setImporting(false);
    }
  };

  const summary = stage === 'done' ? result : preview;
  const skipped = summary?.skipped ?? [];
  const successes = summary?.successes ?? [];

  /** 写入过程中禁止关闭，避免用户看不到最终汇总 */
  const safeClose = () => {
    if (!importing) onClose();
  };

  const successColumns: ColumnsType<MentalImportSuccess> = [
    { title: '行号', dataIndex: 'row', width: 62 },
    { title: '学号', dataIndex: 'studentNo', width: 118 },
    { title: '姓名', dataIndex: 'name', width: 82 },
    { title: '班级', dataIndex: 'className', width: 110 },
    {
      title: '关注等级',
      dataIndex: 'level',
      width: 96,
      render: (level: MentalImportSuccess['level']) => (
        <Tag color={ATTENTION_TAG_COLORS[level]} style={{ marginInlineEnd: 0 }}>{level}</Tag>
      ),
    },
    {
      title: '处理结果',
      dataIndex: 'action',
      width: 140,
      render: (action: MentalImportSuccess['action'], record) => (
        <Tag color={ACTION_COLOR[action]} style={{ marginInlineEnd: 0 }}>
          {ACTION_LABEL[action]}
          {action === 'updated' && record.previousLevel ? `（原${record.previousLevel}）` : ''}
        </Tag>
      ),
    },
  ];

  const skipColumns: ColumnsType<MentalImportSkip> = [
    { title: '行号', dataIndex: 'row', width: 62 },
    { title: '学号', dataIndex: 'studentNo', width: 118 },
    { title: '姓名', dataIndex: 'name', width: 82 },
    { title: '跳过原因', dataIndex: 'reason' },
  ];

  const summaryAlert = () => {
    if (!summary) return null;
    const tone = summary.successCount === 0 ? 'error' : summary.skippedCount > 0 ? 'warning' : 'success';
    const levelText = [
      summary.createdCount > 0 ? `新增 ${summary.createdCount}` : '',
      summary.updatedCount > 0 ? `更新 ${summary.updatedCount}` : '',
      summary.unchangedCount > 0 ? `无变化 ${summary.unchangedCount}` : '',
    ].filter(Boolean).join(' · ');
    const changeText = [
      summary.createdCount > 0 ? `新增 ${summary.createdCount} 名` : '',
      summary.updatedCount > 0 ? `更新 ${summary.updatedCount} 名` : '',
    ].filter(Boolean).join('、');
    const unchangedText = summary.unchangedCount > 0
      ? `${summary.unchangedCount} 名已存在且无变化`
      : '';

    if (stage === 'done') {
      return (
        <Alert
          showIcon
          type={tone}
          message={`已导入 ${summary.successCount} 名学生${levelText ? `（${levelText}）` : ''}，跳过 ${summary.skippedCount} 名`}
          description={
            summary.skippedCount > 0
              ? '跳过学生未写入任何数据。名册中不存在的学生，请确认是否在读；补入学生名册后可重新导入。'
              : '关注标记已写入，名单与等级汇总已刷新。'
          }
        />
      );
    }

    return (
      <Alert
        showIcon
        type={tone}
        message={`文件「${fileName}」共 ${summary.total} 行：可导入 ${summary.successCount} 名，跳过 ${summary.skippedCount} 名`}
        description={
          summary.successCount === 0
            ? '没有可导入的学生，请按跳过原因修正后重新上传。'
            : `确认后点击「确认导入 ${summary.successCount} 名」写入系统；跳过学生不会产生任何数据变更。${changeText ? `本次将${changeText}。` : ''}${unchangedText ? `${unchangedText}。` : ''}`
        }
      />
    );
  };

  const pickStep = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="import-step">
        <div className="import-step-title">① 下载并填写模板</div>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={downloadMentalImportTemplate}>
            下载 Excel 模板
          </Button>
          <Typography.Text type="secondary">
            列：学号、姓名、关注等级、关注备注（含填写说明与示例行）
          </Typography.Text>
        </Space>
        <ul className="import-rules">
          <li>学号与姓名至少填写一项；同时填写时必须对应名册中的同一名学生。</li>
          <li>关注等级留空默认为「{MENTAL_IMPORT_DEFAULT_LEVEL}」，已有记录按本表等级更新、备注留空则保留原备注。</li>
          <li>系统逐条核对名册：不在名册中的学生暂不导入，并提示「学生未在学生名册中，确认学生是否在读」。</li>
        </ul>
      </div>

      <div className="import-step">
        <div className="import-step-title">② 上传填写好的 Excel</div>
        {isMobile ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              className="m-btn m-btn-ghost m-btn-block"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <MIcon name="upload" size={16} />
              {busy ? '正在核对名册…' : '选择 Excel 文件'}
            </button>
            <div className="m-t4" style={{ marginTop: 8 }}>
              支持 .xlsx / .xls；先核对名册并预览，确认后才写入系统
            </div>
          </>
        ) : (
          <>
            <Upload.Dragger
              accept=".xlsx,.xls"
              maxCount={1}
              showUploadList={false}
              disabled={busy}
              beforeUpload={(file) => {
                void handleFile(file as File);
                return false; // 阻止自动上传，改由前端解析 + 服务端预校验
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{busy ? '正在核对学生名册…' : '点击或拖拽文件到此处上传'}</p>
              <p className="ant-upload-hint">支持 .xlsx / .xls；先核对名册并预览，确认后才写入系统</p>
            </Upload.Dragger>
            {busy && (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                正在逐条校验学生是否存在于学生名册中…
              </Typography.Text>
            )}
          </>
        )}
      </div>
    </Space>
  );

  const resultStep = summary && (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {summaryAlert()}

      <div className="import-step">
        <div className="import-step-title">
          {stage === 'done' ? '成功导入' : '将导入'}（{summary.successCount} 名）
        </div>
        {successes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可导入学生" />
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
            {successes.map((s) => (
              <div className="m-card" key={`${s.studentId}-${s.row}`} style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="m-t2" style={{ fontWeight: 600 }}>{s.name}</span>
                  <span className={`m-tag ${s.action === 'created' ? 'success' : s.action === 'updated' ? 'info' : 'neutral'}`}>
                    {ACTION_LABEL[s.action]}
                  </span>
                  <span className="m-t4" style={{ marginLeft: 'auto' }}>第 {s.row} 行</span>
                </div>
                <div className="m-t4" style={{ marginTop: 4 }}>
                  {s.studentNo} · {s.className} · {s.level}
                  {s.action === 'updated' && s.previousLevel ? `（原${s.previousLevel}）` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table
            size="small"
            rowKey={(r) => `${r.studentId}-${r.row}`}
            columns={successColumns}
            dataSource={successes}
            pagination={false}
            scroll={{ y: 220 }}
          />
        )}
      </div>

      <div className="import-step">
        <div className="import-step-title">
          {stage === 'done' ? '已跳过' : '将跳过'}（{summary.skippedCount} 名）
        </div>
        {skipped.length === 0 ? (
          <Typography.Text type="secondary">全部学生均通过名册校验。</Typography.Text>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
            {skipped.map((s) => (
              <div className="m-card" key={`${s.row}-${s.studentNo}-${s.name}`} style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="m-t2" style={{ fontWeight: 600 }}>{s.name}</span>
                  <span className="m-t4">{s.studentNo}</span>
                  <span className="m-t4" style={{ marginLeft: 'auto' }}>第 {s.row} 行</span>
                </div>
                <div className="m-t4" style={{ marginTop: 4, color: 'var(--warning-fg)', lineHeight: 1.6 }}>
                  {s.reason}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table
            size="small"
            rowKey={(r) => `${r.row}-${r.studentNo}-${r.name}`}
            columns={skipColumns}
            dataSource={skipped}
            pagination={false}
            scroll={{ y: 220 }}
          />
        )}
        {skipped.length > 0 && (
          <Button
            size="small"
            icon={<DownloadOutlined />}
            style={{ marginTop: 10 }}
            onClick={() => exportMentalImportSkips(skipped)}
          >
            导出跳过明细
          </Button>
        )}
      </div>
    </Space>
  );

  const footer = (() => {
    if (isMobile) {
      if (stage === 'done') {
        return (
          <>
            <button type="button" className="m-btn m-btn-ghost" onClick={reset}>再次导入</button>
            <button type="button" className="m-btn m-btn-primary" onClick={safeClose}>完成</button>
          </>
        );
      }
      if (stage === 'preview') {
        return (
          <>
            <button type="button" className="m-btn m-btn-ghost" disabled={importing} onClick={reset}>
              重新选择
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              disabled={importing || !preview || preview.successCount === 0}
              onClick={confirmImport}
            >
              {importing ? '导入中…' : `确认导入 ${preview?.successCount ?? 0} 名`}
            </button>
          </>
        );
      }
      return (
        <button type="button" className="m-btn m-btn-ghost" onClick={safeClose}>
          取消
        </button>
      );
    }

    if (stage === 'done') {
      return [
        <Button key="again" onClick={reset}>再次导入</Button>,
        <Button key="close" type="primary" onClick={safeClose}>完成</Button>,
      ];
    }
    if (stage === 'preview') {
      return [
        <Button key="back" onClick={reset} disabled={importing}>重新选择文件</Button>,
        <Button
          key="ok"
          type="primary"
          loading={importing}
          disabled={!preview || preview.successCount === 0}
          onClick={confirmImport}
        >
          {preview ? `确认导入 ${preview.successCount} 名` : '确认导入'}
        </Button>,
      ];
    }
    return <Button key="cancel" onClick={safeClose}>取消</Button>;
  })();

  const content = stage === 'pick' ? pickStep : resultStep;

  if (isMobile) {
    return (
      <FilterSheet
        open={open}
        title="批量导入关注学生"
        fullscreen
        dismissible={false}
        onClose={safeClose}
        footer={footer}
      >
        {content}
      </FilterSheet>
    );
  }

  return (
    <Modal
      title="批量导入关注学生"
      width="min(820px, calc(100vw - 32px))"
      open={open}
      onCancel={safeClose}
      maskClosable={false}
      footer={footer}
    >
      {content}
    </Modal>
  );
}

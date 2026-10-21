import {
  CloudUploadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  ExportOutlined,
  FileZipOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';

import {
  createDataBundle,
  deleteDataBundle,
  downloadBundleBytes,
  getDataBundles,
  getDataOplog,
  getDataOverview,
  getAutoBackup,
  previewRestore,
  quickBackup,
  restoreData,
  runAutoBackup,
  saveAutoBackup,
  updateDataBundle,
  uploadDataBundle,
} from '@/api/data';
import PageHeader from '@/components/PageHeader';
import {
  AUTO_BACKUP_INTERVALS,
  AUTO_BACKUP_KEEP_MAX,
  AUTO_BACKUP_KEEP_MIN,
  BUNDLE_CREATE_KINDS,
  BUNDLE_KIND_COLOR,
  BUNDLE_KINDS,
  BUNDLE_UPLOAD_MAX_BYTES,
  DATA_CARD_COLORS,
  DATA_TABLE_LABELS,
  RESTORE_CONFIRM_PHRASE,
  toOptions,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import type {
  AutoBackupConfig,
  BundleKind,
  BundleQuery,
  DataBundle,
  DataOplogItem,
  DataOverview,
  RestorePreview,
} from '@/types';
import AdminDataMobile from './dataMobile';

/** 字节体积可读化 */
function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 日期时间展示：空值统一显示中文破折号，避免露出 undefined / Invalid Date */
function formatTime(value?: string | null, pattern = 'MM-DD HH:mm'): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format(pattern) : '—';
}

const totalOf = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((a, b) => a + b, 0);

interface BundleFormValues {
  label: string;
  kind: BundleKind;
  note?: string;
}

type TabKey = 'overview' | 'backup' | 'migrate' | 'oplog';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '数据总览' },
  { key: 'backup', label: '备份与恢复' },
  { key: 'migrate', label: '迁移助手' },
  { key: 'oplog', label: '操作日志' },
];

interface RestoreSource {
  bundleId: number;
  label: string;
}

interface OverviewCard {
  key: string;
  name: string;
  count: number;
  meta: string;
  color: string;
}

/**
 * 系统管理 · 数据管理（桌面端）：数据总览 / 备份与恢复 / 迁移助手 / 操作日志。
 * 总览采用卡片网格（中文表名 + 条数 + 体积 + 更新时间），迁移包统一落盘为 ZIP，
 * 一键备份由服务端按日期时间自动命名；恢复沿用「预检 → 确认短语 → 恢复前快照」三段式。
 */
function AdminDataDesktop() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<TabKey>('overview');
  const [overview, setOverview] = useState<DataOverview | null>(null);
  const [oplog, setOplog] = useState<DataOplogItem[]>([]);
  const [autoCfg, setAutoCfg] = useState<AutoBackupConfig | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [quickBaking, setQuickBaking] = useState(false);
  const [exportingMigration, setExportingMigration] = useState(false);
  const [migrationList, setMigrationList] = useState<DataBundle[]>([]);

  const [keywordInput, setKeywordInput] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const { query, patchQuery, data, loading, refresh } = useList<DataBundle, BundleQuery>(
    getDataBundles,
    { page: 1, pageSize: 10, sortBy: 'createdAt', sortOrder: 'desc' } as BundleQuery,
  );

  /* 新增 / 编辑 */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DataBundle | null>(null);
  const [form] = Form.useForm<BundleFormValues>();
  const [submitting, setSubmitting] = useState(false);

  /* 恢复 */
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreSource, setRestoreSource] = useState<RestoreSource | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  const loadMeta = async () => {
    try {
      const [ov, log, cfg] = await Promise.all([getDataOverview(), getDataOplog(20), getAutoBackup()]);
      setOverview(ov);
      setOplog(log);
      setAutoCfg(cfg);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '数据总览加载失败');
    }
  };

  const loadMigrations = async () => {
    try {
      const res = await getDataBundles({
        page: 1,
        pageSize: 6,
        kind: '迁移包',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      setMigrationList(res.list);
    } catch {
      /* 迁移包列表失败不阻断总览 */
    }
  };

  useEffect(() => {
    void loadMeta();
    void loadMigrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const auto = autoCfg ?? overview?.autoBackup ?? null;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: '手动备份' });
    setFormOpen(true);
  };

  const openEdit = (row: DataBundle) => {
    setEditing(row);
    form.setFieldsValue({ label: row.label, note: row.note ?? undefined, kind: row.kind });
    setFormOpen(true);
  };

  const submitForm = async () => {
    let values: BundleFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateDataBundle(editing.id, { label: values.label, note: values.note });
        message.success('数据包信息已更新');
      } else {
        await createDataBundle({ label: values.label, kind: values.kind, note: values.note });
        message.success(values.kind === '迁移包' ? '迁移包已生成（ZIP 压缩）' : '备份已创建');
      }
      setFormOpen(false);
      refresh();
      void loadMeta();
      void loadMigrations();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row: DataBundle) => {
    try {
      await deleteDataBundle(row.id);
      message.success(`数据包「${row.label}」已删除`);
      refresh();
      void loadMeta();
      void loadMigrations();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  /** 一键备份：名称由服务端自动生成，点击后直接执行并给出结果提示 */
  const handleQuickBackup = async () => {
    setQuickBaking(true);
    try {
      const row = await quickBackup();
      message.success(`备份完成：${row.label}`);
      refresh();
      void loadMeta();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '一键备份失败');
    } finally {
      setQuickBaking(false);
    }
  };

  /** 一键导出迁移包：服务端落盘为 ZIP，生成后立即触发下载 */
  const handleExportMigration = async () => {
    setExportingMigration(true);
    try {
      const row = await createDataBundle({
        kind: '迁移包',
        label: `迁移包-${dayjs().format('YYYYMMDD-HHmmss')}`,
        note: '迁移助手导出（ZIP 压缩）',
      });
      message.success('迁移包已生成（ZIP）');
      void loadMeta();
      void loadMigrations();
      try {
        await downloadBundleBytes(row.id, row.fileName);
      } catch {
        message.warning('自动下载失败，请在「最近迁移包」中手动下载');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '迁移包导出失败');
    } finally {
      setExportingMigration(false);
    }
  };

  const openRestore = (row: DataBundle) => {
    setRestoreSource({ bundleId: row.id, label: row.label });
    setPreview(null);
    setConfirmText('');
    setRestoreOpen(true);
  };

  /** 预检：不落盘，仅校验与对比条数 */
  const handlePreview = async () => {
    if (!restoreSource) {
      message.warning('请选择要恢复的数据包');
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewRestore({ bundleId: restoreSource.bundleId });
      setPreview(res);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '预检失败');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreSource) return;
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      message.error(`请输入确认短语「${RESTORE_CONFIRM_PHRASE}」`);
      return;
    }
    setRestoring(true);
    try {
      const res = await restoreData({ bundleId: restoreSource.bundleId, confirm: confirmText });
      message.success(`恢复完成，已自动生成恢复前快照 #${res.snapshotId}`);
      setRestoreOpen(false);
      setPreview(null);
      setConfirmText('');
      setRestoreSource(null);
      refresh();
      void loadMeta();
      void loadMigrations();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '恢复失败');
    } finally {
      setRestoring(false);
    }
  };

  const handleDownload = async (row: DataBundle) => {
    try {
      await downloadBundleBytes(row.id, row.fileName);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '下载失败');
    }
  };

  /** 选择上传文件：先经服务端校验并登记为数据包，再作为恢复来源（列表可追溯） */
  const pickUploadFile = async (file: File): Promise<boolean> => {
    if (file.size > BUNDLE_UPLOAD_MAX_BYTES) {
      message.error(`文件超过 ${Math.floor(BUNDLE_UPLOAD_MAX_BYTES / 1024 / 1024)}MB 上限`);
      return false;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? '').split(',').pop() ?? '');
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
    try {
      const row = await uploadDataBundle({
        fileName: file.name,
        contentBase64: base64,
        label: file.name.replace(/\.(json(\.gz)?|zip)$/i, ''),
      });
      setRestoreSource({ bundleId: row.id, label: row.label });
      setPreview(null);
      setConfirmText('');
      refresh();
      void loadMeta();
      message.success(`已上传并校验通过（数据包 #${row.id}），请点击「恢复预检」`);
      return true;
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败');
      return false;
    }
  };

  const saveAuto = async () => {
    if (!autoCfg) return;
    setAutoSaving(true);
    try {
      const cfg = await saveAutoBackup({
        enabled: autoCfg.enabled,
        intervalHours: autoCfg.intervalHours,
        keep: autoCfg.keep,
      });
      setAutoCfg(cfg);
      message.success('自动备份策略已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setAutoSaving(false);
    }
  };

  const columns: ColumnsType<DataBundle> = [
    {
      title: '数据包',
      dataIndex: 'label',
      render: (_, row) => (
        <div>
          <Space size={6}>
            <span style={{ fontWeight: 600 }}>{row.label}</span>
            <Tag color={BUNDLE_KIND_COLOR[row.kind]}>{row.kind}</Tag>
          </Space>
          <div style={{ fontSize: 12, color: 'rgba(47,62,102,0.45)' }}>{row.note || '—'}</div>
        </div>
      ),
    },
    {
      title: '体积',
      dataIndex: 'sizeBytes',
      width: 100,
      sorter: true,
      sortOrder: query.sortBy === 'sizeBytes' ? (query.sortOrder === 'asc' ? 'ascend' : 'descend') : null,
      render: (n: number) => formatBytes(n),
    },
    {
      title: '记录数',
      dataIndex: 'counts',
      width: 100,
      render: (counts: Record<string, number>) => totalOf(counts),
    },
    { title: '创建人', dataIndex: 'createdBy', width: 110, render: (v?: string | null) => v || '系统' },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      sorter: true,
      sortOrder: query.sortBy === 'createdAt' ? (query.sortOrder === 'asc' ? 'ascend' : 'descend') : null,
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownload(row)}>
            下载
          </Button>
          <Button type="link" size="small" onClick={() => openRestore(row)}>
            恢复
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title={`删除数据包「${row.label}」？`}
            description="将同时删除落盘文件，且不可恢复"
            onConfirm={() => void handleDelete(row)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const migrationColumns: ColumnsType<DataBundle> = [
    {
      title: '迁移包',
      dataIndex: 'label',
      render: (_, row) => (
        <Space size={6}>
          <span style={{ fontWeight: 600 }}>{row.label}</span>
          <Tag color="blue">ZIP</Tag>
        </Space>
      ),
    },
    { title: '体积', dataIndex: 'sizeBytes', width: 110, render: (n: number) => formatBytes(n) },
    { title: '记录数', dataIndex: 'counts', width: 100, render: (v: Record<string, number>) => totalOf(v) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => void handleDownload(row)}>
            下载
          </Button>
          <Button type="link" size="small" onClick={() => openRestore(row)}>
            导入
          </Button>
        </Space>
      ),
    },
  ];

  const cards = useMemo<OverviewCard[]>(() => {
    if (!overview) return [];
    const stats = overview.tableStats?.length
      ? overview.tableStats
      : Object.entries(overview.counts).map(([table, count]) => ({
          table,
          name: DATA_TABLE_LABELS[table] ?? '其他数据',
          count,
          bytes: 0,
          updatedAt: null,
        }));
    const list: OverviewCard[] = stats.map((item, index) => ({
      key: item.table,
      name: item.name || DATA_TABLE_LABELS[item.table] || '其他数据',
      count: item.count,
      meta: `${formatBytes(item.bytes)} · 更新于 ${formatTime(item.updatedAt)}`,
      color: DATA_CARD_COLORS[index % DATA_CARD_COLORS.length],
    }));
    list.push({
      key: '__settings',
      name: '系统设置',
      count: overview.settings?.count ?? 0,
      meta: `系统配置 · 更新于 ${formatTime(overview.settings?.updatedAt)}`,
      color: DATA_CARD_COLORS[list.length % DATA_CARD_COLORS.length],
    });
    list.push({
      key: '__uploads',
      name: '附件文件',
      count: overview.uploads.files,
      meta: `${formatBytes(overview.uploads.bytes)} · 更新于 ${formatTime(overview.uploads.updatedAt)}`,
      color: DATA_CARD_COLORS[list.length % DATA_CARD_COLORS.length],
    });
    return list;
  }, [overview]);

  const autoCount = overview?.bundles.byKind.find((item) => item.kind === '自动备份')?.n ?? 0;
  const keep = auto?.keep ?? 10;
  const nextRunText = auto?.lastRunAt && dayjs(auto.lastRunAt).isValid()
    ? dayjs(auto.lastRunAt).add(auto.intervalHours, 'hour').format('MM-DD HH:mm')
    : null;
  const lastBackupText = overview?.latestBundle
    ? `上次备份：${formatTime(overview.latestBundle.createdAt)}（共 ${overview.bundles.total} 份服务端快照，自动保留最近 ${keep} 份）`
    : `暂无备份记录（自动保留最近 ${keep} 份）`;
  const autoStatusText = auto
    ? auto.enabled
      ? `自动备份已开启（每 ${auto.intervalHours} 小时，已存 ${autoCount} 份，${
          nextRunText ? `下次约 ${nextRunText}` : '等待首次执行'
        }）`
      : '自动备份未开启'
    : '自动备份策略加载中…';

  return (
    <div className="page data-mgmt-page">
      <PageHeader
        title="数据管理"
        subtitle="备份 / 恢复 / 迁移全库数据；迁移包使用 ZIP 压缩，恢复前自动生成快照，可整体回滚"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void loadMeta();
              void loadMigrations();
              refresh();
            }}
          >
            刷新
          </Button>
        }
      />

      <div className="data-mgmt-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`data-mgmt-tab${tab === item.key ? ' on' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="data-backup-banner">
            <DownloadOutlined className="data-backup-banner-icon" />
            <span>{lastBackupText}</span>
            <span className="data-backup-banner-sep">；</span>
            <span className={auto?.enabled ? 'data-backup-banner-ok' : 'data-backup-banner-muted'}>
              {autoStatusText}
            </span>
          </div>

          {overview ? (
            <div className="data-stat-grid">
              {cards.map((card) => (
                <div className="data-stat-card" key={card.key}>
                  <div className="data-stat-head">
                    <span className="data-stat-dot" style={{ background: card.color }} />
                    {card.name}
                  </div>
                  <div className="data-stat-value">{card.count}</div>
                  <div className="data-stat-meta">{card.meta}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="data-stat-loading">数据总览加载中…</div>
          )}

          <div className="data-page-actions">
            <Button
              type="primary"
              size="large"
              className="data-quick-backup"
              icon={<DownloadOutlined />}
              loading={quickBaking}
              onClick={() => void handleQuickBackup()}
            >
              一键备份
            </Button>
            <Button size="large" onClick={() => setTab('backup')}>
              备份与恢复 →
            </Button>
            <span className="data-action-status">迁移包使用 ZIP 压缩 · 解压后可完整导入</span>
          </div>
        </>
      )}

      {tab === 'backup' && (
        <>
          <Card
            title="自动备份策略"
            extra={
              <Space>
                <Button
                  icon={<DatabaseOutlined />}
                  onClick={async () => {
                    try {
                      const res = await runAutoBackup();
                      message.success(res.skipped ? '内容未变化，已跳过写包' : `已生成备份 #${res.bundleId}`);
                      refresh();
                      void loadMeta();
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : '执行失败');
                    }
                  }}
                >
                  立即执行
                </Button>
                <Button type="primary" loading={autoSaving} onClick={() => void saveAuto()}>
                  保存策略
                </Button>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            {autoCfg ? (
              <Space size={24} wrap>
                <Space>
                  <Typography.Text>启用</Typography.Text>
                  <Switch
                    checked={autoCfg.enabled}
                    onChange={(enabled) => setAutoCfg({ ...autoCfg, enabled })}
                  />
                </Space>
                <Space>
                  <Typography.Text>间隔</Typography.Text>
                  <Select
                    style={{ width: 110 }}
                    value={autoCfg.intervalHours}
                    onChange={(intervalHours) => setAutoCfg({ ...autoCfg, intervalHours })}
                    options={AUTO_BACKUP_INTERVALS.map((h) => ({ value: h, label: `${h} 小时` }))}
                  />
                </Space>
                <Space>
                  <Typography.Text>保留份数</Typography.Text>
                  <InputNumber
                    min={AUTO_BACKUP_KEEP_MIN}
                    max={AUTO_BACKUP_KEEP_MAX}
                    value={autoCfg.keep}
                    onChange={(keepValue) => setAutoCfg({ ...autoCfg, keep: Number(keepValue) })}
                  />
                </Space>
                <Typography.Text type="secondary">
                  上次执行：{autoCfg.lastRunAt || '从未执行'}
                  {autoCfg.lastSignature ? ' · 内容签名去重已开启' : ''}
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">加载中…</Typography.Text>
            )}
          </Card>

          <div className="toolbar">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'rgba(47,62,102,0.35)' }} />}
              placeholder="搜索标签 / 备注 / 文件名"
              style={{ width: 240 }}
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
            />
            <Select
              placeholder="数据包类型"
              allowClear
              style={{ minWidth: 140 }}
              options={toOptions(BUNDLE_KINDS)}
              value={query.kind}
              onChange={(kind) => patchQuery({ kind })}
            />
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => {
                setRange(v as [Dayjs, Dayjs] | null);
                patchQuery({
                  startDate: v?.[0] ? dayjs(v[0]).format('YYYY-MM-DD') : undefined,
                  endDate: v?.[1] ? dayjs(v[1]).format('YYYY-MM-DD') : undefined,
                });
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeywordInput('');
                setRange(null);
                patchQuery({ keyword: undefined, kind: undefined, startDate: undefined, endDate: undefined });
              }}
            >
              重置
            </Button>
            <div className="toolbar-spacer" />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建备份
            </Button>
            <Button
              icon={<CloudUploadOutlined />}
              onClick={() => document.getElementById('data-bundle-upload')?.click()}
            >
              上传数据包
            </Button>
            <input
              id="data-bundle-upload"
              type="file"
              accept=".zip,.json,.json.gz,application/zip,application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file && (await pickUploadFile(file))) setRestoreOpen(true);
              }}
            />
          </div>

          <Table
            rowKey="id"
            columns={columns}
            dataSource={data.list}
            loading={loading}
            scroll={{ x: 980 }}
            onChange={(_p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              const field = s?.field;
              if (field === 'createdAt' || field === 'sizeBytes') {
                patchQuery({ sortBy: field, sortOrder: s?.order === 'ascend' ? 'asc' : 'desc' }, false);
              }
            }}
            pagination={{
              current: data.page,
              pageSize: data.pageSize,
              total: data.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 个数据包`,
              onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
            }}
          />
        </>
      )}

      {tab === 'migrate' && (
        <>
          <div className="data-migrate-grid">
            <Card className="data-migrate-card">
              <div className="data-migrate-icon">
                <FileZipOutlined />
              </div>
              <div className="data-migrate-title">导出迁移包（ZIP）</div>
              <div className="data-migrate-desc">
                将全库业务数据打包为 ZIP 压缩包，内含 bundle.json 与中文说明文件。压缩后体积更小，
                可避免后续数据量增大导致迁移失败或超出上传限制。
              </div>
              <Button
                type="primary"
                icon={<ExportOutlined />}
                loading={exportingMigration}
                onClick={() => void handleExportMigration()}
              >
                一键导出迁移包
              </Button>
            </Card>

            <Card className="data-migrate-card">
              <div className="data-migrate-icon data-migrate-icon-upload">
                <CloudUploadOutlined />
              </div>
              <div className="data-migrate-title">导入迁移包</div>
              <div className="data-migrate-desc">
                选择由本系统导出的 ZIP 迁移包（也兼容历史 JSON / JSON.GZ 数据包），上传后先做完整性预检，
                确认后再整体恢复；恢复前会自动生成快照。
              </div>
              <Button
                icon={<CloudUploadOutlined />}
                onClick={() => document.getElementById('data-migration-upload')?.click()}
              >
                上传并导入
              </Button>
              <input
                id="data-migration-upload"
                type="file"
                accept=".zip,.json,.json.gz,application/zip,application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file && (await pickUploadFile(file))) setRestoreOpen(true);
                }}
              />
            </Card>
          </div>

          <Card title="最近迁移包" className="data-migrate-list">
            <Table
              rowKey="id"
              size="small"
              columns={migrationColumns}
              dataSource={migrationList}
              pagination={false}
              locale={{ emptyText: '暂无迁移包，点击上方「一键导出迁移包」生成' }}
            />
          </Card>
        </>
      )}

      {tab === 'oplog' && (
        <Card title="数据管理操作日志">
          <Table
            rowKey="id"
            size="small"
            dataSource={oplog}
            pagination={false}
            locale={{ emptyText: '暂无数据管理操作记录' }}
            columns={[
              { title: '时间', dataIndex: 'ts', width: 170 },
              { title: '操作人', dataIndex: 'actor', width: 120, render: (v?: string | null) => v || '系统' },
              { title: '动作', dataIndex: 'action', width: 140 },
              { title: '摘要', dataIndex: 'summary', ellipsis: true },
            ]}
          />
        </Card>
      )}

      {/* 新增 / 编辑数据包 */}
      <Modal
        title={editing ? `编辑数据包 · ${editing.label}` : '创建备份'}
        open={formOpen}
        confirmLoading={submitting}
        onOk={submitForm}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="label"
            label="数据包标签"
            rules={[
              { required: true, message: '请填写数据包标签' },
              { max: 40, message: '不可超过 40 个字' },
            ]}
          >
            <Input placeholder="如：学期初全量备份 / 迁移到新服务器" />
          </Form.Item>
          <Form.Item name="kind" label="数据包类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Segmented
              options={BUNDLE_CREATE_KINDS.map((k) => ({ value: k, label: k }))}
              disabled={!!editing}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={100} placeholder="用途说明（选填）" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="选择「迁移包」时，系统会生成 ZIP 压缩包（内含 bundle.json），可在目标环境解压或直接上传导入。"
          />
        </Form>
      </Modal>

      {/* 恢复：预检 → 确认短语 → 执行 */}
      <Modal
        title="恢复数据"
        open={restoreOpen}
        onCancel={() => setRestoreOpen(false)}
        width={720}
        footer={
          <>
            <Button onClick={() => setRestoreOpen(false)}>取消</Button>
            <Button loading={previewing} onClick={() => void handlePreview()}>
              恢复预检
            </Button>
            <Button
              type="primary"
              danger
              loading={restoring}
              disabled={!preview?.ok}
              onClick={() => void handleRestore()}
            >
              确认恢复
            </Button>
          </>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="恢复会用数据包内容整体替换当前业务数据。系统会先自动生成「恢复前快照」，如需回滚可再次恢复该快照。"
          />
          <Typography.Text>
            恢复来源：{restoreSource ? `「${restoreSource.label}」（数据包 #${restoreSource.bundleId}）` : '未选择'}
          </Typography.Text>

          {preview && (
            <>
              <Typography.Text strong>
                校验结果：{preview.ok ? '通过' : '未通过（禁止恢复）'}
              </Typography.Text>
              <Table
                rowKey={(row) => `${row.table ?? row.item}-${row.item}`}
                size="small"
                pagination={false}
                scroll={{ y: 200 }}
                dataSource={preview.checks}
                columns={[
                  { title: '校验项', dataIndex: 'item' },
                  {
                    title: '结果',
                    dataIndex: 'ok',
                    width: 90,
                    render: (ok: boolean) =>
                      ok ? <Tag color="green">一致</Tag> : <Tag color="red">不一致</Tag>,
                  },
                  { title: '明细', dataIndex: 'detail' },
                ]}
              />
              {preview.diff.length > 0 && (
                <Table
                  rowKey="table"
                  size="small"
                  pagination={false}
                  scroll={{ y: 200 }}
                  dataSource={preview.diff}
                  columns={[
                    { title: '变化表', dataIndex: 'name', render: (_, row) => row.name || '其他数据' },
                    { title: '当前', dataIndex: 'current', width: 90 },
                    { title: '包内', dataIndex: 'incoming', width: 90 },
                    {
                      title: '增减',
                      dataIndex: 'delta',
                      width: 90,
                      render: (d: number) => (
                        <span style={{ color: d > 0 ? '#52a447' : '#d9645c' }}>
                          {d > 0 ? `+${d}` : d}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </>
          )}

          <Form layout="vertical">
            <Form.Item
              label={`请输入「${RESTORE_CONFIRM_PHRASE}」以确认恢复`}
              help="确认短语用于防止误操作，输入不一致时服务端直接拒绝"
            >
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={RESTORE_CONFIRM_PHRASE}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 底部面板表单），
 * 与角色管理/用户管理保持同一套移动端呈现规范；桌面端零影响。
 */
export default function AdminData() {
  const isMobile = useIsMobile();
  return isMobile ? <AdminDataMobile /> : <AdminDataDesktop />;
}

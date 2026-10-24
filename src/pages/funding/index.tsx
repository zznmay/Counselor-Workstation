import {
  AlertOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  GiftOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  SwapOutlined,
  TeamOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getClassOptions, getGradeOptions } from '@/api/classes';
import {
  batchFunding,
  changeFundingStatus,
  createFunding,
  getFundingDetail,
  getFundingProfiles,
  getFundingStats,
  importFunding,
  previewRollover,
  resolveFundingStudents,
  rolloverFunding,
  updateFunding,
} from '@/api/funding';
import PageHeader from '@/components/PageHeader';
import StatCard from '@/components/StatCard';
import {
  FUNDING_DIFFICULTY_TYPES,
  FUNDING_LEVELS,
  FUNDING_LEVEL_COLOR,
  FUNDING_STATUSES,
  FUNDING_STATUS_COLOR,
  toOptions,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useList } from '@/hooks/useList';
import { useStudentOptions } from '@/hooks/useStudentOptions';
import { canAction, getStoredUser } from '@/lib/auth';
import type {
  ClassOption,
  FundingDetail,
  FundingDifficultyType,
  FundingImportFailure,
  FundingImportResult,
  FundingImportRow,
  FundingLevel,
  FundingLog,
  FundingProfile,
  FundingQuery,
  FundingRolloverCandidate,
  FundingRolloverPreview,
  FundingStats,
  GradeOption,
  StudentOption,
} from '@/types';
import {
  academicYearRange,
  buildAcademicYearOptions,
  currentAcademicYear,
  formatFundingTypes,
  nextAcademicYear,
} from '@/utils/funding';
import {
  exportFundingRoster,
  exportFundingSummary,
  fetchAllFundingProfiles,
} from '@/utils/fundingExport';
import {
  downloadFundingTemplate,
  exportFundingImportFailures,
  parseFundingExcel,
  validateFundingRows,
} from '@/utils/fundingImport';
import FundingMobile from './mobile';

interface FundingFormValues {
  studentId: string;
  academicYear: string;
  level: FundingLevel;
  difficultyTypes?: FundingDifficultyType[];
  identifiedAt: Dayjs;
  validFrom: Dayjs;
  validTo: Dayjs;
  basis?: string;
  remark?: string;
  reason?: string;
}

const LOG_ACTION_LABEL: Record<FundingLog['action'], string> = {
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

const LOG_ACTION_COLOR: Record<FundingLog['action'], string> = {
  create: 'green',
  update: 'blue',
  level_change: 'orange',
  status_change: 'blue',
  review: 'green',
  cancel: 'red',
  rollover: 'purple',
  import: 'gray',
  reidentify: 'green',
};

const SOURCE_LABEL: Record<FundingProfile['source'], string> = {
  manual: '手工录入',
  import: 'Excel 导入',
  rollover: '学年结转',
};

function MiniBars({ items, color }: { items: { label: string; count: number }[]; color: string }) {
  const visible = items.slice(0, 6);
  const max = Math.max(...visible.map((m) => m.count), 1);
  if (visible.length === 0) {
    return <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>暂无数据</div>;
  }
  return (
    <div>
      {visible.map((item) => (
        <div className="mini-bar-row" key={item.label}>
          <span className="mini-bar-label" title={item.label}>{item.label}</span>
          <span className="mini-bar-track">
            <span className="mini-bar-fill" style={{ width: `${Math.max(2, (item.count / max) * 100)}%`, background: color }} />
          </span>
          <span className="mini-bar-count">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function FundingDesktop() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const authUser = useAuthUser();
  const [form] = Form.useForm<FundingFormValues>();
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [stats, setStats] = useState<FundingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);

  const { query, patchQuery, data, loading, refresh } = useList<FundingProfile, FundingQuery>(
    getFundingProfiles,
    { page: 1, pageSize: 10, academicYear: currentAcademicYear() },
  );

  const statsQuery = useMemo(() => {
    const { page: _page, pageSize: _pageSize, ...rest } = query;
    return rest;
  }, [query]);

  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    setStatsLoading(true);
    getFundingStats(statsQuery)
      .then((next) => { if (alive) setStats(next); })
      .catch(() => undefined)
      .finally(() => { if (alive) setStatsLoading(false); });
    return () => { alive = false; };
  }, [statsQuery, statsVersion]);

  const refreshAll = useCallback(() => {
    refresh();
    setStatsVersion((v) => v + 1);
  }, [refresh]);

  /* ---------- 新增 / 编辑 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FundingProfile | null>(null);
  const [reidentifySource, setReidentifySource] = useState<FundingProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickedStudent, setPickedStudent] = useState<StudentOption | null>(null);

  const {
    options: studentOptions,
    loading: studentOptionsLoading,
    search: searchStudents,
    handlePopupScroll,
  } = useStudentOptions({ enabled: formOpen, manageableOnly: true, selected: pickedStudent });

  const yearOptions = useMemo(() => {
    const options = buildAcademicYearOptions(5, 1);
    const extra = [editing?.academicYear, reidentifySource?.academicYear].filter(Boolean) as string[];
    const values = new Set(options.map((o) => o.value));
    for (const year of extra) {
      if (!values.has(year)) options.push({ value: year, label: year });
    }
    return options.sort((a, b) => b.value.localeCompare(a.value));
  }, [editing, reidentifySource]);

  useEffect(() => {
    if (!formOpen) return;
    if (editing) {
      form.setFieldsValue({
        studentId: editing.studentId,
        academicYear: editing.academicYear,
        level: editing.level,
        difficultyTypes: editing.difficultyTypes,
        identifiedAt: dayjs(editing.identifiedAt),
        validFrom: dayjs(editing.validFrom),
        validTo: dayjs(editing.validTo),
        basis: editing.basis,
        remark: editing.remark,
        reason: undefined,
      });
      return;
    }
    if (reidentifySource) {
      const range = academicYearRange(reidentifySource.academicYear);
      form.setFieldsValue({
        studentId: reidentifySource.studentId,
        academicYear: reidentifySource.academicYear,
        level: reidentifySource.level,
        difficultyTypes: reidentifySource.difficultyTypes,
        identifiedAt: dayjs(),
        validFrom: dayjs(range.validFrom),
        validTo: dayjs(range.validTo),
        basis: reidentifySource.basis,
        remark: reidentifySource.remark,
        reason: undefined,
      });
      return;
    }
    const year = (query.academicYear as string) || currentAcademicYear();
    const range = academicYearRange(year);
    form.resetFields();
    form.setFieldsValue({
      academicYear: year,
      level: '困难',
      difficultyTypes: [],
      identifiedAt: dayjs(),
      validFrom: dayjs(range.validFrom),
      validTo: dayjs(range.validTo),
    });
  }, [formOpen, editing, reidentifySource, form, query.academicYear]);

  const openCreate = () => {
    setEditing(null);
    setReidentifySource(null);
    setPickedStudent(null);
    searchStudents('');
    setFormOpen(true);
  };

  const openEdit = (record: FundingProfile) => {
    setEditing(record);
    setReidentifySource(null);
    setPickedStudent({
      id: record.studentId,
      name: record.studentName,
      studentNo: record.studentNo,
      className: record.className,
    });
    searchStudents('');
    setFormOpen(true);
  };

  const openReidentify = (record: FundingProfile) => {
    setEditing(null);
    setReidentifySource(record);
    setPickedStudent({
      id: record.studentId,
      name: record.studentName,
      studentNo: record.studentNo,
      className: record.className,
    });
    searchStudents('');
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    let values: FundingFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const base = {
        level: values.level,
        difficultyTypes: values.difficultyTypes ?? [],
        identifiedAt: values.identifiedAt.format('YYYY-MM'),
        validFrom: values.validFrom.format('YYYY-MM'),
        validTo: values.validTo.format('YYYY-MM'),
        basis: values.basis,
        remark: values.remark,
        reason: values.reason,
      };
      if (editing) {
        await updateFunding(editing.id, base);
        message.success('认定信息已更新');
      } else {
        await createFunding({
          ...base,
          studentId: values.studentId,
          academicYear: values.academicYear,
          previousId: reidentifySource?.id ?? null,
        });
        message.success(reidentifySource ? '已重新认定' : '认定已建立');
      }
      setFormOpen(false);
      refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 详情 ---------- */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<FundingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const next = await getFundingDetail(id);
      setDetail(next);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '详情加载失败');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  const openDetail = (record: FundingProfile) => {
    setDetailOpen(true);
    setDetail(null);
    void loadDetail(record.id);
  };

  /* ---------- 状态变更 ---------- */
  const [statusTarget, setStatusTarget] = useState<FundingProfile | null>(null);
  const [statusAction, setStatusAction] = useState<'confirm' | 'cancel'>('cancel');
  const [statusReason, setStatusReason] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const openStatus = (record: FundingProfile, action: 'confirm' | 'cancel') => {
    setStatusTarget(record);
    setStatusAction(action);
    setStatusReason('');
  };

  const submitStatus = async () => {
    if (!statusTarget) return;
    if (statusAction === 'cancel' && !statusReason.trim()) {
      message.error('取消认定必须填写原因');
      return;
    }
    setStatusSubmitting(true);
    try {
      await changeFundingStatus(statusTarget.id, {
        action: statusAction,
        reason: statusReason.trim() || undefined,
      });
      message.success(statusAction === 'cancel' ? '已取消认定' : '已确认认定');
      setStatusTarget(null);
      refreshAll();
      if (detail?.id === statusTarget.id) void loadDetail(statusTarget.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setStatusSubmitting(false);
    }
  };

  /* ---------- 批量操作 ---------- */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<'changeLevel' | 'cancel' | 'renew' | 'confirm'>('changeLevel');
  const [batchLevel, setBatchLevel] = useState<FundingLevel>('困难');
  const [batchValidTo, setBatchValidTo] = useState<Dayjs | null>(null);
  const [batchReason, setBatchReason] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const openBatch = (action: 'changeLevel' | 'cancel' | 'renew' | 'confirm') => {
    setBatchAction(action);
    setBatchLevel('困难');
    setBatchValidTo(dayjs().add(1, 'year'));
    setBatchReason('');
    setBatchOpen(true);
  };

  const submitBatch = async () => {
    if (selectedIds.length === 0) return;
    if (batchAction !== 'confirm' && !batchReason.trim()) {
      message.error('请填写操作原因');
      return;
    }
    if (batchAction === 'renew' && !batchValidTo) {
      message.error('请选择新的有效期截止日期');
      return;
    }
    setBatchSubmitting(true);
    try {
      const result = await batchFunding({
        ids: selectedIds,
        action: batchAction,
        level: batchAction === 'changeLevel' ? batchLevel : undefined,
        validTo: batchAction === 'renew' ? batchValidTo?.format('YYYY-MM') : undefined,
        reason: batchReason.trim() || undefined,
      });
      if (result.failureCount > 0) {
        message.warning(`成功 ${result.successCount} 条，失败 ${result.failureCount} 条：${result.failures[0]?.reason ?? ''}`);
      } else {
        message.success(`已成功处理 ${result.successCount} 条记录`);
      }
      setBatchOpen(false);
      setSelectedIds([]);
      refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量操作失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  /* ---------- 学年结转 ---------- */
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [rolloverFrom, setRolloverFrom] = useState(currentAcademicYear());
  const [rolloverTo, setRolloverTo] = useState(nextAcademicYear(currentAcademicYear()));
  const [rolloverPreview, setRolloverPreview] = useState<FundingRolloverPreview | null>(null);
  const [rolloverLoading, setRolloverLoading] = useState(false);
  const [rolloverSubmitting, setRolloverSubmitting] = useState(false);

  const openRollover = () => {
    const from = (query.academicYear as string) || currentAcademicYear();
    setRolloverFrom(from);
    setRolloverTo(nextAcademicYear(from));
    setRolloverPreview(null);
    setRolloverOpen(true);
  };

  useEffect(() => {
    if (!rolloverOpen) return undefined;
    let alive = true;
    setRolloverLoading(true);
    previewRollover(rolloverFrom, rolloverTo)
      .then((next) => { if (alive) setRolloverPreview(next); })
      .catch((err) => {
        if (!alive) return;
        setRolloverPreview(null);
        message.error(err instanceof Error ? err.message : '结转预览失败');
      })
      .finally(() => { if (alive) setRolloverLoading(false); });
    return () => { alive = false; };
  }, [rolloverOpen, rolloverFrom, rolloverTo, message]);

  const submitRollover = async () => {
    setRolloverSubmitting(true);
    try {
      const result = await rolloverFunding({ fromYear: rolloverFrom, toYear: rolloverTo });
      message.success(`学年结转完成：新增 ${result.created} 条，跳过 ${result.skipped} 条`);
      if (result.failureCount > 0) {
        message.warning(`另有 ${result.failureCount} 条结转失败：${result.failures[0]?.reason ?? ''}`);
      }
      setRolloverOpen(false);
      patchQuery({ academicYear: rolloverTo });
      refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '学年结转失败');
    } finally {
      setRolloverSubmitting(false);
    }
  };

  /* ---------- 导入 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<FundingImportRow[]>([]);
  const [importFailures, setImportFailures] = useState<FundingImportFailure[]>([]);
  const [importResult, setImportResult] = useState<FundingImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResolving, setImportResolving] = useState(false);

  const openImport = () => {
    setImportRows([]);
    setImportFailures([]);
    setImportResult(null);
    setImportOpen(true);
  };

  const handleImportFile = async (file: File) => {
    setImportResolving(true);
    try {
      const parsed = await parseFundingExcel(file);
      const result = validateFundingRows(parsed);
      if (result.valid.length === 0) {
        setImportRows([]);
        setImportFailures(result.failures);
        setImportResult(null);
        if (result.failures.length === 0) message.warning('文件中没有可导入的数据行');
        return;
      }

      // 按学号从学生名册回填姓名、班级、年级，并提前拦截名册缺失/无权限的行
      const lookup = await resolveFundingStudents(result.valid.map((row) => row.studentNo));
      const studentByNo = new Map(lookup.students.map((student) => [student.studentNo, student]));
      const failures = [...result.failures];
      const resolved: FundingImportRow[] = [];
      for (const row of result.valid) {
        const student = studentByNo.get(row.studentNo);
        if (!student) {
          failures.push({
            row: row.row,
            studentNo: row.studentNo,
            name: '',
            reason: '学号未匹配到学生名册',
          });
          continue;
        }
        if (!student.manageable) {
          failures.push({
            row: row.row,
            studentNo: row.studentNo,
            name: student.name,
            reason: '无权操作该学生（仅所带班级）',
          });
          continue;
        }
        resolved.push({
          ...row,
          name: student.name,
          className: student.className,
          grade: student.grade,
          studentStatus: student.studentStatus,
          manageable: true,
        });
      }
      setImportRows(resolved);
      setImportFailures(failures);
      setImportResult(null);
      if (resolved.length === 0) {
        message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '文件解析或名册核对失败');
    } finally {
      setImportResolving(false);
    }
  };

  const submitImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    try {
      const result = await importFunding(importRows);
      setImportResult(result);
      if (result.failureCount > 0) {
        setImportFailures(result.failures);
        message.warning(`导入完成：新增 ${result.created}、更新 ${result.updated}、失败 ${result.failureCount}`);
      } else {
        message.success(`导入完成：新增 ${result.created}、更新 ${result.updated}`);
        setImportOpen(false);
      }
      setImportRows([]);
      refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  /* ---------- 导出 ---------- */
  const [exporting, setExporting] = useState(false);
  const handleExport = async (kind: 'roster' | 'summary') => {
    setExporting(true);
    try {
      const { page: _page, pageSize: _pageSize, ...filter } = query;
      const rows = await fetchAllFundingProfiles(filter);
      if (rows.length === 0) {
        message.warning('当前筛选条件下没有可导出的数据');
        return;
      }
      const year = (query.academicYear as string) || currentAcademicYear();
      const displayName = getStoredUser()?.displayName;
      if (kind === 'roster') await exportFundingRoster(rows, year, displayName);
      else await exportFundingSummary(rows, year, displayName);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({
      keyword: undefined,
      academicYear: currentAcademicYear(),
      level: undefined,
      status: undefined,
      difficultyType: undefined,
      classIds: undefined,
      grade: undefined,
      expiry: undefined,
    });
  };

  const filterGradeId = useMemo(
    () => (query.grade ? gradeOptions.find((g) => g.name === query.grade)?.id : undefined),
    [query.grade, gradeOptions],
  );

  const filterClassOptions = useMemo(
    () => classOptions
      .filter((c) => filterGradeId === undefined || c.gradeId === filterGradeId)
      .map((c) => ({
        value: c.id,
        label: filterGradeId === undefined ? `${c.gradeName}·${c.name}` : c.name,
      })),
    [classOptions, filterGradeId],
  );

  const selectedClassIds = useMemo(
    () => (query.classIds ? String(query.classIds).split(',').map(Number).filter(Boolean) : []),
    [query.classIds],
  );

  const columns: ColumnsType<FundingProfile> = [
    {
      title: '学生',
      dataIndex: 'studentName',
      width: 160,
      fixed: 'left',
      render: (_, record) => (
        <div>
          <a onClick={() => openDetail(record)} style={{ fontWeight: 600 }}>{record.studentName}</a>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            {record.className} · {record.studentNo}
          </div>
        </div>
      ),
    },
    { title: '认定学年', dataIndex: 'academicYear', width: 110 },
    {
      title: '困难等级',
      dataIndex: 'level',
      width: 100,
      render: (level: FundingLevel) => <Tag color={FUNDING_LEVEL_COLOR[level]}>{level}</Tag>,
    },
    {
      title: '困难类型',
      dataIndex: 'difficultyTypes',
      width: 200,
      render: (types: FundingDifficultyType[]) => (
        types.length > 0
          ? <Space size={[4, 4]} wrap>{types.map((t) => <Tag key={t} color="blue">{t}</Tag>)}</Space>
          : <span style={{ color: 'rgba(0,0,0,0.3)' }}>—</span>
      ),
    },
    {
      title: '有效期',
      key: 'validity',
      width: 200,
      render: (_, record) => {
        const today = dayjs().startOf('day');
        const endOfValidMonth = record.validTo
          ? dayjs(`${record.validTo.slice(0, 7)}-01`).endOf('month').startOf('day')
          : null;
        const days = endOfValidMonth ? endOfValidMonth.diff(today, 'day') : null;
        const expired = record.displayStatus === '已过期';
        const soon = !expired && record.status === '已认定' && days != null && days >= 0 && days <= 30;
        return (
          <div>
            <div style={{ fontSize: 13 }}>{record.validFrom} ~ {record.validTo}</div>
            {expired && <Tag color="volcano" style={{ marginTop: 4 }}>已过期</Tag>}
            {soon && <Tag color="orange" style={{ marginTop: 4 }}>{days === 0 ? '今天到期' : `${days} 天后到期`}</Tag>}
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'displayStatus',
      width: 100,
      render: (status: string) => <Tag color={FUNDING_STATUS_COLOR[status] ?? 'default'}>{status}</Tag>,
    },
    {
      title: '学生状态',
      dataIndex: 'studentStatus',
      width: 90,
      render: (status?: string) => (
        status && status !== '在读'
          ? <Tag color={status === '退学' ? 'red' : 'orange'}>{status}</Tag>
          : <span style={{ color: 'rgba(0,0,0,0.35)' }}>在读</span>
      ),
    },
    { title: '最近变更', dataIndex: 'updatedAt', width: 150 },
    {
      title: '操作',
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button type="link" size="small" onClick={() => openDetail(record)}>详情</Button>
          {record.status !== '已取消' && (
            <>
              {canAction(authUser, 'funding', 'edit') && (
                <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
              )}
              {record.status === '待复核' && canAction(authUser, 'funding', 'confirm') && (
                <Button type="link" size="small" onClick={() => openStatus(record, 'confirm')}>确认</Button>
              )}
              {record.status !== '待复核' && canAction(authUser, 'funding', 'cancel') && (
                <Button type="link" size="small" onClick={() => openStatus(record, 'cancel')}>取消</Button>
              )}
            </>
          )}
          {record.status === '已取消' && canAction(authUser, 'funding', 'redo') && (
            <Button type="link" size="small" onClick={() => openReidentify(record)}>重新认定</Button>
          )}
        </Space>
      ),
    },
  ];

  const coverage = stats?.summary.coverage ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="资助管理"
        subtitle="家庭经济困难学生认定档案、学年复核与对象统计"
        extra={(
          <Space wrap>
            <Select
              value={query.academicYear}
              style={{ width: 130 }}
              options={buildAcademicYearOptions(5, 1)}
              onChange={(academicYear) => patchQuery({ academicYear })}
            />
            {canAction(authUser, 'funding', 'create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增认定</Button>
            )}
            {canAction(authUser, 'funding', 'import') && (
              <Button icon={<UploadOutlined />} onClick={openImport}>批量导入</Button>
            )}
            {canAction(authUser, 'funding', 'rollover') && (
              <Button icon={<SwapOutlined />} onClick={openRollover}>学年结转</Button>
            )}
            {canAction(authUser, 'funding', 'export') && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'roster', label: '导出认定名册' },
                    { key: 'summary', label: '导出汇总报表' },
                  ],
                  onClick: ({ key }) => void handleExport(key as 'roster' | 'summary'),
                }}
              >
                <Button icon={<DownloadOutlined />} loading={exporting}>导出</Button>
              </Dropdown>
            )}
          </Space>
        )}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <StatCard
            icon={<GiftOutlined />}
            color="#4a6fe3"
            label="本学年已认定"
            value={stats?.summary.identifiedCount ?? '—'}
            extra={<span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>认定率 {coverage}%</span>}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            icon={<AlertOutlined />}
            color="#d9534f"
            label="特别困难"
            value={stats?.byLevel.find((l) => l.label === '特别困难')?.count ?? '—'}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            icon={<TeamOutlined />}
            color="#e08a2e"
            label="困难"
            value={stats?.byLevel.find((l) => l.label === '困难')?.count ?? '—'}
          />
        </Col>
        <Col xs={12} lg={6}>
          <StatCard
            icon={<CheckCircleOutlined />}
            color="#3a9b6e"
            label="一般困难"
            value={stats?.byLevel.find((l) => l.label === '一般困难')?.count ?? '—'}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}>
          <Card title="学年认定概览" size="small" loading={statsLoading}>
            <Progress percent={coverage} strokeColor="#4a6fe3" />
            <Space size={[8, 8]} wrap style={{ marginTop: 8 }}>
              <Tag color="blue">待复核 {stats?.summary.pendingCount ?? 0}</Tag>
              <Tag color="orange">30 天内到期 {stats?.summary.expiringCount ?? 0}</Tag>
              <Tag color="volcano">已过期 {stats?.summary.expiredCount ?? 0}</Tag>
              <Tag>已取消 {stats?.summary.cancelledCount ?? 0}</Tag>
            </Space>
            <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              认定率 = 已认定人数 / 范围内在读学生数（{stats?.summary.studentCount ?? 0} 人）
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="班级分布" size="small" loading={statsLoading}>
            <MiniBars items={stats?.byClass ?? []} color="#4a6fe3" />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="困难类型分布" size="small" loading={statsLoading}>
            <MiniBars items={stats?.byType ?? []} color="#5f86ff" />
          </Card>
        </Col>
      </Row>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索学生 / 学号 / 班级 / 依据"
          style={{ width: 230 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="困难等级"
          allowClear
          style={{ width: 120 }}
          options={toOptions(FUNDING_LEVELS)}
          value={query.level}
          onChange={(level) => patchQuery({ level })}
        />
        <Select
          placeholder="认定状态"
          allowClear
          style={{ width: 120 }}
          options={toOptions(FUNDING_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status: status as FundingQuery['status'] })}
        />
        <Select
          placeholder="困难类型"
          allowClear
          style={{ width: 140 }}
          options={toOptions(FUNDING_DIFFICULTY_TYPES)}
          value={query.difficultyType}
          onChange={(difficultyType) => patchQuery({ difficultyType })}
        />
        <Select
          placeholder="年级"
          allowClear
          style={{ width: 110 }}
          options={gradeOptions.map((g) => ({ value: g.name, label: g.name }))}
          value={query.grade}
          onChange={(grade) => patchQuery({ grade, classIds: undefined })}
        />
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="班级（可多选）"
          style={{ minWidth: 190, maxWidth: 300 }}
          popupMatchSelectWidth={false}
          options={filterClassOptions}
          value={selectedClassIds}
          disabled={filterClassOptions.length === 0}
          notFoundContent="该年级下暂无可选班级"
          onChange={(ids: number[]) => patchQuery({ classIds: ids.length > 0 ? ids.join(',') : undefined })}
        />
        <Select
          placeholder="有效期"
          allowClear
          style={{ width: 120 }}
          options={[
            { value: 'valid', label: '有效' },
            { value: 'soon', label: '30 天内到期' },
            { value: 'expired', label: '已过期' },
          ]}
          value={query.expiry}
          onChange={(expiry) => patchQuery({ expiry })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>重置</Button>
        <div className="toolbar-spacer" />
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
          共 {data.total} 条认定
        </span>
      </div>

      {selectedIds.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>已选 <b>{selectedIds.length}</b> 条</span>
          {canAction(authUser, 'funding', 'batch') && (
            <>
              <Button size="small" onClick={() => openBatch('changeLevel')}>批量调级</Button>
              <Button size="small" onClick={() => openBatch('renew')}>批量续期</Button>
              <Button size="small" onClick={() => openBatch('confirm')}>批量确认复核</Button>
              <Button size="small" danger onClick={() => openBatch('cancel')}>批量取消</Button>
            </>
          )}
          <div className="toolbar-spacer" />
          <Button size="small" type="link" onClick={() => setSelectedIds([])}>清空选择</Button>
        </div>
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1400 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map(String)),
          getCheckboxProps: (record) => ({ disabled: record.status === '已取消' }),
        }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条认定`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 详情 */}
      <Drawer
        title={detail ? `认定详情 · ${detail.studentName}` : '认定详情'}
        width={640}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        extra={detail && (
          <Space>
            {detail.status === '待复核' && (
              <Button type="primary" size="small" onClick={() => openStatus(detail, 'confirm')}>确认复核</Button>
            )}
            {detail.status !== '已取消' && (
              <>
                <Button size="small" onClick={() => { setDetailOpen(false); openEdit(detail); }}>编辑</Button>
                <Button danger size="small" onClick={() => openStatus(detail, 'cancel')}>取消认定</Button>
              </>
            )}
            {detail.status === '已取消' && (
              <Button type="primary" size="small" onClick={() => { setDetailOpen(false); openReidentify(detail); }}>重新认定</Button>
            )}
          </Space>
        )}
      >
        {detailLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
        {!detailLoading && detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="学生" span={2}>
                {detail.studentName}（{detail.className} · {detail.studentNo}）
                {detail.studentStatus && detail.studentStatus !== '在读' && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>{detail.studentStatus}</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="认定学年">{detail.academicYear}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={FUNDING_STATUS_COLOR[detail.displayStatus] ?? 'default'}>{detail.displayStatus}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="困难等级">
                <Tag color={FUNDING_LEVEL_COLOR[detail.level]}>{detail.level}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="困难类型">{formatFundingTypes(detail.difficultyTypes) || '—'}</Descriptions.Item>
              <Descriptions.Item label="认定日期">{detail.identifiedAt}</Descriptions.Item>
              <Descriptions.Item label="有效期">{detail.validFrom} ~ {detail.validTo}</Descriptions.Item>
              <Descriptions.Item label="数据来源">{SOURCE_LABEL[detail.source]}</Descriptions.Item>
              <Descriptions.Item label="认定依据" span={2}>{detail.basis || '—'}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{detail.remark || '—'}</Descriptions.Item>
              {detail.cancelReason && (
                <Descriptions.Item label="取消原因" span={2}>{detail.cancelReason}</Descriptions.Item>
              )}
            </Descriptions>

            {detail.warnings.length > 0 && (
              <Card size="small" title="关联经济困难预警" extra={<Button type="link" size="small" onClick={() => navigate('/warnings')}>前往预警管理</Button>}>
                {detail.warnings.map((w) => (
                  <div key={w.id} style={{ fontSize: 13, marginBottom: 6 }}>
                    <Tag color="cyan">{w.level}</Tag>
                    {w.reason}（{w.raisedAt?.slice(0, 10)} · {w.status}）
                  </div>
                ))}
              </Card>
            )}

            {detail.conversations.length > 0 && (
              <Card size="small" title="关联资助帮扶谈话" extra={<Button type="link" size="small" onClick={() => navigate(`/conversations?studentId=${detail.studentId}`)}>查看谈话</Button>}>
                {detail.conversations.map((c) => (
                  <div key={c.id} style={{ fontSize: 13, marginBottom: 6 }}>
                    {c.talkTime} · {c.way}：{c.content}
                  </div>
                ))}
              </Card>
            )}

            <Card size="small" title="认定变更时间线">
              {detail.logs.length === 0 ? (
                <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>暂无变更记录</div>
              ) : (
                <Timeline
                  items={detail.logs.map((log) => ({
                    color: LOG_ACTION_COLOR[log.action] ?? 'blue',
                    children: (
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {LOG_ACTION_LABEL[log.action] ?? log.action}
                          {log.fromLevel && log.toLevel && log.fromLevel !== log.toLevel && (
                            <span style={{ fontWeight: 400 }}>：{log.fromLevel} → {log.toLevel}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                          {log.operatorName ?? '系统'} · {log.createdAt}
                        </div>
                        {log.reason && <div style={{ fontSize: 13, marginTop: 4 }}>{log.reason}</div>}
                      </div>
                    ),
                  }))}
                />
              )}
            </Card>
          </Space>
        )}
      </Drawer>

      {/* 新增 / 编辑 / 重新认定 */}
      <Modal
        title={editing ? `编辑认定 · ${editing.studentName}` : reidentifySource ? `重新认定 · ${reidentifySource.studentName}` : '新增困难生认定'}
        width={720}
        open={formOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="studentId" label="学生" rules={[{ required: true, message: '请选择学生' }]}>
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={searchStudents}
                  onPopupScroll={handlePopupScroll}
                  loading={studentOptionsLoading}
                  disabled={!!editing || !!reidentifySource}
                  placeholder="输入姓名或学号搜索"
                  onChange={(value) => setPickedStudent(studentOptions.find((s) => s.id === value) ?? null)}
                  options={studentOptions.map((s) => ({
                    value: s.id,
                    label: `${s.name}（${s.className} · ${s.studentNo}）`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="academicYear" label="认定学年" rules={[{ required: true, message: '请选择认定学年' }]}>
                <Select
                  options={yearOptions}
                  disabled={!!editing || !!reidentifySource}
                  onChange={(year) => {
                    if (editing || reidentifySource) return;
                    const range = academicYearRange(year);
                    form.setFieldsValue({ validFrom: dayjs(range.validFrom), validTo: dayjs(range.validTo) });
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="level" label="困难等级" rules={[{ required: true }]}>
                <Select options={toOptions(FUNDING_LEVELS)} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="difficultyTypes" label="困难类型（可多选）">
                <Select mode="multiple" allowClear options={toOptions(FUNDING_DIFFICULTY_TYPES)} placeholder="如低保家庭、突发严重困难" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="identifiedAt" label="认定月份" rules={[{ required: true, message: '请选择认定月份' }]}>
                <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="validFrom" label="有效期起" rules={[{ required: true, message: '请选择开始月份' }]}>
                <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="validTo"
                label="有效期止"
                dependencies={['validFrom']}
                rules={[
                  { required: true, message: '请选择结束月份' },
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs | null) {
                      const start = getFieldValue('validFrom') as Dayjs | undefined;
                      if (!value || !start || !value.isBefore(start, 'month')) return Promise.resolve();
                      return Promise.reject(new Error('结束月份不能早于开始月份'));
                    },
                  }),
                ]}
              >
                <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="basis" label="认定依据">
            <Input.TextArea rows={3} placeholder="如低保、特困供养、突发严重困难等具体依据" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="其它需要说明的情况" />
          </Form.Item>
          {(editing || reidentifySource) && (
            <Form.Item
              name="reason"
              label={reidentifySource ? '重新认定原因' : '本次变更原因'}
              rules={[{ required: true, message: reidentifySource ? '请填写重新认定原因' : '请填写变更原因' }]}
            >
              <Input.TextArea rows={2} placeholder="用于变更留痕，如：家庭突发变故、等级调整依据等" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 状态变更 */}
      <Modal
        title={statusAction === 'cancel' ? `取消认定 · ${statusTarget?.studentName ?? ''}` : `确认复核 · ${statusTarget?.studentName ?? ''}`}
        open={!!statusTarget}
        confirmLoading={statusSubmitting}
        onOk={submitStatus}
        onCancel={() => setStatusTarget(null)}
        okText={statusAction === 'cancel' ? '确认取消' : '确认认定'}
        okButtonProps={{ danger: statusAction === 'cancel' }}
        cancelText="返回"
      >
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 12 }}>
          {statusAction === 'cancel'
            ? '取消后记录将保留为历史，可在列表筛选「已取消」查看，也可重新认定。'
            : '确认后该记录状态变为「已认定」，本学年正式生效。'}
        </div>
        <Input.TextArea
          rows={3}
          value={statusReason}
          onChange={(e) => setStatusReason(e.target.value)}
          placeholder={statusAction === 'cancel' ? '取消原因（必填）' : '复核说明（选填）'}
        />
      </Modal>

      {/* 批量操作 */}
      <Modal
        title={`批量${batchAction === 'cancel' ? '取消' : batchAction === 'changeLevel' ? '调级' : batchAction === 'renew' ? '续期' : '确认复核'}`}
        open={batchOpen}
        confirmLoading={batchSubmitting}
        onOk={submitBatch}
        onCancel={() => setBatchOpen(false)}
        okText="执行"
        cancelText="取消"
        okButtonProps={{ danger: batchAction === 'cancel' }}
      >
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 12 }}>
          已选择 {selectedIds.length} 条记录，操作将逐条校验，非法记录会返回失败原因。
        </div>
        {batchAction === 'changeLevel' && (
          <Form layout="vertical">
            <Form.Item label="新的困难等级" required>
              <Select value={batchLevel} onChange={setBatchLevel} options={toOptions(FUNDING_LEVELS)} />
            </Form.Item>
          </Form>
        )}
        {batchAction === 'renew' && (
          <Form layout="vertical">
            <Form.Item label="新的有效期截止月份" required>
              <DatePicker picker="month" format="YYYY-MM" value={batchValidTo} onChange={setBatchValidTo} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        )}
        {batchAction !== 'confirm' && (
          <Input.TextArea
            rows={3}
            value={batchReason}
            onChange={(e) => setBatchReason(e.target.value)}
            placeholder="操作原因（必填，用于留痕）"
          />
        )}
      </Modal>

      {/* 导入 */}
      <Modal
        title="批量导入困难生认定"
        width={900}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={(
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => void downloadFundingTemplate()}>下载模板</Button>
            {importFailures.length > 0 && (
              <Button onClick={() => void exportFundingImportFailures(importFailures)}>导出失败明细</Button>
            )}
            <Button onClick={() => setImportOpen(false)}>关闭</Button>
            <Button
              type="primary"
              loading={importing}
              disabled={importRows.length === 0 || importResolving}
              onClick={submitImport}
            >
              开始导入（{importRows.length} 行）
            </Button>
          </Space>
        )}
      >
        <Upload.Dragger
          accept=".xlsx,.xls"
          showUploadList={false}
          disabled={importResolving}
          beforeUpload={(file) => {
            void handleImportFile(file as File);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此处</p>
          <p className="ant-upload-hint">
            {importResolving
              ? '正在按学号核对姓名与班级…'
              : '只需填写学号，姓名与班级将从学生名册自动带出；单次最多 2000 行'}
          </p>
        </Upload.Dragger>

        {importResult && (
          <Alert
            style={{ marginTop: 12 }}
            type={importResult.failureCount > 0 ? 'warning' : 'success'}
            showIcon
            message={`导入完成：新增 ${importResult.created} 条，更新 ${importResult.updated} 条，失败 ${importResult.failureCount} 条`}
          />
        )}
        {importRows.length > 0 && (
          <>
            <div style={{ margin: '12px 0 8px', fontWeight: 600 }}>可导入数据（预览前 10 行）</div>
            <Table<FundingImportRow>
              rowKey="row"
              size="small"
              pagination={false}
              scroll={{ x: 900 }}
              dataSource={importRows.slice(0, 10)}
              columns={[
                { title: '行号', dataIndex: 'row', width: 60 },
                { title: '学号', dataIndex: 'studentNo', width: 120 },
                {
                  title: '姓名',
                  dataIndex: 'name',
                  width: 120,
                  render: (_, row) => (
                    <Space size={4}>
                      {row.name}
                      {row.studentStatus && row.studentStatus !== '在读' && (
                        <Tag color="orange" style={{ marginInlineEnd: 0 }}>{row.studentStatus}</Tag>
                      )}
                    </Space>
                  ),
                },
                { title: '班级', dataIndex: 'className', width: 130 },
                { title: '年级', dataIndex: 'grade', width: 90 },
                { title: '学年', dataIndex: 'academicYear', width: 110 },
                { title: '困难等级', dataIndex: 'level', width: 100 },
                { title: '困难类型', dataIndex: 'difficultyTypes', render: (types: FundingDifficultyType[]) => formatFundingTypes(types) || '—' },
              ]}
            />
          </>
        )}
        {importFailures.length > 0 && (
          <>
            <div style={{ margin: '12px 0 8px', fontWeight: 600, color: '#d9534f' }}>
              失败 {importFailures.length} 行（修正后可重新上传）
            </div>
            <Table<FundingImportFailure>
              rowKey={(r) => `${r.row}-${r.studentNo}`}
              size="small"
              pagination={false}
              scroll={{ y: 180 }}
              dataSource={importFailures}
              columns={[
                { title: '行号', dataIndex: 'row', width: 60 },
                { title: '学号', dataIndex: 'studentNo', width: 120 },
                { title: '姓名', dataIndex: 'name', width: 90 },
                { title: '失败原因', dataIndex: 'reason' },
              ]}
            />
          </>
        )}
      </Modal>

      {/* 学年结转 */}
      <Modal
        title="学年复核与结转"
        width={760}
        open={rolloverOpen}
        confirmLoading={rolloverSubmitting}
        onOk={submitRollover}
        onCancel={() => setRolloverOpen(false)}
        okText="确认结转"
        cancelText="取消"
        okButtonProps={{
          disabled: !rolloverPreview || rolloverPreview.candidates.filter((c) => !c.skipped).length === 0,
        }}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <span>源学年</span>
          <Select
            value={rolloverFrom}
            style={{ width: 130 }}
            options={buildAcademicYearOptions(5, 0)}
            onChange={(year) => {
              setRolloverFrom(year);
              setRolloverTo(nextAcademicYear(year));
            }}
          />
          <span>目标学年</span>
          <Select value={rolloverTo} style={{ width: 130 }} options={[{ value: rolloverTo, label: rolloverTo }]} disabled />
        </Space>
        <Alert
          type="info"
          showIcon
          message="将源学年「已认定」且学生在读的记录结转为目标学年「待复核」，不覆盖已有目标学年记录。"
          style={{ marginBottom: 12 }}
        />
        {rolloverLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              可结转 <b>{rolloverPreview?.candidates.filter((c) => !c.skipped).length ?? 0}</b> 人，
              跳过 <b>{rolloverPreview?.skippedCount ?? 0}</b> 人（目标学年已有记录）
            </div>
            <Table<FundingRolloverCandidate>
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ y: 260 }}
              dataSource={(rolloverPreview?.candidates ?? []).slice(0, 50)}
              columns={[
                { title: '学生', dataIndex: 'studentName', width: 100 },
                { title: '班级', dataIndex: 'className', width: 120 },
                { title: '年级', dataIndex: 'grade', width: 90 },
                { title: '等级', dataIndex: 'level', width: 100 },
                {
                  title: '处理',
                  key: 'skipped',
                  width: 100,
                  render: (_, record) => record.skipped
                    ? <Tag>目标学年已存在</Tag>
                    : <Tag color="green">待结转</Tag>,
                },
              ]}
            />
            {(rolloverPreview?.candidates.length ?? 0) > 50 && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>
                仅预览前 50 条，实际结转会处理全部可结转记录。
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

/** 视口分发：桌面端完整功能，移动端卡片化流程 */
export default function Funding() {
  const isMobile = useIsMobile();
  return isMobile ? <FundingMobile /> : <FundingDesktop />;
}

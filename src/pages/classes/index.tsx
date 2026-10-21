import {
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Badge,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useRef, useState } from 'react';

import {
  createClass,
  deleteClass,
  getClasses,
  getClassStaff,
  getGradeOptions,
  getPendingStaff,
  getStaffUsers,
  importClasses,
  lookupStaffUsers,
  syncPendingStaff,
  updateClass,
} from '@/api/classes';
import type { ClassQuery } from '@/api/classes';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { downloadClassTemplate, exportClassImportFailures, parseClassExcel, validateClassRows } from '@/utils/classImport';
import type {
  ClassImportFailure,
  ClassImportResult,
  GradeOption,
  ParsedClassRow,
  PendingStaffItem,
  PendingSyncResult,
  SchoolClass,
  StaffEntry,
} from '@/types';
import ClassesMobile from './mobile';

interface ClassFormValues {
  gradeId: number;
  name: string;
  /** 辅导员/班主任工号（tags：可选已有账号，也可自由输入新工号） */
  counselorNos?: string[];
  headTeacherNos?: string[];
  /** 未匹配工号对应的姓名（key = 工号；保存后记待同步，用于「同步用户管理」建号） */
  counselorNames?: Record<string, string>;
  headTeacherNames?: Record<string, string>;
}

/** 工号格式：与服务端一致的 3-20 位字母/数字/下划线 */
export const EMPLOYEE_NO_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 班级管理（桌面端）：班级列表 + 工号绑定人员 + 同步用户管理 */
function ClassesDesktop() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ClassFormValues>();

  const { query, patchQuery, data, loading, refresh } = useList<SchoolClass, ClassQuery>(getClasses, {
    page: 1,
    pageSize: 10,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ---------- 班级批量导入状态 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<{
    fileName: string;
    totalRows: number;
    valid: ParsedClassRow[];
    failures: ClassImportFailure[];
  } | null>(null);
  const [importResult, setImportResult] = useState<ClassImportResult | null>(null);

  /* ---------- 同步用户管理状态 ---------- */
  const [pendingCount, setPendingCount] = useState(0);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingList, setPendingList] = useState<PendingStaffItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<PendingSyncResult | null>(null);

  /* ---------- 工号表单状态（候选选项 + 已知在职账号目录） ---------- */
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [knownStaff, setKnownStaff] = useState<Map<string, string>>(new Map());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // hook 纪律：useWatch 必须在组件顶层调用，严禁放进条件分支或回调
  const counselorNos = (Form.useWatch('counselorNos', form) ?? []) as string[];
  const headTeacherNos = (Form.useWatch('headTeachers', form) ?? []) as string[];

  const unknownCounselors = counselorNos.filter((no) => no && !knownStaff.has(no));
  const unknownHeadTeachers = headTeacherNos.filter((no) => no && !knownStaff.has(no));

  const loadPendingCount = () => {
    getPendingStaff()
      .then((list) => setPendingCount(list.length))
      .catch(() => undefined);
  };

  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
    loadPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 表单候选与目录：打开弹窗时拉取在职账号（前 50 个） */
  useEffect(() => {
    if (!modalOpen) return;
    getStaffUsers()
      .then((list) => {
        setStaffOptions(list.map((s) => ({ value: s.employeeNo, label: `${s.employeeNo}（${s.displayName}）` })));
        setKnownStaff((prev) => {
          const next = new Map(prev);
          list.forEach((s) => next.set(s.employeeNo, s.displayName));
          return next;
        });
      })
      .catch(() => undefined);
  }, [modalOpen]);

  /** 编辑回显：年级/名称 + 人员明细（正式绑定 + 待同步） */
  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ gradeId: editing.gradeId, name: editing.name });
      getClassStaff(editing.id)
        .then((list) => {
          form.setFieldsValue({
            counselorNos: list.filter((s) => s.roleType === 'counselor').map((s) => s.employeeNo),
            headTeacherNos: list.filter((s) => s.roleType === 'headTeacher').map((s) => s.employeeNo),
            counselorNames: Object.fromEntries(
              list.filter((s) => s.roleType === 'counselor' && Number(s.pending) === 1).map((s) => [s.employeeNo, s.displayName]),
            ),
            headTeacherNames: Object.fromEntries(
              list.filter((s) => s.roleType === 'headTeacher' && Number(s.pending) === 1).map((s) => [s.employeeNo, s.displayName]),
            ),
          });
          setKnownStaff((prev) => {
            const next = new Map(prev);
            list.forEach((s) => {
              if (Number(s.pending) !== 1) next.set(s.employeeNo, s.displayName);
            });
            return next;
          });
        })
        .catch(() => undefined);
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  /** 输入了不在目录中的工号 → 远程匹配一次，命中则不要求补姓名 */
  useEffect(() => {
    const unknown = [...new Set([...unknownCounselors, ...unknownHeadTeachers])];
    if (unknown.length === 0) return;
    const timer = setTimeout(() => {
      lookupStaffUsers(unknown)
        .then((items) => {
          setKnownStaff((prev) => {
            const next = new Map(prev);
            items.forEach((it) => {
              if (it.matched && it.displayName) next.set(it.keyword, it.displayName);
            });
            return next;
          });
        })
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counselorNos, headTeacherNos, knownStaff]);

  const searchStaffUsers = (keyword: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      getStaffUsers(keyword)
        .then((list) => {
          setStaffOptions(list.map((s) => ({ value: s.employeeNo, label: `${s.employeeNo}（${s.displayName}）` })));
        })
        .catch(() => undefined);
    }, 300);
  };

  const openImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    if (importResult && importResult.successCount > 0) {
      refresh();
      loadPendingCount();
    }
  };

  const resetImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
  };

  /** 解析并校验上传的 Excel：字典预检仅年级（工号匹配由服务端裁决，未匹配记待同步） */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseClassExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const gradeOpts = await getGradeOptions();
      const { valid, failures } = validateClassRows(rows, {
        gradeNames: new Set(gradeOpts.map((g) => g.name)),
      });
      setParsed({ fileName: file.name, totalRows: rows.length, valid, failures });
      if (valid.length === 0) {
        message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '文件解析失败，请使用标准模板填写');
    }
  };

  const confirmImport = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setImporting(true);
    try {
      const result = await importClasses(parsed.valid);
      setImportResult(result);
      setImportDone(true);
      message.success(
        `新增 ${result.insertedCount}、更新 ${result.updatedCount}、跳过 ${result.skippedCount} 个班级，待同步 ${result.pendingCount ?? 0} 人次`,
      );
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 导入时被服务端二次驳回的记录，合并展示/导出 */
  const allFailures: ClassImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  const openEdit = (record: SchoolClass) => {
    setEditing(record);
    setModalOpen(true);
  };

  /** 把 tags 工号数组组装为人员入参：命中在职账号用系统姓名，未匹配要求已填姓名（记待同步） */
  const buildStaffEntries = async (
    nos: string[] | undefined,
    namesMap: Record<string, string> | undefined,
    roleLabel: string,
  ): Promise<StaffEntry[]> => {
    const uniq = [...new Set((nos ?? []).map((s) => String(s).trim()).filter(Boolean))];
    if (uniq.length === 0) return [];
    for (const no of uniq) {
      if (!EMPLOYEE_NO_RE.test(no)) {
        message.warning(`${roleLabel}工号「${no}」格式不合法，需为 3-20 位字母/数字/下划线`);
        throw new Error('invalid-employee-no');
      }
    }
    const lookup = await lookupStaffUsers(uniq);
    const entries: StaffEntry[] = [];
    for (const it of lookup) {
      if (it.matched && it.displayName) {
        entries.push({ employeeNo: it.keyword, displayName: it.displayName });
        continue;
      }
      const typed = String(namesMap?.[it.keyword] ?? '').trim();
      if (!typed) {
        message.warning(`${roleLabel}工号「${it.keyword}」未匹配到账号，请填写其姓名`);
        throw new Error('pending-name-missing');
      }
      entries.push({ employeeNo: it.keyword, displayName: typed });
    }
    return entries;
  };

  const handleSubmit = async () => {
    let values: ClassFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const counselors = await buildStaffEntries(values.counselorNos, values.counselorNames, '辅导员');
      const headTeachers = await buildStaffEntries(values.headTeacherNos, values.headTeacherNames, '班主任');
      const payload = { gradeId: values.gradeId, name: values.name, counselors, headTeachers };
      if (editing) {
        await updateClass(editing.id, payload);
        message.success('班级信息已更新');
      } else {
        await createClass(payload);
        message.success('新增班级成功');
      }
      setModalOpen(false);
      refresh();
      loadPendingCount();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg !== 'pending-name-missing' && msg !== 'invalid-employee-no') {
        message.error(msg || '保存失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteClass(id);
      message.success('删除成功');
      refresh();
      loadPendingCount();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, gradeId: undefined });
  };

  /* ---------- 同步用户管理 ---------- */
  const openSync = async () => {
    try {
      const list = await getPendingStaff();
      setPendingList(list);
    } catch {
      setPendingList([]);
    }
    setSyncResult(null);
    setSyncOpen(true);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncPendingStaff();
      setSyncResult(result);
      message.success(`已新建 ${result.createdUsers} 个账号、绑定 ${result.linkedExisting} 个已有账号`);
      refresh();
      setPendingCount(result.total - result.skippedCount);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  /** 人员列：正式绑定姓名 + 待同步（橙色标记） */
  const renderStaffCell = (bound?: string, pending?: string) => {
    if (!bound && !pending) return '—';
    return (
      <Space size={4} wrap>
        {bound ? <span>{bound}</span> : null}
        {pending ? <Tag color="orange">{pending.replace(/（待同步）/g, '')}（待同步）</Tag> : null}
      </Space>
    );
  };

  const classColumns: ColumnsType<SchoolClass> = [
    { title: '班级名称', dataIndex: 'name', width: 150 },
    { title: '所属年级', dataIndex: 'gradeName', width: 110 },
    { title: '学生数', dataIndex: 'studentCount', width: 90, align: 'center' },
    {
      title: '所辖辅导员',
      key: 'counselors',
      ellipsis: true,
      render: (_, record) => renderStaffCell(record.counselorNames, record.pendingCounselorNames),
    },
    {
      title: '班主任',
      key: 'headTeachers',
      ellipsis: true,
      render: (_, record) => renderStaffCell(record.headTeacherNames, record.pendingHeadTeacherNames),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该班级吗？"
            description="班级与辅导员/班主任的关联及待同步人员将一并移除；班级下仍有学生时无法删除"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pendingColumns: ColumnsType<PendingStaffItem> = [
    { title: '工号', dataIndex: 'employeeNo', width: 130 },
    { title: '姓名', dataIndex: 'displayName', width: 110 },
    {
      title: '身份',
      dataIndex: 'roleType',
      width: 90,
      render: (v: string) => (v === 'headTeacher' ? '班主任' : '辅导员'),
    },
    { title: '年级', dataIndex: 'gradeName', width: 100 },
    { title: '班级', dataIndex: 'className' },
  ];

  return (
    <div className="page">
      <PageHeader
        title="班级管理"
        subtitle="维护班级基础信息与所属年级；辅导员/班主任按工号绑定用户账号，未匹配者记待同步，可在「同步用户管理」一键建号"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索班级名称"
          style={{ width: 220 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="所属年级"
          allowClear
          style={{ minWidth: 120 }}
          options={gradeOptions.map((g) => ({ value: g.id, label: g.name }))}
          value={query.gradeId}
          onChange={(gradeId) => patchQuery({ gradeId })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Badge count={pendingCount} size="small" offset={[-4, 2]}>
          <Button icon={<SyncOutlined />} onClick={openSync} disabled={pendingCount === 0}>
            同步用户管理
          </Button>
        </Badge>
        <Button icon={<UploadOutlined />} onClick={openImport}>
          批量导入
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setEditing(null);
            setModalOpen(true);
          }}
        >
          新增班级
        </Button>
      </div>
      <Table
        rowKey="id"
        columns={classColumns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个班级`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 新增 / 编辑班级 */}
      <Modal
        title={editing ? '编辑班级' : '新增班级'}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="gradeId"
            label="所属年级"
            rules={[{ required: true, message: '请选择所属年级' }]}
          >
            <Select
              placeholder="请选择所属年级"
              options={gradeOptions.map((g) => ({ value: g.id, label: g.name }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="班级名称"
            rules={[{ required: true, message: '请输入班级名称' }]}
          >
            <Input placeholder="如 计应2601" maxLength={30} />
          </Form.Item>
          <Form.Item
            name="counselorNos"
            label="辅导员工号"
            extra="可搜索选择已有账号，也可直接输入新工号（保存后记待同步）；多人逗号分隔"
          >
            <Select
              mode="tags"
              placeholder="输入或搜索工号"
              options={staffOptions}
              tokenSeparators={[',', '，', '、']}
              filterOption={false}
              onSearch={searchStaffUsers}
              notFoundContent={null}
            />
          </Form.Item>
          {unknownCounselors.map((no) => (
            <Form.Item
              key={`counselor-${no}`}
              name={['counselorNames', no]}
              label={`辅导员工号「${no}」的姓名`}
              rules={[{ required: true, message: '请输入该工号对应的姓名' }]}
              extra="该工号暂无账号：保存后将记为待同步，可在「同步用户管理」一键建号"
            >
              <Input placeholder="请输入真实姓名" maxLength={20} />
            </Form.Item>
          ))}
          <Form.Item
            name="headTeachers"
            label="班主任工号"
            extra="同上；可留空表示暂不指定班主任"
          >
            <Select
              mode="tags"
              placeholder="输入或搜索工号"
              options={staffOptions}
              tokenSeparators={[',', '，', '、']}
              filterOption={false}
              onSearch={searchStaffUsers}
              notFoundContent={null}
            />
          </Form.Item>
          {unknownHeadTeachers.map((no) => (
            <Form.Item
              key={`headTeacher-${no}`}
              name={['headTeacherNames', no]}
              label={`班主任工号「${no}」的姓名`}
              rules={[{ required: true, message: '请输入该工号对应的姓名' }]}
              extra="该工号暂无账号：保存后将记为待同步，可在「同步用户管理」一键建号"
            >
              <Input placeholder="请输入真实姓名" maxLength={20} />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      {/* 同步用户管理（待同步人员一键建号/绑班） */}
      <Modal
        title="同步用户管理"
        width={720}
        open={syncOpen}
        onCancel={() => setSyncOpen(false)}
        footer={
          syncResult
            ? [
                <Button key="close" type="primary" onClick={() => setSyncOpen(false)}>
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setSyncOpen(false)}>
                  取消
                </Button>,
                <Button key="ok" type="primary" loading={syncing} onClick={handleSync}>
                  开始同步（{pendingList.length} 人次）
                </Button>,
              ]
        }
      >
        {syncResult ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={syncResult.skippedCount > 0 ? 'warning' : 'success'}
              message={`同步完成：新建账号 ${syncResult.createdUsers} 个，绑定已有账号 ${syncResult.linkedExisting} 个，跳过 ${syncResult.skippedCount} 人次。`}
              description={
                <>
                  <div>新建账号初始密码为「Hzpt@工号」，首次登录强制修改。</div>
                  {syncResult.skippedCount > 0 && <div>跳过项保留在待同步清单中，处理后可再次同步。</div>}
                  {syncResult.linkedExisting > 0 && (
                    <div>绑定已有账号不改动其角色：若账号原无教师角色，登录后不可见业务模块，请在「用户管理」补充角色。</div>
                  )}
                </>
              }
            />
            {syncResult.skipped.length > 0 && (
              <Table
                size="small"
                rowKey="employeeNo"
                columns={[
                  { title: '工号', dataIndex: 'employeeNo', width: 130 },
                  { title: '姓名', dataIndex: 'displayName', width: 110 },
                  { title: '跳过原因', dataIndex: 'reason' },
                ]}
                dataSource={syncResult.skipped}
                pagination={false}
                scroll={{ y: 160 }}
              />
            )}
          </Space>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              以下人员的工号在导入/录入时尚未匹配到用户账号。同步将按「用户名=工号、姓名=录入姓名」自动创建账号
              （角色按辅导员/班主任、初始密码 Hzpt@工号、首登强制修改），并绑定对应班级；工号已有账号的只绑定班级。
            </Typography.Text>
            <Table
              size="small"
              rowKey={(r) => `${r.employeeNo}-${r.classId}-${r.roleType}`}
              columns={pendingColumns}
              dataSource={pendingList}
              pagination={false}
              scroll={{ y: 280 }}
              locale={{ emptyText: '暂无待同步人员' }}
            />
          </Space>
        )}
      </Modal>

      {/* 批量导入班级名单 */}
      <Modal
        title="批量导入班级名单"
        width={780}
        open={importOpen}
        onCancel={closeImport}
        footer={
          importDone
            ? [
                <Button key="again" onClick={resetImport}>
                  再次导入
                </Button>,
                <Button key="close" type="primary" onClick={closeImport}>
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={closeImport}>
                  取消
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  loading={importing}
                  disabled={!parsed || parsed.valid.length === 0}
                  onClick={confirmImport}
                >
                  {parsed ? `确认导入 ${parsed.valid.length} 个` : '确认导入'}
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="import-step">
            <div className="import-step-title">① 下载并填写模板</div>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={downloadClassTemplate}>
                下载 Excel 模板
              </Button>
              <Typography.Text type="secondary">
                年级须已在「年级管理」中创建；辅导员/班主任填工号+姓名，工号未匹配到用户账号时照常导入并记为待同步，
                可在「同步用户管理」一键建号
              </Typography.Text>
            </Space>
          </div>

          {!importDone && (
            <div className="import-step">
              <div className="import-step-title">② 上传填写好的 Excel</div>
              <Upload.Dragger
                accept=".xlsx,.xls"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  void handleImportFile(file);
                  return false; // 阻止自动上传，改为前端解析校验
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                <p className="ant-upload-hint">支持 .xlsx / .xls；先校验后导入，可预览失败明细</p>
              </Upload.Dragger>
            </div>
          )}

          {parsed && (
            <div className="import-step">
              <div className="import-step-title">{importDone ? '③ 导入结果' : '③ 校验结果'}</div>
              <Alert
                showIcon
                type={allFailures.length > 0 ? 'warning' : 'success'}
                message={
                  importDone
                    ? `处理完成：新增 ${importResult?.insertedCount ?? 0}、更新 ${importResult?.updatedCount ?? 0}、跳过 ${importResult?.skippedCount ?? 0} 个班级，待同步 ${importResult?.pendingCount ?? 0} 人次，失败 ${allFailures.length} 行。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 个，${parsed.failures.length} 行存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未处理，可导出失败明细修正后重新上传。'
                      : '全部数据处理成功；工号未匹配人员已记为待同步，可在「同步用户管理」一键建号。'
                    : allFailures.length > 0
                      ? '导入按「年级+班级名称」upsert：不存在则新建，已存在则按工号更新人员配置，完全相同自动跳过；可导出失败明细修正后重新上传。'
                      : undefined
                }
              />
              {allFailures.length > 0 && (
                <>
                  <Table
                    size="small"
                    rowKey="row"
                    style={{ marginTop: 12 }}
                    columns={[
                      { title: 'Excel 行号', dataIndex: 'row', width: 90 },
                      { title: '班级名称', dataIndex: 'name', width: 130 },
                      { title: '年级', dataIndex: 'grade', width: 100 },
                      { title: '失败原因', dataIndex: 'reason' },
                    ]}
                    dataSource={allFailures}
                    pagination={false}
                    scroll={{ y: 180 }}
                  />
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    style={{ marginTop: 12 }}
                    onClick={() => exportClassImportFailures(allFailures)}
                  >
                    导出失败明细
                  </Button>
                </>
              )}
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（班级/年级分段切换 + 卡片化），
 * 桌面端沿用本组件。
 */
export default function Classes() {
  const isMobile = useIsMobile();
  return isMobile ? <ClassesMobile /> : <ClassesDesktop />;
}

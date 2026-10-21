import { DownloadOutlined, InboxOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import { createClass, deleteClass, getClasses, getGradeOptions, importClasses, updateClass } from '@/api/classes';
import type { ClassQuery } from '@/api/classes';
import { getCounselorOptions } from '@/api/student';
import {
  confirmTeacherImport,
  exportTeachers,
  getTeachers,
  previewTeacherImport,
  updateTeacher,
} from '@/api/teachers';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { downloadClassTemplate, exportClassImportFailures, parseClassExcel, validateClassRows } from '@/utils/classImport';
import {
  downloadTeacherTemplate,
  exportTeacherImportFailures,
  parseTeacherExcel,
  validateTeacherRows,
  downloadTeacherExport,
} from '@/utils/teacherImport';
import type {
  ClassImportFailure,
  ClassImportResult,
  GradeOption,
  ParsedClassRow,
  ParsedTeacherRow,
  SchoolClass,
  Teacher,
  TeacherImportFailure,
  TeacherImportResult,
  TeacherRoleType,
  TeacherUpdateInput,
} from '@/types';
import ClassesMobile from './mobile';
import TeacherImportPanel from './TeacherImportPanel';

interface ClassFormValues {
  gradeId: number;
  name: string;
}

type Tab = 'classes' | 'teachers';

/** 班级管理（桌面端）：班级列表 + 教师名单（辅导员/班主任唯一来源） */
function ClassesDesktop() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ClassFormValues>();
  const [tab, setTab] = useState<Tab>('classes');

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

  /* ---------- 教师名单状态 ---------- */
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherKeyword, setTeacherKeyword] = useState('');
  const [teacherRole, setTeacherRole] = useState<TeacherRoleType | undefined>(undefined);
  const [teacherStatus, setTeacherStatus] = useState<'active' | 'leave' | undefined>(undefined);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherDetail, setTeacherDetail] = useState<Teacher | null>(null);
  const [teacherEdit, setTeacherEdit] = useState<Teacher | null>(null);
  const [teacherEditOpen, setTeacherEditOpen] = useState(false);
  const [teacherImportOpen, setTeacherImportOpen] = useState(false);
  const [teacherForm] = Form.useForm<TeacherUpdateInput>();
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);

  const openImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    if (importResult && importResult.successCount > 0) refresh();
  };

  const resetImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
  };

  /** 解析并校验上传的 Excel：字典类预检依赖每次上传时新鲜拉取（年级/在职辅导员/在职班主任）；
   *  已有班级不再预检拦截，由服务端按 upsert 处理 */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseClassExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const [gradeOpts, teachers] = await Promise.all([getGradeOptions(), getTeachers({ status: 'active' })]);
      const counselorNames = new Set(
        teachers.filter((t) => t.roleTypes.includes('counselor')).map((t) => t.name),
      );
      const headTeacherNames = new Set(
        teachers.filter((t) => t.roleTypes.includes('headTeacher')).map((t) => t.name),
      );
      const { valid, failures } = validateClassRows(rows, {
        gradeNames: new Set(gradeOpts.map((g) => g.name)),
        counselorNames,
        headTeacherNames,
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
      message.success(`新增 ${result.insertedCount}、更新 ${result.updatedCount}、跳过 ${result.skippedCount} 个班级`);
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 导入时被服务端二次驳回的记录，合并展示/导出 */
  const allFailures: ClassImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ gradeId: editing.gradeId, name: editing.name });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openEdit = (record: SchoolClass) => {
    setEditing(record);
    setModalOpen(true);
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
      if (editing) {
        await updateClass(editing.id, values);
        message.success('班级信息已更新');
      } else {
        await createClass(values);
        message.success('新增班级成功');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteClass(id);
      message.success('删除成功');
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, gradeId: undefined });
  };

  /* ---------- 教师名单 ---------- */
  const loadTeachers = async () => {
    setTeacherLoading(true);
    try {
      setTeachers(await getTeachers({ roleType: teacherRole, status: teacherStatus, keyword: teacherKeyword || undefined }));
    } finally {
      setTeacherLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'teachers') return;
    void loadTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const openTeacherEdit = (record: Teacher) => {
    setTeacherEdit(record);
    teacherForm.setFieldsValue({
      name: record.name,
      mobile: record.mobile || '',
      status: record.disabled ? 'leave' : 'active',
    });
    setTeacherEditOpen(true);
  };

  const handleTeacherSubmit = async () => {
    if (!teacherEdit) return;
    let values: TeacherUpdateInput;
    try {
      values = await teacherForm.validateFields();
    } catch {
      return;
    }
    setTeacherSubmitting(true);
    try {
      await updateTeacher(teacherEdit.id, values);
      message.success('教师信息已更新');
      setTeacherEditOpen(false);
      await loadTeachers();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setTeacherSubmitting(false);
    }
  };

  const teacherColumns: ColumnsType<Teacher> = [
    { title: '工号', dataIndex: 'employeeNo', width: 120 },
    { title: '姓名', dataIndex: 'name', width: 100 },
    {
      title: '人员类型',
      dataIndex: 'roleLabels',
      width: 140,
      render: (labels: string[]) => labels?.join('、') || '—',
    },
    { title: '手机号', dataIndex: 'mobile', width: 130, render: (v?: string) => v || '—' },
    {
      title: '所辖班级',
      dataIndex: 'classNames',
      ellipsis: true,
      render: (names: string[]) => (names?.length ? names.join('、') : '—'),
    },
    {
      title: '状态',
      dataIndex: 'disabled',
      width: 90,
      align: 'center',
      render: (disabled: boolean) => (disabled ? '离职' : '在职'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setTeacherDetail(record)}>
            查看
          </Button>
          <Button type="link" size="small" onClick={() => openTeacherEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={record.disabled ? '确定复职该教师吗？' : '确定将该教师标记为离职吗？'}
            description={
              record.disabled
                ? '复职后会重新启用账号，但带班关系需手动在编辑中补充'
                : '离职将停用账号并回收全部带班与教师角色，账号与历史记录仍保留'
            }
            onConfirm={() => handleTeacherToggle(record)}
          >
            <Button type="link" size="small" danger={!record.disabled}>
              {record.disabled ? '复职' : '离职'}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleTeacherToggle = async (record: Teacher) => {
    try {
      await updateTeacher(record.id, { status: record.disabled ? 'active' : 'leave' });
      message.success(record.disabled ? '已复职' : '已办理离职');
      await loadTeachers();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const classColumns: ColumnsType<SchoolClass> = [
    { title: '班级名称', dataIndex: 'name', width: 150 },
    { title: '所属年级', dataIndex: 'gradeName', width: 110 },
    { title: '学生数', dataIndex: 'studentCount', width: 90, align: 'center' },
    {
      title: '所辖辅导员',
      dataIndex: 'counselorNames',
      ellipsis: true,
      render: (value?: string) => value || '—',
    },
    {
      title: '班主任',
      dataIndex: 'headTeacherNames',
      ellipsis: true,
      render: (value?: string) => value || '—',
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
            description="班级与辅导员/班主任的关联将一并移除；班级下仍有学生时无法删除"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="班级管理"
        subtitle="维护班级基础信息与所属年级，并作为辅导员、班主任数据的唯一来源（学生名册按班级自动派生）"
      />

      <Segmented
        style={{ marginBottom: 12 }}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { label: '班级列表', value: 'classes' },
          { label: '教师名单', value: 'teachers' },
        ]}
      />

      {tab === 'classes' ? (
        <>
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
        </>
      ) : (
        <>
          <div className="toolbar">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
              placeholder="搜索工号 / 姓名 / 手机号"
              style={{ width: 220 }}
              value={teacherKeyword}
              onChange={(e) => setTeacherKeyword(e.target.value)}
              onPressEnter={() => void loadTeachers()}
            />
            <Select
              placeholder="人员类型"
              allowClear
              style={{ minWidth: 120 }}
              options={[
                { value: 'counselor', label: '辅导员' },
                { value: 'headTeacher', label: '班主任' },
              ]}
              value={teacherRole}
              onChange={(v) => setTeacherRole(v)}
            />
            <Select
              placeholder="在职状态"
              allowClear
              style={{ minWidth: 110 }}
              options={[
                { value: 'active', label: '在职' },
                { value: 'leave', label: '离职' },
              ]}
              value={teacherStatus}
              onChange={(v) => setTeacherStatus(v)}
            />
            <Button icon={<SearchOutlined />} onClick={() => void loadTeachers()}>
              查询
            </Button>
            <Button
              icon={<RedoOutlined />}
              onClick={() => {
                setTeacherKeyword('');
                setTeacherRole(undefined);
                setTeacherStatus(undefined);
                void loadTeachers();
              }}
            >
              重置
            </Button>
            <div className="toolbar-spacer" />
            <Button
              icon={<DownloadOutlined />}
              onClick={async () => {
                const list = await exportTeachers({ roleType: teacherRole, status: teacherStatus, keyword: teacherKeyword || undefined });
                downloadTeacherExport(list);
              }}
            >
              导出名单
            </Button>
            <Button icon={<DownloadOutlined />} onClick={downloadTeacherTemplate}>
              下载模板
            </Button>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setTeacherImportOpen(true)}>
              批量导入
            </Button>
          </div>

          <Table
            rowKey="id"
            columns={teacherColumns}
            dataSource={teachers}
            loading={teacherLoading}
            pagination={false}
            locale={{ emptyText: '暂无教师数据，可下载模板后批量导入' }}
          />
        </>
      )}

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
        </Form>
      </Modal>

      {/* 教师名单批量导入（预览 → 确认两段式，见 TeacherImportPanel） */}
      <TeacherImportPanel
        open={teacherImportOpen}
        onClose={() => setTeacherImportOpen(false)}
        onDone={() => {
          void loadTeachers();
          refresh();
        }}
      />

      {/* 教师详情 */}
      <Modal
        title="教师详情"
        open={!!teacherDetail}
        onCancel={() => setTeacherDetail(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setTeacherDetail(null)}>
            关闭
          </Button>,
        ]}
      >
        {teacherDetail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="工号">{teacherDetail.employeeNo}</Descriptions.Item>
            <Descriptions.Item label="姓名">{teacherDetail.name}</Descriptions.Item>
            <Descriptions.Item label="手机号">{teacherDetail.mobile || '—'}</Descriptions.Item>
            <Descriptions.Item label="人员类型">{teacherDetail.roleLabels.join('、') || '—'}</Descriptions.Item>
            <Descriptions.Item label="所辖班级">
              {teacherDetail.classNames.length ? teacherDetail.classNames.join('、') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="在职状态">{teacherDetail.disabled ? '离职' : '在职'}</Descriptions.Item>
            <Descriptions.Item label="账号角色">{teacherDetail.allRoleKeys.join('、') || '—'}</Descriptions.Item>
            <Descriptions.Item label="档案来源">
              {teacherDetail.teacherSource === 'import' ? '批量导入' : '用户管理手工创建'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 教师编辑（单条维护） */}
      <Modal
        title={`编辑教师 · ${teacherEdit?.name ?? ''}`}
        open={teacherEditOpen}
        confirmLoading={teacherSubmitting}
        onOk={handleTeacherSubmit}
        onCancel={() => setTeacherEditOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={teacherForm} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="mobile" label="手机号">
            <Input placeholder="11 位手机号" maxLength={11} />
          </Form.Item>
          <Form.Item name="status" label="在职状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'active', label: '在职' },
                { value: 'leave', label: '离职（停用账号并回收带班与角色）' },
              ]}
            />
          </Form.Item>
          <Typography.Text type="secondary">
            带班关系请在「教师名单」批量导入中维护（以工号为唯一键 upsert），或直接编辑对应班级。
          </Typography.Text>
        </Form>
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
                年级须已在「年级管理」中创建；辅导员/班主任须先在「教师名单」导入（教师数据唯一来源）
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
                    ? `处理完成：新增 ${importResult?.insertedCount ?? 0}、更新 ${importResult?.updatedCount ?? 0}、跳过 ${importResult?.skippedCount ?? 0} 个班级，失败 ${allFailures.length} 行。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 个，${parsed.failures.length} 行存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未处理，可导出失败明细修正后重新上传。'
                      : '全部数据处理成功（新增/更新/跳过）。'
                    : allFailures.length > 0
                      ? '导入按「年级+班级名称」upsert：不存在则新建，已存在则按身份更新人员分配，完全相同自动跳过；可导出失败明细修正后重新上传。'
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
 * 视口分发：≤768px 走移动端独立渲染层（班级/教师分段切换 + 卡片化），
 * 桌面端沿用本组件。
 */
export default function Classes() {
  const isMobile = useIsMobile();
  return isMobile ? <ClassesMobile /> : <ClassesDesktop />;
}

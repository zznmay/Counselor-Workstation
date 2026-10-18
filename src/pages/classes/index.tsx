import { DownloadOutlined, InboxOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import { createClass, deleteClass, getClasses, getClassOptions, getGradeOptions, importClasses, updateClass } from '@/api/classes';
import type { ClassQuery } from '@/api/classes';
import { getCounselorOptions } from '@/api/student';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { downloadClassTemplate, exportClassImportFailures, parseClassExcel, validateClassRows } from '@/utils/classImport';
import type { ClassImportFailure, ClassImportResult, GradeOption, ParsedClassRow, SchoolClass } from '@/types';
import ClassesMobile from './mobile';

interface ClassFormValues {
  gradeId: number;
  name: string;
}

/** 班级管理（桌面端）：列表 / 关键字与年级筛选 / 新增 / 编辑 / 删除 */
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

  /* ---------- 批量导入状态 ---------- */
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

  /** 解析并校验上传的 Excel：字典类预检依赖每次上传时新鲜拉取（年级/已有班级/在职辅导员） */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseClassExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const [classOpts, gradeOpts, counselors] = await Promise.all([
        getClassOptions(),
        getGradeOptions(),
        getCounselorOptions(),
      ]);
      const { valid, failures } = validateClassRows(rows, {
        classKeys: new Set(classOpts.map((c) => `${c.gradeName}|${c.name}`)),
        gradeNames: new Set(gradeOpts.map((g) => g.name)),
        counselorNames: new Set(counselors.map((c) => c.name)),
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
      message.success(`成功导入 ${result.successCount} 个班级`);
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
      // 后端约束（班级下仍有学生等）以 400 message 返回，直接展示
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, gradeId: undefined });
  };

  const columns: ColumnsType<SchoolClass> = [
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
            description="班级与辅导员的关联将一并移除；班级下仍有学生时无法删除"
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
        subtitle="维护班级基础信息与所属年级，为辅导员分班与学生归属提供数据支撑"
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
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 760 }}
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
                年级须已在「年级管理」中创建；辅导员为在职辅导员姓名，可留空、多人用「、」分隔
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
                    ? `成功导入 ${importResult?.successCount ?? 0} 个班级，失败 ${allFailures.length} 行。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 个，${parsed.failures.length} 行存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未导入，可导出失败明细修正后重新上传。'
                      : '全部数据均导入成功。'
                    : allFailures.length > 0
                      ? '导入采用追加方式：失败行跳过不导入，成功行正常写入，不影响已有班级；可导出失败明细修正后重新上传。'
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

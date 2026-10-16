import { CommentOutlined, DownloadOutlined, InboxOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';

import {
  createStudent,
  deleteStudent,
  getExistingStudentNos,
  getStudents,
  importStudents,
  updateStudent,
} from '@/api/student';
import { createConversation } from '@/api/conversation';
import ConversationFormFields, {
  conversationFormToInput,
} from '@/components/ConversationFormFields';
import type { ConversationFormValues } from '@/components/ConversationFormFields';
import PageHeader from '@/components/PageHeader';
import {
  GENDERS,
  GRADES,
  MAJORS,
  POLITICAL_STATUSES,
  STUDENT_STATUSES,
  STUDENT_STATUS_COLOR,
  toOptions,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import {
  downloadStudentTemplate,
  exportImportFailures,
  parseStudentExcel,
  validateStudentRows,
} from '@/utils/studentImport';
import type {
  Gender,
  ParsedStudentRow,
  Student,
  StudentImportFailure,
  StudentImportResult,
  StudentQuery,
  StudentStatus,
} from '@/types';
import StudentsMobile from './mobile';

interface StudentFormValues {
  studentNo: string;
  name: string;
  gender: Gender;
  grade: string;
  major: string;
  className: string;
  phone: string;
  dorm?: string;
  politicalStatus?: string;
  origin?: string;
  status: StudentStatus;
  headTeacher?: string;
  counselor?: string;
  fatherName?: string;
  fatherPhone?: string;
  motherName?: string;
  motherPhone?: string;
  position?: string;
  remark?: string;
  enrollDate: Dayjs;
}

/** 学生信息管理：列表 / 筛选搜索 / 新增 / 编辑 / 删除 / 详情 */
function StudentsDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [form] = Form.useForm<StudentFormValues>();

  const { query, patchQuery, data, loading, refresh } = useList<Student, StudentQuery>(getStudents, {
    page: 1,
    pageSize: 10,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [editing, setEditing] = useState<Student | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Student | null>(null);

  /* ---------- 记录谈话（联动谈心谈话模块） ---------- */
  const [talkForm] = Form.useForm<ConversationFormValues>();
  const [talkTarget, setTalkTarget] = useState<Student | null>(null);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkSubmitting, setTalkSubmitting] = useState(false);

  useEffect(() => {
    if (talkOpen) {
      talkForm.setFieldsValue({
        talkTime: dayjs(),
        way: '面对面',
        type: '学业指导',
        needFollowUp: false,
      });
    }
  }, [talkOpen, talkForm]);

  const openTalk = (record: Student) => {
    setTalkTarget(record);
    setTalkOpen(true);
  };

  /** 保存后写入谈心谈话模块共用的数据源，实现模块联动 */
  const handleTalkSubmit = async () => {
    if (!talkTarget) return;
    let values: ConversationFormValues;
    try {
      values = await talkForm.validateFields();
    } catch {
      return;
    }
    setTalkSubmitting(true);
    try {
      await createConversation(conversationFormToInput(values, talkTarget.id));
      message.success(`已记录与${talkTarget.name}的谈话，并同步至谈心谈话模块`);
      setTalkOpen(false);
    } finally {
      setTalkSubmitting(false);
    }
  };

  /* ---------- 批量导入状态 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<{
    fileName: string;
    totalRows: number;
    valid: ParsedStudentRow[];
    failures: StudentImportFailure[];
  } | null>(null);
  const [importResult, setImportResult] = useState<StudentImportResult | null>(null);

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

  /** 解析并校验上传的 Excel（仅本地预检，真正导入时 API 还会按库内数据二次查重） */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseStudentExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const existingNos = await getExistingStudentNos();
      const { valid, failures } = validateStudentRows(rows, existingNos);
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
      const result = await importStudents(parsed.valid);
      setImportResult(result);
      setImportDone(true);
      message.success(`成功导入 ${result.successCount} 名学生`);
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 导入时被二次校验驳回的记录，合并展示/导出 */
  const allFailures: StudentImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ ...editing, enrollDate: dayjs(editing.enrollDate) });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Student) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: StudentFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败，表单内已提示
    }
    setSubmitting(true);
    try {
      const payload = { ...values, enrollDate: values.enrollDate.format('YYYY-MM-DD') };
      if (editing) {
        await updateStudent(editing.id, payload);
        message.success('学生信息已更新');
      } else {
        await createStudent(payload);
        message.success('新增学生成功');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteStudent(id);
    message.success('删除成功');
    refresh();
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, grade: undefined, major: undefined, status: undefined });
  };

  const columns: ColumnsType<Student> = [
    { title: '学号', dataIndex: 'studentNo', width: 110 },
    {
      title: '姓名',
      dataIndex: 'name',
      width: 90,
      render: (value: string, record) => <a onClick={() => setDetail(record)}>{value}</a>,
    },
    { title: '性别', dataIndex: 'gender', width: 70 },
    { title: '年级', dataIndex: 'grade', width: 90 },
    { title: '专业', dataIndex: 'major', width: 150, ellipsis: true },
    { title: '班级', dataIndex: 'className', width: 100 },
    { title: '手机号', dataIndex: 'phone', width: 125 },
    { title: '宿舍', dataIndex: 'dorm', width: 130, ellipsis: true },
    {
      title: '学籍状态',
      dataIndex: 'status',
      width: 90,
      render: (status: StudentStatus) => <Tag color={STUDENT_STATUS_COLOR[status]}>{status}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 245,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<CommentOutlined />} onClick={() => openTalk(record)}>
            记录谈话
          </Button>
          <Button type="link" size="small" onClick={() => setDetail(record)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该学生吗？"
            description="删除后不可恢复"
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
        title="学生信息管理"
        subtitle="所带班级学生的基础信息、学籍状态与重点关注事项"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索姓名 / 学号 / 班级 / 手机号"
          style={{ width: isMobile ? '100%' : 250 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="年级"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(GRADES)}
          value={query.grade}
          onChange={(grade) => patchQuery({ grade })}
        />
        <Select
          placeholder="专业"
          allowClear
          style={{ minWidth: 150 }}
          options={toOptions(MAJORS)}
          value={query.major}
          onChange={(major) => patchQuery({ major })}
        />
        <Select
          placeholder="学籍状态"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(STUDENT_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Button icon={<UploadOutlined />} onClick={openImport}>
          批量导入
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增学生
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1240 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 名学生`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 学生详情抽屉 */}
      <Drawer
        title="学生详情"
        width={isMobile ? '100%' : 560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              size="small"
              column={isMobile ? 1 : 2}
              labelStyle={{ width: 96 }}
            >
            <Descriptions.Item label="学号">{detail.studentNo}</Descriptions.Item>
            <Descriptions.Item label="姓名">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="性别">{detail.gender}</Descriptions.Item>
            <Descriptions.Item label="年级">{detail.grade}</Descriptions.Item>
            <Descriptions.Item label="专业" span={2}>
              {detail.major}
            </Descriptions.Item>
            <Descriptions.Item label="班级">{detail.className}</Descriptions.Item>
            <Descriptions.Item label="职务">{detail.position ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="手机号">{detail.phone}</Descriptions.Item>
            <Descriptions.Item label="宿舍">{detail.dorm ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="政治面貌">{detail.politicalStatus ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="生源地">{detail.origin ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="入学时间">{detail.enrollDate}</Descriptions.Item>
            <Descriptions.Item label="学籍状态">
              <Tag color={STUDENT_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="班主任">{detail.headTeacher ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="辅导员">{detail.counselor ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {detail.remark ?? '—'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ fontWeight: 600, margin: '20px 0 12px', color: 'var(--app-ink)' }}>
            家庭联系信息
          </div>
          <Descriptions
            bordered
            size="small"
            column={isMobile ? 1 : 2}
            labelStyle={{ width: 96 }}
          >
            <Descriptions.Item label="父亲姓名">{detail.fatherName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="父亲电话">{detail.fatherPhone ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="母亲姓名">{detail.motherName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="母亲电话">{detail.motherPhone ?? '—'}</Descriptions.Item>
          </Descriptions>
          </>
        )}
      </Drawer>

      {/* 新增 / 编辑学生 */}
      <Modal
        title={editing ? '编辑学生' : '新增学生'}
        width={isMobile ? 'calc(100vw - 24px)' : 680}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            gender: '男',
            status: '在读',
            grade: '2026级',
            major: MAJORS[0],
            counselor: '王老师',
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="studentNo"
                label="学号"
                rules={[{ required: true, message: '请输入学号' }]}
              >
                <Input placeholder="如 2026010101" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input placeholder="学生姓名" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="gender" label="性别" rules={[{ required: true }]}>
                <Radio.Group options={toOptions(GENDERS)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="phone"
                label="手机号"
                rules={[
                  { required: true, message: '请输入手机号' },
                  { pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' },
                ]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="grade" label="年级" rules={[{ required: true, message: '请选择年级' }]}>
                <Select options={toOptions(GRADES)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="major" label="专业" rules={[{ required: true, message: '请选择专业' }]}>
                <Select options={toOptions(MAJORS)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="className"
                label="班级"
                rules={[{ required: true, message: '请输入班级' }]}
              >
                <Input placeholder="如 计应2601" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="学籍状态" rules={[{ required: true }]}>
                <Select options={toOptions(STUDENT_STATUSES)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="dorm" label="宿舍">
                <Input placeholder="如 学生公寓5-602" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="politicalStatus" label="政治面貌">
                <Select options={toOptions(POLITICAL_STATUSES)} allowClear placeholder="请选择" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="origin" label="生源地">
                <Input placeholder="如 浙江杭州" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="enrollDate"
                label="入学时间"
                rules={[{ required: true, message: '请选择入学时间' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="position" label="班内职务">
                <Input placeholder="如 班长 / 学习委员" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="家庭情况、重点关注事项等" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div className="form-section-title">班级与家庭联系</div>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="headTeacher" label="班主任">
                <Input placeholder="如 李国强" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="counselor" label="辅导员">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="fatherName" label="父亲姓名">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="fatherPhone"
                label="父亲电话"
                rules={[{ pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' }]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="motherName" label="母亲姓名">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="motherPhone"
                label="母亲电话"
                rules={[{ pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' }]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      {/* 批量导入学生名单 */}
      <Modal
        title="批量导入学生名单"
        width={isMobile ? 'calc(100vw - 24px)' : 780}
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
                  {parsed ? `确认导入 ${parsed.valid.length} 条` : '确认导入'}
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="import-step">
            <div className="import-step-title">① 下载并填写模板</div>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={downloadStudentTemplate}>
                下载 Excel 模板
              </Button>
              <Typography.Text type="secondary">
                模板包含全部字段、示例行与填写说明（「填写说明」工作表）
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
                    ? `成功导入 ${importResult?.successCount ?? 0} 名学生，名单已追加，现有数据不受影响。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 条，${parsed.failures.length} 条存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未导入，可导出失败明细修正后重新上传。'
                      : '全部数据均导入成功。'
                    : allFailures.length > 0
                      ? '导入采用追加方式，仅写入通过校验的行；可导出失败明细修正后重新上传。'
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
                      { title: '学号', dataIndex: 'studentNo', width: 120 },
                      { title: '姓名', dataIndex: 'name', width: 90 },
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
                    onClick={() => exportImportFailures(allFailures)}
                  >
                    导出失败明细
                  </Button>
                </>
              )}
            </div>
          )}
        </Space>
      </Modal>
      {/* 记录谈话：写入谈心谈话模块共用的数据源 */}
      <Modal
        title={`记录谈话 · ${talkTarget?.name ?? ''}`}
        width={isMobile ? 'calc(100vw - 24px)' : 620}
        open={talkOpen}
        confirmLoading={talkSubmitting}
        onOk={handleTalkSubmit}
        onCancel={() => setTalkOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        {talkTarget && (
          <div className="talk-target">
            <span className="student-chip">{talkTarget.name.charAt(0)}</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--app-ink)' }}>{talkTarget.name}</div>
              <div style={{ fontSize: 12, color: '#7686a8' }}>
                {talkTarget.className} · {talkTarget.studentNo}
              </div>
            </div>
            <Tag color="blue" style={{ marginLeft: 'auto' }}>
              保存后同步至谈心谈话模块
            </Tag>
          </div>
        )}
        <Form form={talkForm} layout="vertical">
          <ConversationFormFields />
        </Form>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 触控优化），
 * 桌面端沿用原组件，桌面样式与行为零改动。
 */
export default function Students() {
  const isMobile = useIsMobile();
  return isMobile ? <StudentsMobile /> : <StudentsDesktop />;
}

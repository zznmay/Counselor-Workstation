import { PlusOutlined, RedoOutlined, SearchOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import { getStudentOptions } from '@/api/student';
import {
  approveApproval,
  createApproval,
  deleteApproval,
  getApprovals,
  updateApproval,
} from '@/api/approval';
import PageHeader from '@/components/PageHeader';
import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_COLOR,
  APPROVAL_TYPES,
  APPROVAL_TYPE_COLOR,
  toOptions,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import type {
  Approval,
  ApprovalInput,
  ApprovalQuery,
  ApprovalStatus,
  ApprovalType,
  StudentOption,
} from '@/types';

interface ApprovalFormValues {
  type: ApprovalType;
  studentId: string;
  summary: string;
  detail?: string;
}

/** 审批中心：待办审批处理（通过/驳回）、申请登记、筛选搜索与详情查看 */
export default function Approvals() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [form] = Form.useForm<ApprovalFormValues>();
  const [auditForm] = Form.useForm<{ comment?: string }>();

  const { query, patchQuery, data, loading, refresh } = useList<Approval, ApprovalQuery>(
    getApprovals,
    { page: 1, pageSize: 10 },
  );

  const [keywordInput, setKeywordInput] = useState('');
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [editing, setEditing] = useState<Approval | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Approval | null>(null);
  const [audit, setAudit] = useState<{ record: Approval; result: '已通过' | '已驳回' } | null>(null);

  useEffect(() => {
    getStudentOptions().then(setStudentOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue(editing);
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Approval) => {
    setEditing(record);
    setModalOpen(true);
  };

  const openAudit = (record: Approval, result: '已通过' | '已驳回') => {
    auditForm.resetFields();
    setAudit({ record, result });
  };

  const handleSubmit = async () => {
    let values: ApprovalFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload: ApprovalInput = values;
      if (editing) {
        await updateApproval(editing.id, payload);
        message.success('申请信息已更新');
      } else {
        await createApproval(payload);
        message.success('申请已登记');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleAudit = async () => {
    if (!audit) return;
    const { comment } = await auditForm.validateFields();
    await approveApproval(audit.record.id, audit.result, comment ?? '');
    message.success(`已${audit.result === '已通过' ? '同意' : '驳回'}${audit.record.studentName}的申请`);
    setAudit(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteApproval(id);
    message.success('删除成功');
    refresh();
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, type: undefined, status: undefined });
  };

  const columns: ColumnsType<Approval> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (type: ApprovalType) => <Tag color={APPROVAL_TYPE_COLOR[type]}>{type}</Tag>,
    },
    {
      title: '申请人',
      dataIndex: 'studentName',
      width: 150,
      render: (_, record) => (
        <div>
          <a onClick={() => setDetail(record)} style={{ fontWeight: 500 }}>
            {record.studentName}
          </a>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            {record.className} · {record.studentNo}
          </div>
        </div>
      ),
    },
    { title: '申请事由', dataIndex: 'summary', ellipsis: true },
    { title: '提交时间', dataIndex: 'submittedAt', width: 140 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: ApprovalStatus) => <Tag color={APPROVAL_STATUS_COLOR[status]}>{status}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 230,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          {record.status === '待审批' ? (
            <>
              <Button type="link" size="small" onClick={() => openAudit(record, '已通过')}>
                通过
              </Button>
              <Button type="link" size="small" danger onClick={() => openAudit(record, '已驳回')}>
                驳回
              </Button>
            </>
          ) : (
            <Button type="link" size="small" onClick={() => setDetail(record)}>
              详情
            </Button>
          )}
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该条审批记录吗？" onConfirm={() => handleDelete(record.id)}>
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
        title="审批中心"
        subtitle="学生请假、资助、活动等申请的审批处理与记录查询"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索学生 / 班级 / 事由"
          style={{ width: isMobile ? '100%' : 230 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="申请类型"
          allowClear
          style={{ minWidth: 130 }}
          options={toOptions(APPROVAL_TYPES)}
          value={query.type}
          onChange={(type) => patchQuery({ type })}
        />
        <Select
          placeholder="审批状态"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(APPROVAL_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          登记申请
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条申请`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="审批详情"
        width={isMobile ? '100%' : 560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
              <Descriptions.Item label="申请类型">
                <Tag color={APPROVAL_TYPE_COLOR[detail.type]}>{detail.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={APPROVAL_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请人" span={2}>
                {detail.studentName}（{detail.className} · {detail.studentNo}）
              </Descriptions.Item>
              <Descriptions.Item label="提交时间">{detail.submittedAt}</Descriptions.Item>
              <Descriptions.Item label="审批时间">{detail.approvedAt ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="申请事由" span={2}>
                {detail.summary}
              </Descriptions.Item>
              <Descriptions.Item label="补充说明" span={2}>
                {detail.detail ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="审批意见" span={2}>
                {detail.comment ?? '尚未审批'}
              </Descriptions.Item>
            </Descriptions>
            {detail.status === '待审批' && (
              <Space>
                <Button type="primary" onClick={() => openAudit(detail, '已通过')}>
                  通过
                </Button>
                <Button danger onClick={() => openAudit(detail, '已驳回')}>
                  驳回
                </Button>
              </Space>
            )}
          </Space>
        )}
      </Drawer>

      {/* 登记申请 / 编辑申请 */}
      <Modal
        title={editing ? '编辑申请' : '登记申请（代学生提交）'}
        width={isMobile ? 'calc(100vw - 24px)' : 580}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ type: '学生请假' }}>
          <Space size={16} wrap style={{ display: 'flex' }}>
            <Form.Item name="type" label="申请类型" rules={[{ required: true }]}>
              <Select options={toOptions(APPROVAL_TYPES)} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item
              name="studentId"
              label="申请学生"
              rules={[{ required: true, message: '请选择学生' }]}
            >
              <Select
                showSearch
                placeholder="输入姓名或学号搜索"
                optionFilterProp="label"
                style={{ width: 240 }}
                options={studentOptions.map((s) => ({
                  value: s.id,
                  label: `${s.name}（${s.className} · ${s.studentNo}）`,
                }))}
              />
            </Form.Item>
          </Space>
          <Form.Item
            name="summary"
            label="申请事由"
            rules={[{ required: true, message: '请填写申请事由' }]}
          >
            <Input.TextArea rows={3} placeholder="如：因感冒发烧申请病假2天，已提供校医院证明" />
          </Form.Item>
          <Form.Item name="detail" label="补充说明">
            <Input.TextArea rows={2} placeholder="佐证材料、时间地点等补充信息（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 审批（通过 / 驳回）弹窗 */}
      <Modal
        title={audit?.result === '已通过' ? '通过审批' : '驳回申请'}
        open={!!audit}
        confirmLoading={submitting}
        onOk={handleAudit}
        onCancel={() => setAudit(null)}
        okText={audit?.result}
        okButtonProps={audit?.result === '已驳回' ? { danger: true } : undefined}
        cancelText="取消"
      >
        {audit && (
          <Form form={auditForm} layout="vertical">
            <div style={{ marginBottom: 12, color: 'rgba(0,0,0,0.65)' }}>
              {audit.record.studentName}（{audit.record.className}）申请{audit.record.type}：
              {audit.record.summary}
            </div>
            <Form.Item name="comment" label="审批意见">
              <Input.TextArea
                rows={3}
                placeholder={audit.result === '已通过' ? '选填，如：材料齐全，同意' : '建议填写驳回原因'}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}

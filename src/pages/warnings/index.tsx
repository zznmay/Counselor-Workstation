import { PlusOutlined, RedoOutlined, SearchOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  DatePicker,
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
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { createWarning, deleteWarning, getWarnings, updateWarning } from '@/api/warning';
import PageHeader from '@/components/PageHeader';
import { useStudentOptions } from '@/hooks/useStudentOptions';
import {
  toOptions,
  WARNING_LEVELS,
  WARNING_LEVEL_COLOR,
  WARNING_STATUSES,
  WARNING_STATUS_COLOR,
  WARNING_TYPES,
  WARNING_TYPE_COLOR,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canAction } from '@/lib/auth';
import { useList } from '@/hooks/useList';
import type {
  StudentOption,
  Warning,
  WarningInput,
  WarningLevel,
  WarningQuery,
  WarningStatus,
  WarningType,
} from '@/types';
import WarningsMobile from './mobile';

interface WarningFormValues {
  studentId: string;
  type: WarningType;
  level: WarningLevel;
  reason: string;
  status: WarningStatus;
  raisedAt: Dayjs;
  handleNote?: string;
}

/** 学业与心理预警：列表 / 筛选搜索 / 录入 / 编辑 / 删除 / 详情与处理 */
function WarningsDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const authUser = useAuthUser();
  const [form] = Form.useForm<WarningFormValues>();
  const [searchParams] = useSearchParams();

  const { query, patchQuery, data, loading, refresh } = useList<Warning, WarningQuery>(getWarnings, {
    page: 1,
    pageSize: 10,
    status: (searchParams.get('status') as WarningStatus) || undefined,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [editing, setEditing] = useState<Warning | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Warning | null>(null);
  const [pickedStudent, setPickedStudent] = useState<StudentOption | null>(null);

  /* 表单学生下拉：打开弹窗时按需搜索，编辑对象始终置顶回显 */
  const {
    options: studentOptions,
    loading: studentOptionsLoading,
    search: searchStudents,
    handlePopupScroll,
  } = useStudentOptions({ enabled: modalOpen, manageableOnly: true, selected: pickedStudent });

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ ...editing, raisedAt: dayjs(editing.raisedAt) });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setPickedStudent(null);
    searchStudents('');
    setModalOpen(true);
  };

  const openEdit = (record: Warning) => {
    setEditing(record);
    searchStudents('');
    setPickedStudent({
      id: record.studentId,
      name: record.studentName,
      studentNo: record.studentNo,
      className: record.className,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: WarningFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload: WarningInput = { ...values, raisedAt: values.raisedAt.format('YYYY-MM-DD HH:mm') };
      if (editing) {
        await updateWarning(editing.id, payload);
        message.success('预警信息已更新');
      } else {
        await createWarning(payload);
        message.success('预警已录入');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteWarning(id);
    message.success('删除成功');
    refresh();
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, type: undefined, level: undefined, status: undefined });
  };

  const columns: ColumnsType<Warning> = [
    {
      title: '学生',
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
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (type: WarningType) => <Tag color={WARNING_TYPE_COLOR[type]}>{type}</Tag>,
    },
    {
      title: '等级',
      dataIndex: 'level',
      width: 90,
      render: (level: WarningLevel) => <Tag color={WARNING_LEVEL_COLOR[level]}>{level}</Tag>,
    },
    { title: '预警原因', dataIndex: 'reason', ellipsis: true },
    { title: '预警时间', dataIndex: 'raisedAt', width: 140 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: WarningStatus) => <Tag color={WARNING_STATUS_COLOR[status]}>{status}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setDetail(record)}>
            详情
          </Button>
          {/* 待处理行的「处理」按 resolve 权限显隐，其余按 edit；同一弹窗承载两种流转 */}
          {canAction(authUser, 'warnings', record.status === '待处理' ? 'resolve' : 'edit') && (
            <Button type="link" size="small" onClick={() => openEdit(record)}>
              {record.status === '待处理' ? '处理' : '编辑'}
            </Button>
          )}
          {canAction(authUser, 'warnings', 'delete') && (
            <Popconfirm title="确定删除该条预警吗？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="学业与心理预警"
        subtitle="预警信息接收、处理措施记录与销号闭环管理"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索学生 / 班级 / 预警原因"
          style={{ width: isMobile ? '100%' : 230 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="预警类型"
          allowClear
          style={{ minWidth: 130 }}
          options={toOptions(WARNING_TYPES)}
          value={query.type}
          onChange={(type) => patchQuery({ type })}
        />
        <Select
          placeholder="预警等级"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(WARNING_LEVELS)}
          value={query.level}
          onChange={(level) => patchQuery({ level })}
        />
        <Select
          placeholder="处理状态"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(WARNING_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        {canAction(authUser, 'warnings', 'create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            录入预警
          </Button>
        )}
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1050 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条预警`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="预警详情"
        width={isMobile ? '100%' : 560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
              <Descriptions.Item label="学生" span={2}>
                {detail.studentName}（{detail.className} · {detail.studentNo}）
              </Descriptions.Item>
              <Descriptions.Item label="预警类型">
                <Tag color={WARNING_TYPE_COLOR[detail.type]}>{detail.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预警等级">
                <Tag color={WARNING_LEVEL_COLOR[detail.level]}>{detail.level}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预警时间">{detail.raisedAt}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={WARNING_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预警原因" span={2}>
                {detail.reason}
              </Descriptions.Item>
              <Descriptions.Item label="处理措施" span={2}>
                {detail.handleNote ?? '尚未处理'}
              </Descriptions.Item>
              <Descriptions.Item label="处理时间" span={2}>
                {detail.handledAt ?? '—'}
              </Descriptions.Item>
            </Descriptions>
            {detail.status !== '已解除'
              && canAction(authUser, 'warnings', detail.status === '待处理' ? 'resolve' : 'edit') && (
              <Button
                type="primary"
                onClick={() => {
                  setDetail(null);
                  openEdit(detail);
                }}
              >
                {detail.status === '待处理' ? '立即处理' : '更新处理进展'}
              </Button>
            )}
          </Space>
        )}
      </Drawer>

      {/* 录入 / 编辑（处理）预警 */}
      <Modal
        title={
          editing
            ? editing.status === '待处理'
              ? `处理预警 · ${editing.studentName}`
              : `编辑预警 · ${editing.studentName}`
            : '录入预警'
        }
        width={isMobile ? 'calc(100vw - 24px)' : 600}
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
          initialValues={{ status: '待处理', level: '黄色', type: '学业预警', raisedAt: dayjs() }}
        >
          <Form.Item
            name="studentId"
            label="学生"
            rules={[{ required: true, message: '请选择学生' }]}
          >
            <Select
              showSearch
              filterOption={false}
              onSearch={searchStudents}
              onPopupScroll={handlePopupScroll}
              loading={studentOptionsLoading}
              placeholder="输入姓名或学号搜索"
              onChange={(value) => {
                setPickedStudent(studentOptions.find((s) => s.id === value) ?? null);
              }}
              options={studentOptions.map((s) => ({
                value: s.id,
                label: `${s.name}（${s.className} · ${s.studentNo}）`,
              }))}
            />
          </Form.Item>
          <Space size={16} wrap style={{ display: 'flex' }}>
            <Form.Item name="type" label="预警类型" rules={[{ required: true }]}>
              <Select options={toOptions(WARNING_TYPES)} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="level" label="预警等级" rules={[{ required: true }]}>
              <Select options={toOptions(WARNING_LEVELS)} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="status" label="处理状态" rules={[{ required: true }]}>
              <Select options={toOptions(WARNING_STATUSES)} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item
              name="raisedAt"
              label="预警时间"
              rules={[{ required: true, message: '请选择预警时间' }]}
            >
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="reason"
            label="预警原因"
            rules={[{ required: true, message: '请填写预警原因' }]}
          >
            <Input.TextArea rows={3} placeholder="如：不及格学分情况、心理测评结果、行为表现等" />
          </Form.Item>
          <Form.Item name="handleNote" label="处理措施">
            <Input.TextArea
              rows={3}
              placeholder="约谈情况、帮扶安排、家长沟通、销号依据等；状态置为「已解除」时必填"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 触控优化），
 * 桌面端沿用原组件，桌面样式与行为零改动。
 */
export default function Warnings() {
  const isMobile = useIsMobile();
  return isMobile ? <WarningsMobile /> : <WarningsDesktop />;
}

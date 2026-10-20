import { CheckOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UndoOutlined } from '@ant-design/icons';
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
  Radio,
  Select,
  Space,
  Table,
  Tag,
  TimePicker,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';

import { getStudentOptions } from '@/api/student';
import { createTodo, deleteTodo, getTodos, updateTodo } from '@/api/todo';
import PageHeader from '@/components/PageHeader';
import { TODO_PRIORITIES, TODO_PRIORITY_COLOR, TODO_STATUSES, TODO_TYPES, TODO_TYPE_COLOR, toOptions } from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import type { StudentOption, Todo, TodoInput, TodoPriority, TodoQuery, TodoStatus, TodoType } from '@/types';
import TodosMobile from './mobile';

interface TodoFormValues {
  title: string;
  type: TodoType;
  priority: TodoPriority;
  dueDate: Dayjs;
  dueTime?: Dayjs;
  relatedStudent?: string;
  note?: string;
}

/** 待办提醒：列表 / 筛选搜索 / 新增 / 编辑 / 完成切换 / 删除 / 详情 */
function TodosDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [form] = Form.useForm<TodoFormValues>();

  const { query, patchQuery, data, loading, refresh } = useList<Todo, TodoQuery>(getTodos, {
    page: 1,
    pageSize: 10,
  });

  const todayStr = dayjs().format('YYYY-MM-DD');
  const [keywordInput, setKeywordInput] = useState('');
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Todo | null>(null);

  useEffect(() => {
    getStudentOptions().then(setStudentOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        dueDate: dayjs(editing.dueDate),
        dueTime: editing.dueTime ? dayjs(editing.dueTime, 'HH:mm') : undefined,
      });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Todo) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: TodoFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload: TodoInput = {
        ...values,
        dueDate: values.dueDate.format('YYYY-MM-DD'),
        // 选填字段显式传 null：服务端据此清空（undefined 会被 JSON 丢弃而保留原值）
        dueTime: values.dueTime?.format('HH:mm') ?? null,
        relatedStudent: values.relatedStudent ?? null,
        note: values.note ?? null,
      };
      if (editing) {
        await updateTodo(editing.id, payload);
        message.success('待办已更新');
      } else {
        await createTodo(payload);
        message.success('待办已创建');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (record: Todo) => {
    const next: TodoStatus = record.status === '未完成' ? '已完成' : '未完成';
    await updateTodo(record.id, { status: next });
    message.success(next === '已完成' ? '待办已完成' : '已恢复为未完成');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteTodo(id);
    message.success('删除成功');
    refresh();
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, type: undefined, priority: undefined, status: undefined });
  };

  const columns: ColumnsType<Todo> = [
    {
      title: '事项',
      dataIndex: 'title',
      ellipsis: true,
      render: (_, record) => (
        <Space size={6}>
          <span
            style={{
              color: record.status === '已完成' ? 'rgba(0,0,0,0.35)' : undefined,
              textDecoration: record.status === '已完成' ? 'line-through' : undefined,
              fontWeight: 500,
            }}
          >
            {record.title}
          </span>
          {record.status === '未完成' && record.dueDate < todayStr && (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              已逾期
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (type: TodoType) => <Tag color={TODO_TYPE_COLOR[type]}>{type}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 85,
      render: (priority: TodoPriority) => (
        <Tag color={TODO_PRIORITY_COLOR[priority]}>{priority}</Tag>
      ),
    },
    {
      title: '截止时间',
      dataIndex: 'dueDate',
      width: 130,
      render: (_, record) => (
        <span
          style={{
            color: record.status === '未完成' && record.dueDate < todayStr ? '#cf1322' : undefined,
          }}
        >
          {record.dueDate} {record.dueTime}
        </span>
      ),
    },
    {
      title: '关联学生',
      dataIndex: 'relatedStudent',
      width: 95,
      render: (v: string) => v ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: TodoStatus) =>
        status === '已完成' ? <Tag color="green">已完成</Tag> : <Tag>未完成</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => toggleStatus(record)}>
            {record.status === '未完成' ? <CheckOutlined /> : <UndoOutlined />}
            {record.status === '未完成' ? '完成' : '恢复'}
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该待办吗？" onConfirm={() => handleDelete(record.id)}>
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
        title="待办提醒"
        subtitle="今日待办、逾期待办与工作安排，支持完成打卡与优先级管理；仅显示本人创建的待办"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索事项 / 学生 / 备注"
          style={{ width: isMobile ? '100%' : 220 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="类型"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(TODO_TYPES)}
          value={query.type}
          onChange={(type) => patchQuery({ type })}
        />
        <Select
          placeholder="优先级"
          allowClear
          style={{ minWidth: 100 }}
          options={toOptions(TODO_PRIORITIES)}
          value={query.priority}
          onChange={(priority) => patchQuery({ priority })}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ minWidth: 100 }}
          options={toOptions(TODO_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增待办
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
          showTotal: (total) => `共 ${total} 项待办`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title="待办详情"
        width={isMobile ? '100%' : 520}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="事项">{detail.title}</Descriptions.Item>
            <Descriptions.Item label="类型">
              <Tag color={TODO_TYPE_COLOR[detail.type]}>{detail.type}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="优先级">
              <Tag color={TODO_PRIORITY_COLOR[detail.priority]}>{detail.priority}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="截止时间">
              {detail.dueDate} {detail.dueTime}
              {detail.status === '未完成' && detail.dueDate < todayStr && (
                <Tag color="red" style={{ marginLeft: 8 }}>
                  已逾期
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {detail.status === '已完成' ? <Tag color="green">已完成</Tag> : <Tag>未完成</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="关联学生">{detail.relatedStudent ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="备注">{detail.note ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{detail.createdAt}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      {/* 新增 / 编辑待办 */}
      <Modal
        title={editing ? '编辑待办' : '新增待办'}
        width={isMobile ? 'calc(100vw - 24px)' : 560}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ type: '其他', priority: '中' }}>
          <Form.Item
            name="title"
            label="待办事项"
            rules={[{ required: true, message: '请输入待办事项' }]}
          >
            <Input placeholder="如：与张三进行心理约谈" maxLength={50} showCount />
          </Form.Item>
          <Space size={16} wrap style={{ display: 'flex' }}>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={toOptions(TODO_TYPES)} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
              <Radio.Group options={toOptions(TODO_PRIORITIES)} />
            </Form.Item>
            <Form.Item
              name="dueDate"
              label="截止日期"
              rules={[{ required: true, message: '请选择截止日期' }]}
            >
              <DatePicker style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="dueTime" label="截止时间">
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Form.Item name="relatedStudent" label="关联学生（选填）">
            <Select
              showSearch
              allowClear
              placeholder="输入姓名搜索"
              optionFilterProp="label"
              options={studentOptions.map((s) => ({ value: s.name, label: `${s.name}（${s.className}）` }))}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="补充说明（选填）" />
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
export default function Todos() {
  const isMobile = useIsMobile();
  return isMobile ? <TodosMobile /> : <TodosDesktop />;
}

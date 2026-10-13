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
  Switch,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import {
  createNotice,
  deleteNotice,
  getNotices,
  publishNotice,
  updateNotice,
  withdrawNotice,
} from '@/api/notice';
import PageHeader from '@/components/PageHeader';
import { NOTICE_SCOPES, NOTICE_STATUSES, NOTICE_STATUS_COLOR, NOTICE_TYPES, NOTICE_TYPE_COLOR, toOptions } from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import type { Notice, NoticeInput, NoticeQuery, NoticeStatus, NoticeType } from '@/types';

interface NoticeFormValues {
  title: string;
  type: NoticeType;
  scope: string;
  content: string;
  pinned: boolean;
}

/** 通知发布：列表 / 筛选搜索 / 新建 / 编辑 / 发布 / 撤回 / 删除 / 详情 */
export default function Notices() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [form] = Form.useForm<NoticeFormValues>();

  const { query, patchQuery, data, loading, refresh } = useList<Notice, NoticeQuery>(getNotices, {
    page: 1,
    pageSize: 10,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [editing, setEditing] = useState<Notice | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Notice | null>(null);

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

  const openEdit = (record: Notice) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: NoticeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload: NoticeInput = values;
      if (editing) {
        await updateNotice(editing.id, payload);
        message.success('通知已更新');
      } else {
        await createNotice(payload);
        message.success('通知已保存为草稿，发布后学生端可见');
      }
      setModalOpen(false);
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async (record: Notice) => {
    await publishNotice(record.id);
    message.success('通知已发布');
    refresh();
  };

  const handleWithdraw = async (record: Notice) => {
    await withdrawNotice(record.id);
    message.success('通知已撤回');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteNotice(id);
    message.success('删除成功');
    refresh();
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, type: undefined, status: undefined });
  };

  const columns: ColumnsType<Notice> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (_, record) => (
        <Space size={6}>
          {record.pinned && <Tag color="volcano">置顶</Tag>}
          <a onClick={() => setDetail(record)} style={{ fontWeight: 500 }}>
            {record.title}
          </a>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (type: NoticeType) => <Tag color={NOTICE_TYPE_COLOR[type]}>{type}</Tag>,
    },
    { title: '发布范围', dataIndex: 'scope', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: NoticeStatus) => <Tag color={NOTICE_STATUS_COLOR[status]}>{status}</Tag>,
    },
    { title: '发布时间', dataIndex: 'publishAt', width: 140, render: (v: string) => v ?? '—' },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          {record.status === '草稿' && (
            <Button type="link" size="small" onClick={() => handlePublish(record)}>
              发布
            </Button>
          )}
          {record.status === '已发布' && (
            <Popconfirm title="撤回后学生端将不可见，确定撤回吗？" onConfirm={() => handleWithdraw(record)}>
              <Button type="link" size="small">
                撤回
              </Button>
            </Popconfirm>
          )}
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该通知吗？" onConfirm={() => handleDelete(record.id)}>
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
        title="通知发布"
        subtitle="面向所带学生发布事务、活动、安全等通知，支持草稿、发布与撤回"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索标题 / 内容"
          style={{ width: isMobile ? '100%' : 220 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="通知类型"
          allowClear
          style={{ minWidth: 120 }}
          options={toOptions(NOTICE_TYPES)}
          value={query.type}
          onChange={(type) => patchQuery({ type })}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ minWidth: 100 }}
          options={toOptions(NOTICE_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建通知
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 950 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条通知`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 详情抽屉 */}
      <Drawer
        title={detail?.title}
        width={isMobile ? '100%' : 640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
              <Descriptions.Item label="类型">
                <Tag color={NOTICE_TYPE_COLOR[detail.type]}>{detail.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={NOTICE_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="发布范围">{detail.scope}</Descriptions.Item>
              <Descriptions.Item label="是否置顶">{detail.pinned ? '置顶' : '否'}</Descriptions.Item>
              <Descriptions.Item label="发布人">{detail.author}</Descriptions.Item>
              <Descriptions.Item label="发布时间">{detail.publishAt ?? '未发布'}</Descriptions.Item>
            </Descriptions>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>通知内容</div>
              <div className="detail-pre">{detail.content}</div>
            </div>
          </Space>
        )}
      </Drawer>

      {/* 新建 / 编辑通知 */}
      <Modal
        title={editing ? '编辑通知' : '新建通知'}
        width={isMobile ? 'calc(100vw - 24px)' : 680}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ type: '事务通知', scope: '全部学生', pinned: false }}>
          <Form.Item
            name="title"
            label="通知标题"
            rules={[{ required: true, message: '请输入通知标题' }]}
          >
            <Input placeholder="请输入通知标题" maxLength={60} showCount />
          </Form.Item>
          <Space size={16} wrap style={{ display: 'flex' }}>
            <Form.Item name="type" label="通知类型" rules={[{ required: true }]}>
              <Select options={toOptions(NOTICE_TYPES)} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="scope" label="发布范围" rules={[{ required: true }]}>
              <Select options={toOptions(NOTICE_SCOPES)} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="pinned" label="置顶显示" valuePropName="checked">
              <Switch checkedChildren="置顶" unCheckedChildren="常规" />
            </Form.Item>
          </Space>
          <Form.Item
            name="content"
            label="通知内容"
            rules={[{ required: true, message: '请输入通知内容' }]}
          >
            <Input.TextArea rows={10} placeholder="支持换行分段，保存后可发布或继续编辑" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

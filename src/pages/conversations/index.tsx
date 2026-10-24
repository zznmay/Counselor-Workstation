import {
  NodeIndexOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getStudent } from '@/api/student';
import { useStudentOptions } from '@/hooks/useStudentOptions';
import {
  createConversation,
  deleteConversation,
  getConversationTimeline,
  getConversations,
  getTalkedStudents,
  updateConversation,
} from '@/api/conversation';
import ConversationFormFields, {
  conversationFormToInput,
} from '@/components/ConversationFormFields';
import type { ConversationFormValues } from '@/components/ConversationFormFields';
import PageHeader from '@/components/PageHeader';
import { TALK_TYPES, TALK_TYPE_COLOR, TALK_WAYS, toOptions } from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canAction } from '@/lib/auth';
import { useList } from '@/hooks/useList';
import type {
  Conversation,
  ConversationQuery,
  StudentOption,
  TalkType,
  TalkedStudentOption,
} from '@/types';
import ConversationsMobile from './mobile';

const FOLLOW_OPTIONS = [
  { value: '是', label: '需要跟进' },
  { value: '否', label: '无需跟进' },
];

/** 筛选下拉的「是/否」转换为布尔查询条件 */
const toBool = (v?: string): boolean | undefined => (v === undefined ? undefined : v === '是');

/**
 * 谈心谈话记录（桌面端）：列表视图（筛选搜索 / 增删改查） + 时间线视图（按学生维度、从最新到最早回溯）。
 * 两个视图共用同一套详情抽屉与编辑弹窗，数据同源于谈话记录表。
 */
function ConversationsDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const authUser = useAuthUser();
  const [form] = Form.useForm<ConversationFormValues & { studentId: string }>();

  const [view, setView] = useState<'list' | 'timeline'>('list');

  const { query, patchQuery, data, loading, refresh } = useList<Conversation, ConversationQuery>(
    getConversations,
    { page: 1, pageSize: 10 },
  );

  const [keywordInput, setKeywordInput] = useState('');
  const [pickedStudent, setPickedStudent] = useState<StudentOption | null>(null);

  /* ---------- 时间线视图状态 ---------- */
  const [talkedStudents, setTalkedStudents] = useState<TalkedStudentOption[]>([]);
  const [timelineStudentId, setTimelineStudentId] = useState<string | undefined>();
  const [timelineType, setTimelineType] = useState<TalkType | undefined>();
  const [timelineData, setTimelineData] = useState<Conversation[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineTick, setTimelineTick] = useState(0);

  const [editing, setEditing] = useState<Conversation | null>(null);
  const [presetStudentId, setPresetStudentId] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Conversation | null>(null);

  /* 学生下拉：打开表单时按需搜索，只返回可维护班级；编辑对象置顶回显 */
  const {
    options: studentOptions,
    loading: studentOptionsLoading,
    search: searchStudents,
    handlePopupScroll,
  } = useStudentOptions({ enabled: modalOpen, manageableOnly: true, selected: pickedStudent });

  const loadTalkedStudents = useCallback(() => {
    return getTalkedStudents()
      .then((list) => {
        setTalkedStudents(list);
        setTimelineStudentId((prev) => prev ?? list[0]?.id);
      })
      .catch(() => undefined);
  }, []);

  /* 时间线数据只在切到时间线视图时加载：列表视图不再额外发 talked-students/timeline 请求 */
  useEffect(() => {
    if (view !== 'timeline') return;
    void loadTalkedStudents();
  }, [view, loadTalkedStudents]);

  const loadTimeline = useCallback(() => {
    if (view !== 'timeline') return;
    if (!timelineStudentId) {
      setTimelineData([]);
      return;
    }
    setTimelineLoading(true);
    getConversationTimeline({ studentId: timelineStudentId, type: timelineType })
      .then(setTimelineData)
      .catch(() => message.error('时间线数据加载失败'))
      .finally(() => setTimelineLoading(false));
  }, [view, timelineStudentId, timelineType, timelineTick, message]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  /** 增删改后统一刷新：列表必刷；时间线仅当前可见时刷新，避免隐藏视图空跑请求 */
  const refreshAll = useCallback(() => {
    refresh();
    if (view === 'timeline') {
      void loadTalkedStudents();
      setTimelineTick((t) => t + 1);
    }
  }, [refresh, view, loadTalkedStudents]);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ ...editing, talkTime: dayjs(editing.talkTime) });
    } else {
      form.resetFields();
      form.setFieldsValue({
        talkTime: dayjs(),
        way: '面对面',
        type: '学业指导',
        needFollowUp: false,
        ...(presetStudentId ? { studentId: presetStudentId } : {}),
      });
    }
  }, [modalOpen, editing, form, presetStudentId]);

  const openCreate = (preset?: string) => {
    setPresetStudentId(preset);
    setEditing(null);
    setPickedStudent(null);
    searchStudents('');
    setModalOpen(true);
  };

  const openEdit = (record: Conversation) => {
    setEditing(record);
    searchStudents('');
    setPickedStudent({
      id: record.studentId,
      name: record.studentName,
      studentNo: record.studentNo,
      className: '',
    });
    setModalOpen(true);
  };

  /* 从移动端「发起谈心」入口进入时（/conversations?studentId=xxx），自动打开记录表单并预选该学生 */
  const [searchParams] = useSearchParams();
  const presetFromUrl = searchParams.get('studentId');
  useEffect(() => {
    if (!presetFromUrl) return;
    openCreate(presetFromUrl);
    // 预选学生可能不在分页首屏，拉取单条详情保证下拉回显姓名
    getStudent(presetFromUrl)
      .then((s) => setPickedStudent({
        id: s.id,
        name: s.name,
        studentNo: s.studentNo,
        className: s.className,
      }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetFromUrl]);

  const handleSubmit = async () => {
    let values: ConversationFormValues & { studentId: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload = conversationFormToInput(values, values.studentId);
      if (editing) {
        await updateConversation(editing.id, payload);
        message.success('谈话记录已更新');
      } else {
        await createConversation(payload);
        message.success('谈话记录已保存');
      }
      setModalOpen(false);
      refreshAll();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    message.success('删除成功');
    refreshAll();
  };

  const switchToTimeline = (studentId: string) => {
    setTimelineStudentId(studentId);
    setTimelineType(undefined);
    setView('timeline');
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({
      keyword: undefined,
      type: undefined,
      way: undefined,
      needFollowUp: undefined,
      startDate: undefined,
      endDate: undefined,
    });
  };

  const columns: ColumnsType<Conversation> = [
    {
      title: '学生',
      dataIndex: 'studentName',
      width: 150,
      render: (_, record) => (
        <div>
          <a onClick={() => setDetail(record)} style={{ fontWeight: 500 }}>
            {record.studentName}
          </a>
          <div style={{ fontSize: 12, color: 'rgba(47,62,102,0.45)' }}>{record.studentNo}</div>
        </div>
      ),
    },
    {
      title: '谈话类型',
      dataIndex: 'type',
      width: 100,
      render: (type: TalkType) => <Tag color={TALK_TYPE_COLOR[type]}>{type}</Tag>,
    },
    { title: '方式', dataIndex: 'way', width: 85 },
    { title: '谈话时间', dataIndex: 'talkTime', width: 140 },
    { title: '内容摘要', dataIndex: 'content', ellipsis: true },
    {
      title: '跟进',
      dataIndex: 'needFollowUp',
      width: 95,
      render: (need: boolean) =>
        need ? <Tag color="orange">需跟进</Tag> : <span style={{ color: 'rgba(47,62,102,0.35)' }}>—</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 225,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => switchToTimeline(record.studentId)}>
            时间线
          </Button>
          <Button type="link" size="small" onClick={() => setDetail(record)}>
            详情
          </Button>
          {canAction(authUser, 'conversations', 'edit') && (
            <Button type="link" size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
          )}
          {canAction(authUser, 'conversations', 'delete') && (
            <Popconfirm title="确定删除该条谈话记录吗？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const timelineSummary = talkedStudents.find((s) => s.id === timelineStudentId);

  return (
    <div className="page">
      <PageHeader
        title="谈心谈话记录"
        subtitle="记录与学生的谈心谈话过程，支持列表管理，也可按学生以时间线回溯成长轨迹"
        extra={
          <Segmented
            value={view}
            onChange={(v) => setView(v as 'list' | 'timeline')}
            options={[
              { value: 'list', label: '列表视图', icon: <UnorderedListOutlined /> },
              { value: 'timeline', label: '时间线视图', icon: <NodeIndexOutlined /> },
            ]}
          />
        }
      />

      {view === 'list' && (
        <>
          <div className="toolbar">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'rgba(47,62,102,0.35)' }} />}
              placeholder="搜索学生姓名 / 学号 / 内容"
              style={{ width: isMobile ? '100%' : 230 }}
              value={keywordInput}
              onChange={(e) => {
                setKeywordInput(e.target.value);
                if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
              }}
              onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
            />
            <Select
              placeholder="谈话类型"
              allowClear
              style={{ minWidth: 120 }}
              options={toOptions(TALK_TYPES)}
              value={query.type}
              onChange={(type) => patchQuery({ type })}
            />
            <Select
              placeholder="谈话方式"
              allowClear
              style={{ minWidth: 110 }}
              options={toOptions(TALK_WAYS)}
              value={query.way}
              onChange={(way) => patchQuery({ way })}
            />
            <Select
              placeholder="是否需跟进"
              allowClear
              style={{ minWidth: 120 }}
              options={FOLLOW_OPTIONS}
              value={query.needFollowUp === undefined ? undefined : query.needFollowUp ? '是' : '否'}
              onChange={(v) => patchQuery({ needFollowUp: toBool(v) })}
            />
            <DatePicker.RangePicker
              style={{ width: isMobile ? '100%' : 250 }}
              onChange={(_, strs) =>
                patchQuery({ startDate: strs[0] || undefined, endDate: strs[1] || undefined })
              }
            />
            <Button icon={<RedoOutlined />} onClick={resetFilters}>
              重置
            </Button>
            <div className="toolbar-spacer" />
            {canAction(authUser, 'conversations', 'create') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
                新增谈话记录
              </Button>
            )}
          </div>

          <Table
            rowKey="id"
            columns={columns}
            dataSource={data.list}
            loading={loading}
            scroll={{ x: 1080 }}
            pagination={{
              current: data.page,
              pageSize: data.pageSize,
              total: data.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
            }}
          />
        </>
      )}

      {view === 'timeline' && (
        <Card>
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <Select
              showSearch
              placeholder="选择学生查看谈话时间线"
              optionFilterProp="label"
              style={{ width: isMobile ? '100%' : 300 }}
              options={talkedStudents.map((s) => ({
                value: s.id,
                label: `${s.name}（${s.className} · ${s.count} 次）`,
              }))}
              value={timelineStudentId}
              onChange={setTimelineStudentId}
              notFoundContent={timelineLoading ? <Spin size="small" /> : '暂无谈话记录'}
            />
            <Select
              placeholder="谈话类型"
              allowClear
              style={{ minWidth: 130 }}
              options={toOptions(TALK_TYPES)}
              value={timelineType}
              onChange={setTimelineType}
            />
            <div className="toolbar-spacer" />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!timelineStudentId}
              hidden={!canAction(authUser, 'conversations', 'create')}
              onClick={() => openCreate(timelineStudentId)}
            >
              记录谈话
            </Button>
          </div>

          {timelineSummary && (
            <div className="timeline-student">
              <span className="student-chip">{timelineSummary.name.charAt(0)}</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--app-ink)' }}>
                  {timelineSummary.name}
                  <span style={{ fontWeight: 400, fontSize: 12, color: '#7686a8', marginLeft: 8 }}>
                    {timelineSummary.className} · {timelineSummary.studentNo}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#7686a8', marginTop: 2 }}>
                  累计 {timelineSummary.count} 次谈话 · 最近一次 {timelineSummary.lastTime}
                  {timelineSummary.followCount > 0 && ` · ${timelineSummary.followCount} 条需跟进`}
                </div>
              </div>
            </div>
          )}

          {timelineLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <Spin tip="正在加载时间线…" />
            </div>
          ) : timelineData.length === 0 ? (
            <Empty description="该筛选条件下暂无谈话记录" style={{ padding: '48px 0' }} />
          ) : (
            <Timeline
              className="talk-timeline"
              items={timelineData.map((c) => ({
                color: TALK_TYPE_COLOR[c.type],
                children: (
                  <div className="tl-card">
                    <div className="tl-head">
                      <span className="tl-date">{c.talkTime.slice(0, 10)}</span>
                      <span className="tl-hm">{c.talkTime.slice(11)}</span>
                      <Tag color={TALK_TYPE_COLOR[c.type]}>{c.type}</Tag>
                      <Tag>{c.way}</Tag>
                      {c.needFollowUp && <Tag color="orange">需跟进</Tag>}
                      <span className="tl-actions">
                        {canAction(authUser, 'conversations', 'edit') && (
                          <Button type="link" size="small" onClick={() => openEdit(c)}>
                            编辑
                          </Button>
                        )}
                        {canAction(authUser, 'conversations', 'delete') && (
                          <Popconfirm
                            title="确定删除该条谈话记录吗？"
                            onConfirm={() => handleDelete(c.id)}
                          >
                            <Button type="link" size="small" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        )}
                      </span>
                    </div>
                    <div className="detail-pre tl-content">{c.content}</div>
                    {c.followUp && (
                      <div className="tl-follow">
                        <b>后续跟进：</b>
                        {c.followUp}
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      )}

      {/* 详情抽屉 */}
      <Drawer
        title="谈话记录详情"
        width={isMobile ? '100%' : 560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={isMobile ? 1 : 2}>
              <Descriptions.Item label="学生" span={2}>
                {detail.studentName}（{detail.studentNo}）
              </Descriptions.Item>
              <Descriptions.Item label="谈话时间">{detail.talkTime}</Descriptions.Item>
              <Descriptions.Item label="谈话方式">{detail.way}</Descriptions.Item>
              <Descriptions.Item label="谈话类型">
                <Tag color={TALK_TYPE_COLOR[detail.type]}>{detail.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="是否跟进">
                {detail.needFollowUp ? <Tag color="orange">需跟进</Tag> : '无需跟进'}
              </Descriptions.Item>
            </Descriptions>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>谈话内容</div>
              <div className="detail-pre">{detail.content}</div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>后续跟进事项</div>
              <div className="detail-pre">{detail.followUp ?? '—'}</div>
            </div>
          </Space>
        )}
      </Drawer>

      {/* 新增 / 编辑谈话记录 */}
      <Modal
        title={editing ? '编辑谈话记录' : '新增谈话记录'}
        width={isMobile ? 'calc(100vw - 24px)' : 620}
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
          initialValues={{ way: '面对面', type: '学业指导', needFollowUp: false }}
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
              label: s.className
                ? `${s.name}（${s.className} · ${s.studentNo}）`
                : `${s.name}（${s.studentNo}）`,
            }))}
          />
        </Form.Item>
        <ConversationFormFields />
      </Form>
    </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（分段双视图 + 卡片化列表 + 底部面板表单），
 * 修复桌面表格在手机上「固定操作列占满屏幕、看不到是谁的记录」的问题；桌面端零改动。
 */
export default function Conversations() {
  const isMobile = useIsMobile();
  return isMobile ? <ConversationsMobile /> : <ConversationsDesktop />;
}

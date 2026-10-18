import { HeartOutlined, PlusOutlined, RedoOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

import {
  getMentalCandidates,
  getMentalConcerns,
  getMentalSummary,
  getMentalTimeline,
  setAttention,
} from '@/api/mental';
import type { AttentionLevel, MentalCandidate, MentalConcern, MentalLevelSummary, MentalTimeline } from '@/types';
import { getClassOptions } from '@/api/classes';
import PageHeader from '@/components/PageHeader';
import { ATTENTION_LEVELS, ATTENTION_TAG_COLORS } from '@/constants/mental';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { getStoredUser, isSystemAdmin } from '@/lib/auth';
import MentalMobile from './mobile';

interface MentalQuery {
  page: number;
  pageSize: number;
  level?: AttentionLevel | '';
  keyword?: string;
  classId?: number;
}

/** 谈话记录抽屉状态 */
interface TalkDrawerState {
  open: boolean;
  loading: boolean;
  data: MentalTimeline | null;
}

/** 标记弹窗：mode=adjust 调整已有；mode=create 新增关注（选择学生） */
interface MarkModalState {
  open: boolean;
  mode: 'adjust' | 'create';
  target: MentalConcern | null;
}

/**
 * 心理健康：关注学生按等级分类展示与筛选；与谈心谈话打通（只读查看谈话记录）。
 * 数据范围由服务端按「带班」严格限定：仅本班学生可见，带班为空则不可见任何数据。
 */
function MentalHealthDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const authUser = getStoredUser();
  const isAdmin = isSystemAdmin(authUser);
  /** 写权限：与后端 canManageStudent 同口径 —— 管理员或至少带一个班 */
  const canWrite = isAdmin || (authUser?.classIds ?? []).length > 0;

  const { query, patchQuery, data, loading, refresh } = useList<MentalConcern, MentalQuery>(
    getMentalConcerns,
    { page: 1, pageSize: 10 },
  );
  const [summary, setSummary] = useState<MentalLevelSummary[]>([]);
  const [classOptions, setClassOptions] = useState<{ id: number; name: string; gradeName: string }[]>([]);
  const [keywordInput, setKeywordInput] = useState('');

  /* ---------- 标记弹窗（调整 / 新增） ---------- */
  const [markModal, setMarkModal] = useState<MarkModalState>({ open: false, mode: 'adjust', target: null });
  const [markForm] = Form.useForm<{ studentId?: string; level: AttentionLevel; note?: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [candidates, setCandidates] = useState<MentalCandidate[]>([]);
  const [candidateKeyword, setCandidateKeyword] = useState('');

  /* ---------- 谈话记录抽屉 ---------- */
  const [talkDrawer, setTalkDrawer] = useState<TalkDrawerState>({ open: false, loading: false, data: null });

  const reloadSummary = () => {
    getMentalSummary().then(setSummary).catch(() => undefined);
  };

  useEffect(() => {
    reloadSummary();
    getClassOptions()
      .then((opts) => {
        // 非管理员只展示所辖班级，避免出现选了也查不到数据的选项
        setClassOptions(
          isAdmin ? opts : opts.filter((c) => (authUser?.classIds ?? []).includes(c.id)),
        );
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!markModal.open || markModal.mode !== 'create') return;
    getMentalCandidates(candidateKeyword)
      .then(setCandidates)
      .catch(() => undefined);
  }, [markModal.open, markModal.mode, candidateKeyword]);

  const summaryOf = (level: string) => summary.find((s) => s.level === level)?.count ?? 0;
  const activeLevel = query.level ?? '';

  /** 点击分类卡：切换等级筛选（再点一次取消） */
  const toggleLevel = (level: AttentionLevel) => {
    patchQuery({ level: activeLevel === level ? '' : level });
  };

  const openAdjust = (record: MentalConcern) => {
    setMarkModal({ open: true, mode: 'adjust', target: record });
    markForm.setFieldsValue({ level: record.level, note: record.note ?? '' });
  };

  const openCreate = () => {
    setMarkModal({ open: true, mode: 'create', target: null });
    setCandidateKeyword('');
    setCandidates([]);
    markForm.resetFields();
  };

  const handleMarkSubmit = async () => {
    let values: { studentId?: string; level: AttentionLevel; note?: string };
    try {
      values = await markForm.validateFields();
    } catch {
      return;
    }
    const studentId = markModal.mode === 'adjust' ? markModal.target!.studentId : values.studentId!;
    const studentName = markModal.mode === 'adjust'
      ? markModal.target!.name
      : candidates.find((c) => c.id === values.studentId)?.name;
    setSubmitting(true);
    try {
      await setAttention(studentId, { level: values.level, note: values.note ?? '' });
      message.success(
        markModal.mode === 'adjust'
          ? `已更新「${studentName}」的关注等级`
          : `已将「${studentName}」纳入关注（${values.level}）`,
      );
      setMarkModal({ open: false, mode: 'adjust', target: null });
      reloadSummary();
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async (record: MentalConcern) => {
    try {
      await setAttention(record.studentId, { level: '' });
      message.success(`已取消对「${record.name}」的关注标记`);
      reloadSummary();
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const openTalks = async (record: MentalConcern) => {
    setTalkDrawer({ open: true, loading: true, data: null });
    try {
      const res = await getMentalTimeline(record.studentId);
      setTalkDrawer({ open: true, loading: false, data: res });
    } catch (e) {
      setTalkDrawer({ open: false, loading: false, data: null });
      message.error(e instanceof Error ? e.message : '谈话记录加载失败');
    }
  };

  const columns: ColumnsType<MentalConcern> = [
    {
      title: '学生',
      dataIndex: 'name',
      width: 150,
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.studentNo}</Typography.Text>
        </div>
      ),
    },
    { title: '班级', dataIndex: 'className', width: 110 },
    {
      title: '关注等级',
      dataIndex: 'level',
      width: 110,
      render: (level: AttentionLevel) => (
        <Tag color={ATTENTION_TAG_COLORS[level]} style={{ marginInlineEnd: 0 }}>{level}</Tag>
      ),
    },
    {
      title: '关注备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (note?: string | null) => note || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '谈心谈话',
      key: 'talks',
      width: 190,
      render: (_, record) => (
        <Space size={6} wrap>
          <Tag color={record.talkCount > 0 ? 'geekblue' : 'default'}>{record.talkCount} 次</Tag>
          {record.followCount > 0 && <Tag color="red">需跟进 {record.followCount}</Tag>}
          {record.lastTalkTime && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最近 {record.lastTalkTime.slice(0, 16)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (v: string, record) => (
        <div>
          <div style={{ fontSize: 13 }}>{v?.slice(0, 16)}</div>
          {record.updatedBy && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>by {record.updatedBy}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 230,
      render: (_, record) => (
        <Space size={2} wrap={false}>
          <Button type="link" size="small" onClick={() => openTalks(record)}>
            谈话记录
          </Button>
          {canWrite && (
            <>
              <Button type="link" size="small" onClick={() => openAdjust(record)}>
                调整关注
              </Button>
              <Popconfirm
                title={`取消对「${record.name}」的关注标记？`}
                description="取消后该学生不再出现在关注列表中"
                okText="取消关注"
                cancelText="返回"
                onConfirm={() => handleClear(record)}
              >
                <Button type="link" size="small" danger>
                  取消关注
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="心理健康"
        subtitle="按关注等级管理需要关注的学生；等级数据与谈心谈话记录联动（仅本班学生可见）"
        extra={
          canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增关注
            </Button>
          )
        }
      />

      {/* 数据范围提示：非管理员仅可见所辖班级学生 */}
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            (authUser?.classIds ?? []).length > 0
              ? '数据范围：仅您所辖班级内被标记为需要关注的学生。'
              : '您尚未分配带班班级，暂无可查看的关注学生；请联系管理员在「用户管理」中分配所辖班级。'
          }
        />
      )}

      {/* 关注等级分类卡：点击即按该等级筛选，再点取消 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {ATTENTION_LEVELS.map((level) => {
          const active = activeLevel === level;
          const count = summaryOf(level);
          return (
            <button
              key={level}
              type="button"
              onClick={() => toggleLevel(level)}
              className="mental-level-card"
              data-active={active ? 'on' : 'off'}
              data-level={level}
            >
              <span className="mental-level-name">{level}</span>
              <span className="mental-level-count">{count}</span>
              <span className="mental-level-unit">人</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <Select
          allowClear
          placeholder="关注等级"
          style={{ minWidth: 130 }}
          value={query.level || undefined}
          onChange={(level) => patchQuery({ level: level ?? '' })}
          options={ATTENTION_LEVELS.map((l) => ({ value: l, label: l }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="children"
          placeholder="班级"
          style={{ minWidth: 150 }}
          value={query.classId}
          onChange={(classId) => patchQuery({ classId: classId ?? undefined })}
        >
          {classOptions.map((c) => (
            <Select.Option key={c.id} value={c.id}>
              {c.gradeName}·{c.name}
            </Select.Option>
          ))}
        </Select>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#b9c4da' }} />}
          placeholder="姓名 / 学号 / 班级"
          style={{ width: 200 }}
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onPressEnter={() => patchQuery({ keyword: keywordInput.trim() })}
        />
        <Button icon={<SearchOutlined />} onClick={() => patchQuery({ keyword: keywordInput.trim() })}>
          查询
        </Button>
        <Button icon={<RedoOutlined />} onClick={() => { setKeywordInput(''); patchQuery({ keyword: '', level: '', classId: undefined }); }}>
          重置
        </Button>
        <div className="toolbar-spacer" />
      </div>

      <Table
        rowKey="studentId"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1080 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 名关注学生`,
        }}
      />

      {/* 调整 / 新增关注标记 */}
      <Modal
        title={markModal.mode === 'adjust' ? `调整关注 · ${markModal.target?.name ?? ''}` : '新增关注'}
        open={markModal.open}
        confirmLoading={submitting}
        onOk={handleMarkSubmit}
        onCancel={() => setMarkModal({ open: false, mode: 'adjust', target: null })}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 480}
      >
        <Form form={markForm} layout="vertical">
          {markModal.mode === 'create' && (
            <Form.Item name="studentId" label="学生" rules={[{ required: true, message: '请选择学生' }]}>
              <Select
                showSearch
                placeholder="输入姓名或学号搜索（仅本班未标记学生）"
                filterOption={false}
                onSearch={(v) => setCandidateKeyword(v.trim())}
                notFoundContent={candidates.length === 0 ? '没有可标记的学生' : undefined}
                options={candidates.map((c) => ({
                  value: c.id,
                  label: `${c.name}（${c.studentNo} · ${c.className}）`,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="level" label="关注等级" rules={[{ required: true, message: '请选择关注等级' }]}>
            <Select
              placeholder="选择关注等级"
              options={ATTENTION_LEVELS.map((l) => ({ value: l, label: l }))}
            />
          </Form.Item>
          <Form.Item
            name="note"
            label="关注备注"
            rules={[{ max: 200, message: '不可超过 200 字' }]}
            extra="记录关注事由与跟进安排（选填），仅带班教师可见"
          >
            <Input.TextArea rows={3} placeholder="如：近期情绪波动较大，已联系家长，每周谈话跟进" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 谈心谈话记录（只读打通） */}
      <Drawer
        title={talkDrawer.data ? `谈心谈话记录 · ${talkDrawer.data.student.name}` : '谈心谈话记录'}
        width={isMobile ? 'calc(100vw - 24px)' : 560}
        open={talkDrawer.open}
        onClose={() => setTalkDrawer({ open: false, loading: false, data: null })}
      >
        {talkDrawer.loading && <Empty description="加载中…" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {!talkDrawer.loading && talkDrawer.data && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              {talkDrawer.data.student.studentNo} · {talkDrawer.data.student.className} · 共{' '}
              {talkDrawer.data.list.length} 条记录
            </Typography.Paragraph>
            {talkDrawer.data.list.length === 0 ? (
              <Empty description="该学生暂无谈心谈话记录" />
            ) : (
              <Timeline
                items={talkDrawer.data.list.map((c) => ({
                  color: c.needFollowUp ? 'red' : 'blue',
                  children: (
                    <div style={{ paddingBottom: 8 }}>
                      <Space size={6} wrap style={{ marginBottom: 4 }}>
                        <Tag color="blue">{c.type}</Tag>
                        <Tag>{c.way}</Tag>
                        {c.needFollowUp && <Tag color="red">需跟进</Tag>}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{c.talkTime}</Typography.Text>
                      </Space>
                      <div style={{ lineHeight: 1.7 }}>{c.content}</div>
                      {c.followUp && (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          跟进事项：{c.followUp}
                        </Typography.Text>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 触控优化），
 * 桌面端沿用原组件，桌面样式与行为零改动。
 */
export default function MentalHealth() {
  const isMobile = useIsMobile();
  return isMobile ? <MentalMobile /> : <MentalHealthDesktop />;
}

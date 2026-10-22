import { DownloadOutlined, ExportOutlined, FileTextOutlined, HeartOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
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
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

import {
  deleteMentalInterview,
  getMentalCandidates,
  getMentalConcerns,
  getMentalInterviewOverview,
  getMentalInterviews,
  getMentalLevelLogs,
  getMentalSummary,
  getMentalTimeline,
  setAttention,
} from '@/api/mental';
import type {
  AttentionLevel,
  InterviewFormModel,
  InterviewOverview,
  MentalCandidate,
  MentalConcern,
  MentalInterview,
  MentalInterviewView,
  MentalLevelLog,
  MentalLevelSummary,
  MentalTimeline,
} from '@/types';
import { getClassOptions } from '@/api/classes';
import PageHeader from '@/components/PageHeader';
import { DEFAULT_INTERVIEW_FORM, INTERVIEW_REQUIRED } from '@/constants/interview';
import {
  ATTENTION_LEVELS,
  ATTENTION_TAG_COLORS,
  TALK_RECORD_EXTERNAL_URL,
  TALK_RECORD_TARGET_LEVELS,
} from '@/constants/mental';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { canAccessModule, canStartTalkRecord, getStoredUser, isModuleOwner, isSystemAdmin, subscribeSession } from '@/lib/auth';
import InterviewFormModal, { type InterviewStudentRef } from './interview/InterviewFormModal';
import TemplateManageModal from './interview/TemplateManageModal';
import ExportInterviewDialog from './ExportInterviewDialog';
import ImportConcernDialog from './ImportConcernDialog';
import {
  LEVEL_LOG_SOURCE_COLORS,
  LEVEL_LOG_SOURCE_LABELS,
  levelLogText,
  recordFormOf,
  recordQaPairs,
} from './interview/shared';
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

/** 心理访谈表单弹窗状态 */
interface InterviewModalState {
  open: boolean;
  student: InterviewStudentRef | null;
  record: MentalInterview | null;
  /** 生效记录单模板（按学生年级解析） */
  form: InterviewFormModel;
}

/**
 * 心理健康：关注学生按等级分类展示与筛选；与谈心谈话打通（只读查看谈话记录）。
 * 心理访谈入口在「一般关注」学生行内（不新增菜单/路由），写权由服务端逐行判定。
 * 数据范围由服务端按「主负责辅导员」模型限定：管理员/主负责全院可见，
 * 其他角色仅所辖班级学生可见（只读）。
 */
function MentalHealthDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  /** 角色/权限变更后实时重算（布局层 /auth/me 刷新时广播），避免沿用挂载时的旧角色快照 */
  const [authUser, setAuthUser] = useState(getStoredUser);
  useEffect(() => subscribeSession(setAuthUser), []);
  const isAdmin = isSystemAdmin(authUser);
  /** 心理健康主负责（含管理员）：查看全院 + 全部写操作 */
  const isMentalOwner = isModuleOwner(authUser, 'mentalHealth');
  /** 关注写权限（新增/调整/取消）：严格口径 —— 管理员或心理健康主负责 */
  const canMentalWrite = isAdmin || isMentalOwner;
  /**
   * 「新增谈话」外链显隐：系统管理员或角色列表含辅导员角色（counselor）的用户可见。
   * 单一班主任、心理健康主负责等其他角色一律隐藏（不看主负责、不看带班数量）。
   */
  const canWrite = canStartTalkRecord(authUser);
  /** 心理访谈任务提醒：仅持有访谈权限的角色（班主任/管理员/主负责）拉取 */
  const canInterviewPerm = canAccessModule(authUser, 'mentalInterview');

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

  /* ---------- 心理访谈 ---------- */
  const [overview, setOverview] = useState<InterviewOverview | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [ivView, setIvView] = useState<MentalInterviewView | null>(null);
  const [ivDrawerOpen, setIvDrawerOpen] = useState(false);
  const [ivLevelLogs, setIvLevelLogs] = useState<MentalLevelLog[]>([]);
  const [ivModal, setIvModal] = useState<InterviewModalState>({
    open: false,
    student: null,
    record: null,
    form: DEFAULT_INTERVIEW_FORM,
  });
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  /** 记录单模板管理弹窗（管理员/心理主负责） */
  const [tplModalOpen, setTplModalOpen] = useState(false);
  /** 批量导入关注学生（管理员/心理主负责） */
  const [importOpen, setImportOpen] = useState(false);
  /** 批量导出访谈记录（管理员/心理主负责） */
  const [exportOpen, setExportOpen] = useState(false);

  const reloadSummary = () => {
    getMentalSummary().then(setSummary).catch(() => undefined);
  };

  const reloadOverview = () => {
    if (!canInterviewPerm) return;
    getMentalInterviewOverview()
      .then(setOverview)
      .catch(() => undefined);
  };

  useEffect(() => {
    reloadSummary();
    reloadOverview();
    getClassOptions()
      .then((opts) => {
        // 非管理员且非主负责只展示所辖班级，避免出现选了也查不到数据的选项
        setClassOptions(
          isAdmin || isMentalOwner ? opts : opts.filter((c) => (authUser?.classIds ?? []).includes(c.id)),
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
      reloadOverview();
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
      reloadOverview();
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

  /* ---------- 心理访谈交互 ---------- */

  /** 访谈保存/作废后的统一刷新 */
  const afterInterviewChanged = (studentId?: string) => {
    setIvModal({ open: false, student: null, record: null, form: DEFAULT_INTERVIEW_FORM });
    reloadSummary();
    refresh();
    reloadOverview();
    if (studentId) {
      getMentalInterviews(String(studentId))
        .then(setIvView)
        .catch(() => undefined);
      getMentalLevelLogs(String(studentId))
        .then(setIvLevelLogs)
        .catch(() => undefined);
    }
  };

  /**
   * 行内「心理访谈」入口：
   * 本学期 0 条且可写 → 直接弹记录单；否则打开记录抽屉（查看/继续/补充）。
   */
  const openInterview = async (studentId: string) => {
    try {
      const view = await getMentalInterviews(String(studentId));
      const form = view.form ?? DEFAULT_INTERVIEW_FORM;
      if (view.done === 0 && view.canWrite) {
        setIvModal({ open: true, student: view.student, record: null, form });
        return;
      }
      setIvView(view);
      setIvLevelLogs([]);
      setIvDrawerOpen(true);
      getMentalLevelLogs(String(studentId))
        .then(setIvLevelLogs)
        .catch(() => undefined);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '访谈记录加载失败');
    }
  };

  const handleDeleteRecord = async (record: MentalInterview) => {
    setDeletingRecordId(record.id);
    try {
      const res = await deleteMentalInterview(record.id);
      message.success(`已作废该条记录（本学期剩余 ${res.done} 次；关注等级不回滚）`);
      afterInterviewChanged(record.studentId);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setDeletingRecordId(null);
    }
  };

  /** 横幅本学期忽略（key 带学期，跨学期自动重新提醒） */
  const bannerDismissKey = overview
    ? `mentalInterviewBannerDismissed:${authUser?.id ?? 0}:${overview.semester.key}`
    : '';
  const bannerVisible = !!overview
    && overview.pendingCount > 0
    && !bannerDismissed
    && !(bannerDismissKey && localStorage.getItem(bannerDismissKey));

  const dismissBanner = () => {
    if (bannerDismissKey) localStorage.setItem(bannerDismissKey, '1');
    setBannerDismissed(true);
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
      title: '心理访谈',
      key: 'interview',
      width: 150,
      render: (_, record) => {
        const done = record.interviewDone ?? 0;
        const required = record.interviewRequired || INTERVIEW_REQUIRED;
        // 显隐完全由服务端 canInterview 判定；done>0 时允许继续查看/补齐
        if (!record.canInterview && done === 0) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const color = done >= required ? 'green' : done > 0 ? 'orange' : 'red';
        // 无写权且已有记录（如「无需关注」留档学生）→ 只读查看
        const label = !record.canInterview && done > 0
          ? '查看记录'
          : done >= required ? '查看记录' : done > 0 ? '继续访谈' : '填写访谈';
        return (
          <Space size={4} wrap>
            <Tag color={color} style={{ marginInlineEnd: 0 }}>
              本学期 {done}/{required}
            </Tag>
            <Button type="link" size="small" onClick={() => openInterview(record.studentId)}>
              {label}
            </Button>
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      // 表格总宽 1240 在 1440/1280 分辨率下需横向滚动，操作列固定右侧避免按钮被裁切
      fixed: 'right',
      render: (_, record) => (
        <Space size={2} wrap>
          <Button type="link" size="small" onClick={() => openTalks(record)}>
            谈话记录
          </Button>
          {/* 新增谈话：管理员/辅导员角色 + 三类关注学生时可见；点击跳转学校外部谈话平台 */}
          {canWrite && TALK_RECORD_TARGET_LEVELS.includes(record.level) && (
            <Tooltip title="前往学校谈话平台填写谈话记录">
              <Button
                type="link"
                size="small"
                href={TALK_RECORD_EXTERNAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                icon={<ExportOutlined />}
              >
                新增谈话
              </Button>
            </Tooltip>
          )}
          {/* 关注写操作：严格口径 —— 管理员或心理健康主负责 */}
          {canMentalWrite && (
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
        subtitle={`按关注等级管理需要关注的学生；等级数据与谈心谈话记录联动（${
          isAdmin || isMentalOwner ? '全院学生可见' : '仅本班学生可见'
        }）`}
        extra={
          <Space>
            {canMentalWrite && (
              <Button icon={<FileTextOutlined />} onClick={() => setTplModalOpen(true)}>
                记录单模板
              </Button>
            )}
            {canMentalWrite && (
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                批量导入
              </Button>
            )}
            {canMentalWrite && (
              <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
                导出访谈记录
              </Button>
            )}
            {canMentalWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增关注
              </Button>
            )}
          </Space>
        }
      />

      {/* 数据范围提示：管理员不提示；主负责全院；普通带班只读；无带班引导 */}
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            isMentalOwner
              ? '数据范围：全院所有被标记关注的学生（心理健康主负责）。'
              : (authUser?.classIds ?? []).length > 0
                ? '数据范围：仅您所辖班级内被标记为需要关注的学生（只读）；新增/调整关注请联系心理健康主负责辅导员或管理员。'
                : '您尚未分配带班班级，暂无可查看的关注学生；如需维护关注标记请联系心理健康主负责辅导员或管理员。'
          }
        />
      )}

      {/* 心理访谈任务提醒：仅对持有访谈权限的角色展示（班主任/管理员/主负责） */}
      {bannerVisible && overview && (
        <Alert
          type={overview.semester.daysLeft <= 30 ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`${overview.semester.label}：${isAdmin || isMentalOwner ? '全院' : '您所辖班级'}有 ${overview.pendingCount} 名学生心理访谈未完成（每人至少 ${overview.required} 次${overview.semester.daysLeft <= 30 ? `，距学期结束还有 ${overview.semester.daysLeft} 天` : ''}）`}
          action={
            <Space size={4} wrap>
              <Button size="small" type="link" onClick={() => setPendingOpen(true)}>
                查看待完成
              </Button>
              <Button size="small" type="text" onClick={dismissBanner}>
                本学期不再提醒
              </Button>
            </Space>
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
        scroll={{ x: 1240 }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `共 ${t} 名关注学生`,
          onChange: (page, pageSize) => patchQuery(
            { page: pageSize === data.pageSize ? page : 1, pageSize },
            false,
          ),
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
                placeholder={isMentalOwner ? '输入姓名或学号搜索（全院未标记学生）' : '输入姓名或学号搜索（仅本班未标记学生）'}
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
            extra="记录关注事由与跟进安排（选填）"
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

      {/* 心理访谈记录抽屉 */}
      <Drawer
        title={ivView ? `心理访谈 · ${ivView.student.name}` : '心理访谈'}
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        open={ivDrawerOpen}
        onClose={() => setIvDrawerOpen(false)}
      >
        {ivView && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <Typography.Text type="secondary">
                {ivView.student.studentNo} · {ivView.student.className}
              </Typography.Text>
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>{ivView.semester.label}</Tag>
              <Tag
                color={ivView.done >= ivView.required ? 'green' : ivView.done > 0 ? 'orange' : 'red'}
                style={{ marginInlineEnd: 0 }}
              >
                本学期 {ivView.done}/{ivView.required} 次
              </Tag>
            </div>

            {ivView.canWrite && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ marginBottom: 12 }}
                onClick={() => setIvModal({ open: true, student: ivView.student, record: null, form: ivView.form })}
              >
                {ivView.done >= ivView.required ? '补充访谈' : '新增访谈'}
              </Button>
            )}

            {ivView.list.length === 0 ? (
              <Empty description="本学期暂无访谈记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              ivView.list.map((r) => {
                const canEditRecord = isAdmin || Number(r.interviewerId) === Number(authUser?.id);
                return (
                  <div
                    key={r.id}
                    style={{ border: '1px solid #e5e9f2', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}
                  >
                    <Space size={6} wrap style={{ marginBottom: 4 }}>
                      <Tag color="blue" style={{ marginInlineEnd: 0 }}>{r.interviewDate}</Tag>
                      <Tag color={r.levelAfter === '无需关注' ? 'default' : 'orange'} style={{ marginInlineEnd: 0 }}>
                        评估：{r.levelAfter}
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        访谈教师 {r.interviewerName}
                      </Typography.Text>
                    </Space>
                    <div style={{ lineHeight: 1.7, marginBottom: 6 }}>{r.summary}</div>
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#5b7bd5' }}>查看全部问答</summary>
                      <div style={{ marginTop: 8 }}>
                        {recordQaPairs(r, recordFormOf(r, ivView.form)).map((qa) => (
                          <div key={qa.key} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: '#8a94ad' }}>{qa.question}</div>
                            <div style={{ fontSize: 13, lineHeight: 1.7 }}>{qa.answer}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        签字：{r.signatureName} · {r.signedAt}
                      </Typography.Text>
                      {r.updatedBy && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          （修订 by {r.updatedBy}）
                        </Typography.Text>
                      )}
                      {canEditRecord && (
                        <Space size={4} style={{ marginLeft: 'auto' }}>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => setIvModal({ open: true, student: ivView.student, record: r, form: ivView.form })}
                          >
                            编辑
                          </Button>
                          <Popconfirm
                            title="作废这条访谈记录？"
                            description="作废后本学期计数回退，关注等级不会回滚"
                            okText="作废"
                            cancelText="取消"
                            onConfirm={() => handleDeleteRecord(r)}
                          >
                            <Button type="link" size="small" danger loading={deletingRecordId === r.id}>
                              作废
                            </Button>
                          </Popconfirm>
                        </Space>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            <Typography.Title level={5} style={{ marginTop: 18, marginBottom: 8, fontSize: 14 }}>
              关注等级变更
            </Typography.Title>
            {ivLevelLogs.length === 0 ? (
              <Typography.Text type="secondary">暂无变更记录</Typography.Text>
            ) : (
              <Timeline
                items={ivLevelLogs.map((l) => ({
                  color: l.source === 'interview-delete' ? 'red' : 'blue',
                  children: (
                    <div style={{ paddingBottom: 6 }}>
                      <Space size={6} wrap style={{ marginBottom: 2 }}>
                        <Tag color={LEVEL_LOG_SOURCE_COLORS[l.source]} style={{ marginInlineEnd: 0 }}>
                          {LEVEL_LOG_SOURCE_LABELS[l.source]}
                        </Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{l.createdAt}</Typography.Text>
                      </Space>
                      <div style={{ fontSize: 13 }}>
                        {levelLogText(l.fromLevel)} → {levelLogText(l.toLevel)}
                      </div>
                      {l.note && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{l.note}</Typography.Text>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </>
        )}
      </Drawer>

      {/* 本学期待完成名单 */}
      <Modal
        title="本学期心理访谈待完成"
        open={pendingOpen}
        footer={null}
        onCancel={() => setPendingOpen(false)}
        width={isMobile ? 'calc(100vw - 24px)' : 560}
      >
        {(overview?.pending ?? []).length === 0 ? (
          <Empty description="本学期全部达标" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          (overview?.pending ?? []).map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                padding: '8px 0',
                borderBottom: '1px solid #eef1f7',
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <Typography.Text type="secondary">{p.className}</Typography.Text>
              {p.level && <Tag style={{ marginInlineEnd: 0 }}>{p.level}</Tag>}
              <Tag
                color={p.done >= p.required ? 'green' : p.done > 0 ? 'orange' : 'red'}
                style={{ marginInlineEnd: 0 }}
              >
                {p.done}/{p.required}
              </Tag>
              <Button
                type="link"
                size="small"
                style={{ marginLeft: 'auto' }}
                disabled={!p.canWrite}
                onClick={() => {
                  setPendingOpen(false);
                  openInterview(String(p.id));
                }}
              >
                {p.done > 0 ? '继续访谈' : '填写访谈'}
              </Button>
            </div>
          ))
        )}
      </Modal>

      {/* 心理访谈记录单（新增 / 修订） */}
      <InterviewFormModal
        open={ivModal.open}
        student={ivModal.student}
        record={ivModal.record}
        form={ivModal.form}
        onClose={() => setIvModal({ open: false, student: null, record: null, form: DEFAULT_INTERVIEW_FORM })}
        onSaved={() => afterInterviewChanged(ivModal.student?.id ?? ivModal.record?.studentId)}
      />

      {/* 心理访谈记录单模板（管理员/心理主负责） */}
      <TemplateManageModal open={tplModalOpen} onClose={() => setTplModalOpen(false)} />

      {/* 批量导入关注学生（管理员/心理主负责） */}
      <ImportConcernDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          reloadSummary();
          refresh();
          reloadOverview();
        }}
      />

      {/* 批量导出访谈记录（管理员/心理主负责） */}
      <ExportInterviewDialog open={exportOpen} onClose={() => setExportOpen(false)} />
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

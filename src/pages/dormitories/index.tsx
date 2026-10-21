import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  InboxOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Descriptions,
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
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  batchDeleteDormitories,
  createDormitory,
  deleteDormitory,
  getDormitories,
  getDormitoryOptions,
  importDormitories,
  updateDormitory,
} from '@/api/dormitory';
import type { DormitoryQuery } from '@/api/dormitory';
import { getClassOptions, getGradeOptions } from '@/api/classes';
import { getStudentOptions } from '@/api/student';
import PageHeader from '@/components/PageHeader';
import { canManageStudentFront, getStoredUser, isModuleOwner, subscribeSession } from '@/lib/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { exportDormitories, fetchAllDormitories } from '@/utils/dormExport';
import { formatDorm, MAX_BUILDING, MAX_ROOM } from '@/utils/dormitory';
import {
  downloadDormTemplate,
  exportDormImportFailures,
  parseDormExcel,
  validateDormRows,
} from '@/utils/dormImport';
import type {
  ClassOption,
  DormImportFailure,
  DormImportResult,
  Dormitory,
  DormitoryOptions,
  GradeOption,
  ParsedDormRow,
  StudentOption,
} from '@/types';
import DormitoriesMobile from './mobile';

interface DormFormValues {
  studentNo: string;
  building: string;
  room: string;
}

/** 宿舍楼 / 房间号 输入框的公共约束 */
const BUILDING_RULES = [
  { required: true, message: '请输入宿舍楼' },
  { max: MAX_BUILDING, message: `宿舍楼不可超过 ${MAX_BUILDING} 个字` },
];
const ROOM_RULES = [
  { required: true, message: '请输入房间号' },
  { max: MAX_ROOM, message: `房间号不可超过 ${MAX_ROOM} 个字` },
];

/**
 * 寝室管理（桌面端）：宿舍楼 + 房间号 的集中维护。
 * 列表支持 学号 / 姓名 / 班级 / 宿舍楼 / 房间号 五项模糊查询与分页，
 * 提供新增、编辑、删除、查看与批量导入；姓名/班级/年级/性别一律读取学生名册。
 */
function DormitoriesDesktop() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<DormFormValues>();
  /** 角色/带班范围变更后实时重算操作按钮显隐（布局层刷新会话时广播） */
  const [authUser, setAuthUser] = useState(getStoredUser);

  const { query, patchQuery, data, loading, refresh } = useList<Dormitory, DormitoryQuery>(
    getDormitories,
    { page: 1, pageSize: 10 },
  );

  /* ---------- 筛选：三个文本输入（防抖）+ 年级/多班级/宿舍楼下拉 ---------- */
  const [studentNoInput, setStudentNoInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [options, setOptions] = useState<DormitoryOptions>({ buildings: [], classNames: [] });
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);

  /* ---------- 批量选择 / 导出 / 删除 ---------- */
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);

  /* ---------- 表单状态 ---------- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Dormitory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Dormitory | null>(null);

  /* ---------- 批量导入状态 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<{
    fileName: string;
    totalRows: number;
    valid: ParsedDormRow[];
    failures: DormImportFailure[];
  } | null>(null);
  const [importResult, setImportResult] = useState<DormImportResult | null>(null);

  useEffect(() => subscribeSession(setAuthUser), []);

  /** 批量导入为高影响写入：仅寝室管理主负责辅导员 / 管理员可用（与服务端口径一致） */
  const isDormOwner = isModuleOwner(authUser, 'dormitories');

  const loadOptions = () => {
    getDormitoryOptions().then(setOptions).catch(() => undefined);
    getStudentOptions().then(setStudentOptions).catch(() => undefined);
  };
  useEffect(loadOptions, []);

  /* 年级/班级字典（由「班级管理」维护），仅需加载一次 */
  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

  /** 年级与班级联动：选了年级只展示该年级下的班级 */
  const filterGradeId = useMemo(
    () => (query.grade ? gradeOptions.find((g) => g.name === query.grade)?.id : undefined),
    [query.grade, gradeOptions],
  );
  const filterClassOptions = useMemo(
    () => classOptions
      .filter((c) => filterGradeId === undefined || c.gradeId === filterGradeId)
      .map((c) => ({
        value: c.id,
        label: filterGradeId === undefined ? `${c.gradeName} · ${c.name}` : c.name,
      })),
    [classOptions, filterGradeId],
  );

  /** 筛选条件变化后清空选择，避免「看不见的记录」被批量删除 */
  const classIdsKey = query.classIds?.join(',') ?? '';
  useEffect(() => {
    setSelectedKeys([]);
  }, [query.studentNo, query.name, query.className, query.grade, classIdsKey, query.building, query.room]);

  /** 文本筛选防抖 400ms：避免逐字请求，同时保证「输入即查」的模糊查询体验 */
  const appliedRef = useRef({ studentNo: '', name: '', room: '' });
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = {
        studentNo: studentNoInput.trim(),
        name: nameInput.trim(),
        room: roomInput.trim(),
      };
      const prev = appliedRef.current;
      if (next.studentNo === prev.studentNo && next.name === prev.name && next.room === prev.room) return;
      appliedRef.current = next;
      patchQuery({
        studentNo: next.studentNo || undefined,
        name: next.name || undefined,
        room: next.room || undefined,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [studentNoInput, nameInput, roomInput, patchQuery]);

  const openImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    if (importResult && importResult.successCount > 0) {
      refresh();
      loadOptions();
    }
  };

  const resetImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
  };

  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseDormExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const { valid, failures } = validateDormRows(rows);
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
      const result = await importDormitories(parsed.valid);
      setImportResult(result);
      setImportDone(true);
      message.success(
        `新增 ${result.insertedCount}、更新 ${result.updatedCount}、跳过 ${result.skippedCount} 条寝室分配`,
      );
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 导入时被服务端二次驳回的记录，合并展示/导出 */
  const allFailures: DormImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ studentNo: editing.studentNo, building: editing.building, room: editing.room });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openEdit = (record: Dormitory) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: DormFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateDormitory(editing.id, { building: values.building.trim(), room: values.room.trim() });
        message.success('寝室信息已更新');
      } else {
        await createDormitory({
          studentNo: values.studentNo.trim(),
          building: values.building.trim(),
          room: values.room.trim(),
        });
        message.success('新增寝室分配成功');
      }
      setModalOpen(false);
      refresh();
      loadOptions();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: Dormitory) => {
    try {
      await deleteDormitory(record.id);
      message.success('删除成功');
      refresh();
      loadOptions();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const currentFilter = () => ({
    studentNo: query.studentNo,
    name: query.name,
    className: query.className,
    grade: query.grade,
    classIds: query.classIds,
    building: query.building,
    room: query.room,
    keyword: query.keyword,
  });

  /** 批量导出：有勾选导出勾选项，否则导出当前筛选条件下的全部数据 */
  const handleBatchExport = async () => {
    if (selectedKeys.length === 0 && data.total === 0) {
      message.warning('当前没有可导出的寝室分配');
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAllDormitories(currentFilter());
      const selected = new Set(selectedKeys);
      const targets = selectedKeys.length > 0 ? rows.filter((r) => selected.has(r.id)) : rows;
      if (targets.length === 0) {
        message.warning('没有可导出的寝室分配');
        return;
      }
      exportDormitories(targets, authUser?.displayName);
      message.success(`已导出 ${targets.length} 条寝室分配`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedKeys.length === 0) return;
    modal.confirm({
      title: `确定删除选中的 ${selectedKeys.length} 条寝室分配吗？`,
      content: '删除后学生名册的「宿舍」将显示为未分配，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await batchDeleteDormitories(selectedKeys);
          message.success(`已删除 ${res.deletedCount} 条寝室分配`);
          setSelectedKeys([]);
          refresh();
          loadOptions();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量删除失败');
        }
      },
    });
  };

  const resetFilters = () => {
    setStudentNoInput('');
    setNameInput('');
    setRoomInput('');
    appliedRef.current = { studentNo: '', name: '', room: '' };
    patchQuery({
      studentNo: undefined,
      name: undefined,
      room: undefined,
      className: undefined,
      grade: undefined,
      classIds: undefined,
      building: undefined,
    });
  };

  /** 表单内实时预览：宿舍楼 + 房间号 的合并展示（与名册显示口径一致） */
  const watchedBuilding = Form.useWatch('building', form);
  const watchedRoom = Form.useWatch('room', form);
  const preview = formatDorm(watchedBuilding, watchedRoom);

  const columns: ColumnsType<Dormitory> = [
    { title: '学号', dataIndex: 'studentNo', width: 120 },
    { title: '姓名', dataIndex: 'name', width: 90 },
    { title: '班级', dataIndex: 'className', width: 110, ellipsis: true, render: (v?: string) => v || '—' },
    { title: '年级', dataIndex: 'grade', width: 90, render: (v?: string) => v || '—' },
    { title: '性别', dataIndex: 'gender', width: 70, render: (v?: string) => v || '—' },
    { title: '宿舍楼', dataIndex: 'building', width: 110 },
    { title: '房间号', dataIndex: 'room', width: 90 },
    {
      title: '宿舍',
      key: 'dorm',
      width: 130,
      render: (_, record) => formatDorm(record.building, record.room) || '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 170,
      fixed: 'right',
      render: (_, record) => {
        const canManage = canManageStudentFront(authUser, record.classId);
        return (
          <Space size={0}>
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>
              查看
            </Button>
            {canManage && (
              <Button type="link" size="small" onClick={() => openEdit(record)}>
                编辑
              </Button>
            )}
            {canManage && (
              <Popconfirm
                title="确定删除该寝室分配吗？"
                description="删除后学生名册的「宿舍」将显示为未分配"
                onConfirm={() => handleDelete(record)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="寝室管理"
        subtitle="集中维护学生宿舍分配：宿舍楼与房间号按学号维护，学生名册「宿舍」按「宿舍楼+房间号」读取本模块数据"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="学号"
          style={{ width: 150 }}
          value={studentNoInput}
          onChange={(e) => setStudentNoInput(e.target.value)}
        />
        <Input
          allowClear
          placeholder="姓名"
          style={{ width: 130 }}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
        <Select
          placeholder="年级"
          allowClear
          style={{ minWidth: 110 }}
          options={gradeOptions.map((g) => ({ value: g.name, label: g.name }))}
          value={query.grade}
          onChange={(grade) => patchQuery({ grade, classIds: undefined })}
        />
        <Select
          mode="multiple"
          placeholder="班级（可多选）"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200, maxWidth: 320 }}
          popupMatchSelectWidth={false}
          popupClassName="class-filter-select-popup"
          options={filterClassOptions}
          value={query.classIds}
          onChange={(classIds) => patchQuery({ classIds: classIds.length > 0 ? classIds : undefined })}
          disabled={filterClassOptions.length === 0}
        />
        <Select
          placeholder="宿舍楼"
          allowClear
          showSearch
          style={{ minWidth: 130 }}
          options={options.buildings.map((b) => ({ value: b, label: b }))}
          value={query.building}
          onChange={(building) => patchQuery({ building })}
        />
        <Input
          allowClear
          placeholder="房间号"
          style={{ width: 120 }}
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        <Button
          icon={<DownloadOutlined />}
          loading={exporting}
          disabled={data.total === 0 && selectedKeys.length === 0}
          onClick={() => void handleBatchExport()}
        >
          批量导出{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
        </Button>
        <Button
          danger
          icon={<DeleteOutlined />}
          disabled={selectedKeys.length === 0}
          onClick={handleBatchDelete}
        >
          批量删除{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
        </Button>
        {isDormOwner && (
          <Button icon={<UploadOutlined />} onClick={openImport}>
            批量导入
          </Button>
        )}
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields();
            setEditing(null);
            setModalOpen(true);
          }}
        >
          新增分配
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1080 }}
        locale={{ emptyText: '暂无寝室分配数据，可点击「新增分配」或「批量导入」录入' }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onChange: (keys) => setSelectedKeys(keys.map(Number)),
          getCheckboxProps: (record) => ({
            disabled: !canManageStudentFront(authUser, record.classId),
          }),
        }}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条寝室分配`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 新增 / 编辑寝室分配 */}
      <Modal
        title={editing ? '编辑寝室分配' : '新增寝室分配'}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="studentNo"
            label="学生"
            rules={[{ required: true, message: '请选择学生' }]}
            extra={editing ? '学号归属不可修改，如需调整请先删除该分配' : undefined}
          >
            <Select
              showSearch
              disabled={!!editing}
              placeholder="按姓名或学号搜索学生"
              optionFilterProp="label"
              options={studentOptions.map((s) => ({
                value: s.studentNo,
                label: `${s.name}（${s.studentNo}）${s.className ? ` · ${s.className}` : ''}`,
              }))}
              notFoundContent={studentOptions.length === 0 ? '在读学生为空，请先在「学生名册」录入' : '未找到匹配的学生'}
            />
          </Form.Item>
          <Form.Item name="building" label="宿舍楼" rules={BUILDING_RULES}>
            <AutoComplete
              placeholder="如 荷园B"
              maxLength={MAX_BUILDING}
              options={options.buildings.map((b) => ({ value: b }))}
              filterOption={(input, option) =>
                String(option?.value ?? '').toUpperCase().includes(input.toUpperCase())
              }
            />
          </Form.Item>
          <Form.Item name="room" label="房间号" rules={ROOM_RULES}>
            <Input placeholder="如 512" maxLength={MAX_ROOM} />
          </Form.Item>
          <Typography.Text type="secondary">
            学生名册中的「宿舍」将显示为：
            <Typography.Text strong>{preview || '（待填写宿舍楼与房间号）'}</Typography.Text>
          </Typography.Text>
        </Form>
      </Modal>

      {/* 查看详情 */}
      <Modal
        title="寝室分配详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setDetail(null)}>
            关闭
          </Button>,
        ]}
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="学号">{detail.studentNo}</Descriptions.Item>
            <Descriptions.Item label="姓名">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="班级">{detail.className || '—'}</Descriptions.Item>
            <Descriptions.Item label="年级">{detail.grade || '—'}</Descriptions.Item>
            <Descriptions.Item label="性别">{detail.gender || '—'}</Descriptions.Item>
            <Descriptions.Item label="宿舍楼">{detail.building}</Descriptions.Item>
            <Descriptions.Item label="房间号">{detail.room}</Descriptions.Item>
            <Descriptions.Item label="宿舍">
              {formatDorm(detail.building, detail.room)}
            </Descriptions.Item>
            <Descriptions.Item label="最近更新">
              {detail.updatedBy ? `${detail.updatedBy} · ${detail.updatedAt ?? ''}` : (detail.updatedAt ?? '—')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 批量导入寝室分配 */}
      <Modal
        title="批量导入寝室分配"
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
                  {parsed ? `确认导入 ${parsed.valid.length} 条` : '确认导入'}
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="import-step">
            <div className="import-step-title">① 下载并填写模板</div>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={downloadDormTemplate}>
                下载 Excel 模板
              </Button>
              <Typography.Text type="secondary">
                学号须已在「学生名册」中存在；姓名/班级/年级/性别 选填，填写时须与名册一致
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
                    ? `处理完成：新增 ${importResult?.insertedCount ?? 0}、更新 ${importResult?.updatedCount ?? 0}、跳过 ${importResult?.skippedCount ?? 0} 条，失败 ${allFailures.length} 行。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 条，${parsed.failures.length} 行存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未处理，可导出失败明细修正后重新上传。'
                      : '全部数据处理成功（新增/更新/跳过）。'
                    : allFailures.length > 0
                      ? '导入按学号 upsert：无记录则新增，已有记录且宿舍有变化则更新，完全相同自动跳过；可导出失败明细修正后重新上传。'
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
                      { title: '宿舍楼', dataIndex: 'building', width: 100 },
                      { title: '房间号', dataIndex: 'room', width: 90 },
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
                    onClick={() => exportDormImportFailures(allFailures)}
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
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 筛选抽屉），桌面端沿用本组件。
 */
export default function Dormitories() {
  const isMobile = useIsMobile();
  return isMobile ? <DormitoriesMobile /> : <DormitoriesDesktop />;
}

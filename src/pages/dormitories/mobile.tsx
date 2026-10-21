import { App, Button, Descriptions, Form, Input, Modal, Popconfirm, Select, Upload } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  batchDeleteDormitories,
  createDormitory,
  deleteDormitory,
  getDormitories,
  getDormitoryOptions,
  importDormitories,
  updateDormitory,
} from '@/api/dormitory';
import { getClassOptions, getGradeOptions } from '@/api/classes';
import { getStudentOptions } from '@/api/student';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { canManageStudentFront, getStoredUser, isModuleOwner, subscribeSession } from '@/lib/auth';
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

const PAGE_SIZE = 20;

interface DormFormValues {
  studentNo: string;
  building: string;
  room: string;
}

/**
 * 移动端寝室管理：搜索常驻（学号 / 姓名 / 房间号）+ 筛选抽屉（班级 / 宿舍楼）+ 卡片列表。
 * 卡片首屏必读：姓名 · 学号 · 宿舍（宿舍楼+房间号）；操作区三等分：查看 / 编辑 / 删除。
 * 复用 mobile.css 现有令牌（m-card / m-btn / m-tag / FilterSheet），不新增样式。
 */
export default function DormitoriesMobile() {
  const { message, modal } = App.useApp();
  const [authUser, setAuthUser] = useState(getStoredUser);

  /* ---------- 列表 ---------- */
  const [list, setList] = useState<Dormitory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [grade, setGrade] = useState<string | undefined>(undefined);
  const [classIds, setClassIds] = useState<number[]>([]);
  const [building, setBuilding] = useState<string | undefined>(undefined);
  const [draftGrade, setDraftGrade] = useState<string | undefined>(undefined);
  const [draftClassIds, setDraftClassIds] = useState<number[]>([]);
  const [draftBuilding, setDraftBuilding] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [options, setOptions] = useState<DormitoryOptions>({ buildings: [], classNames: [] });
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);

  /* ---------- 批量选择 / 导出 / 删除 ---------- */
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);

  /* ---------- 表单与详情 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Dormitory | null>(null);
  const [detail, setDetail] = useState<Dormitory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<DormFormValues>();

  /* ---------- 批量导入 ---------- */
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

  const loadOptions = useCallback(() => {
    getDormitoryOptions().then(setOptions).catch(() => undefined);
    getStudentOptions().then(setStudentOptions).catch(() => undefined);
  }, []);

  /* 年级/班级字典（由「班级管理」维护），仅需加载一次 */
  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

  /** 筛选抽屉内：班级选项随所选年级联动 */
  const draftGradeId = useMemo(
    () => (draftGrade ? gradeOptions.find((g) => g.name === draftGrade)?.id : undefined),
    [draftGrade, gradeOptions],
  );
  const draftClassOptions = useMemo(
    () => classOptions.filter((c) => draftGradeId === undefined || c.gradeId === draftGradeId),
    [classOptions, draftGradeId],
  );
  const selectedClassNames = useMemo(
    () => classOptions.filter((c) => classIds.includes(c.id)).map((c) => c.name),
    [classOptions, classIds],
  );

  const loadList = useCallback(
    async (targetPage: number, kw: string, g?: string, cids: number[] = [], bd?: string) => {
      setLoading(true);
      try {
        const res = await getDormitories({
          page: targetPage,
          pageSize: PAGE_SIZE,
          keyword: kw || undefined,
          grade: g,
          classIds: cids.length > 0 ? cids : undefined,
          building: bd,
        });
        setList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
        setTotal(res.total);
        setPage(targetPage);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  /* 关键词防抖 300ms；筛选条件变化立即回到第 1 页 */
  const firstRun = useRef(true);
  const classIdsKey = classIds.join(',');

  /* 筛选条件变化后退出批量选择并清空选择，避免误删不可见记录 */
  useEffect(() => {
    setSelectedIds([]);
    setBatchMode(false);
  }, [keyword, grade, classIdsKey, building]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void loadList(1, keyword, grade, classIds, building);
      return;
    }
    const timer = setTimeout(() => void loadList(1, keyword, grade, classIds, building), 300);
    return () => clearTimeout(timer);
  }, [keyword, grade, classIds, building, loadList]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadList(page + 1, keyword, grade, classIds, building);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, keyword, grade, classIds, building, loadList]);

  const reloadAll = () => {
    void loadList(1, keyword, grade, classIds, building);
    loadOptions();
  };

  /* ---------- 表单 ---------- */
  const openForm = (record?: Dormitory) => {
    setEditing(record ?? null);
    if (record) {
      form.setFieldsValue({ studentNo: record.studentNo, building: record.building, room: record.room });
    } else {
      form.resetFields();
    }
    setFormOpen(true);
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
      setFormOpen(false);
      reloadAll();
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
      reloadAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pageManageableIds = list
    .filter((d) => canManageStudentFront(authUser, d.classId))
    .map((d) => d.id);
  const allPageSelected = pageManageableIds.length > 0 && pageManageableIds.every((id) => selectedIds.includes(id));

  const toggleSelectPage = () => {
    setSelectedIds((prev) => (allPageSelected
      ? prev.filter((id) => !pageManageableIds.includes(id))
      : [...new Set([...prev, ...pageManageableIds])]));
  };

  const currentFilter = () => ({
    keyword: keyword || undefined,
    grade,
    classIds: classIds.length > 0 ? classIds : undefined,
    building,
  });

  /** 批量导出：有勾选导出勾选项，否则导出当前筛选条件下的全部数据 */
  const handleBatchExport = async () => {
    if (selectedIds.length === 0 && total === 0) {
      message.warning('当前没有可导出的寝室分配');
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAllDormitories(currentFilter());
      const selected = new Set(selectedIds);
      const targets = selectedIds.length > 0 ? rows.filter((r) => selected.has(r.id)) : rows;
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
    if (selectedIds.length === 0) return;
    modal.confirm({
      title: `确定删除选中的 ${selectedIds.length} 条寝室分配吗？`,
      content: '删除后学生名册的「宿舍」将显示为未分配，操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await batchDeleteDormitories(selectedIds);
          message.success(`已删除 ${res.deletedCount} 条寝室分配`);
          setSelectedIds([]);
          setBatchMode(false);
          reloadAll();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量删除失败');
        }
      },
    });
  };

  /* ---------- 批量导入 ---------- */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseDormExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const { valid, failures } = validateDormRows(rows);
      setParsed({ fileName: file.name, totalRows: rows.length, valid, failures });
      if (valid.length === 0) message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
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
      reloadAll();
    } finally {
      setImporting(false);
    }
  };

  const allFailures: DormImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  const watchedBuilding = Form.useWatch('building', form);
  const watchedRoom = Form.useWatch('room', form);
  const preview = formatDorm(watchedBuilding, watchedRoom);

  return (
    <>
      <div className="m-search-row">
        <div className="m-search-field">
          <MIcon name="search" size={16} />
          <input
            className="m-inp"
            type="search"
            value={keyword}
            placeholder="搜索学号 / 姓名 / 房间号"
            aria-label="搜索寝室分配"
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="m-btn m-btn-ghost"
          onClick={() => {
            setDraftGrade(grade);
            setDraftClassIds(classIds);
            setDraftBuilding(building);
            setSheetOpen(true);
          }}
        >
          <MIcon name="funnel" size={16} />
          筛选
        </button>
      </div>

      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {batchMode ? (
            <>已选 <b>{selectedIds.length}</b> 条</>
          ) : (
            <>
              共 {total} 条寝室分配
              {grade ? ` · ${grade}` : ''}
              {selectedClassNames.length > 0 ? ` · ${selectedClassNames.join('、')}` : ''}
              {building ? ` · ${building}` : ''}
            </>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            disabled={exporting || (total === 0 && selectedIds.length === 0)}
            onClick={() => void handleBatchExport()}
          >
            <MIcon name="download" size={14} />
            {exporting ? '导出中…' : '批量导出'}
          </button>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            style={{ color: 'var(--danger-fg)' }}
            disabled={selectedIds.length === 0}
            onClick={handleBatchDelete}
          >
            <MIcon name="trash" size={14} />
            批量删除
          </button>
          {batchMode ? (
            <>
              <button type="button" className="m-btn m-btn-soft" onClick={toggleSelectPage}>
                {allPageSelected ? '取消本页' : '全选本页'}
              </button>
              <button
                type="button"
                className="m-btn m-btn-ghost"
                onClick={() => {
                  setBatchMode(false);
                  setSelectedIds([]);
                }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button type="button" className="m-btn m-btn-soft" onClick={() => openForm()}>
                <MIcon name="plus" size={14} />
                新增
              </button>
              {isDormOwner && (
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  onClick={() => {
                    setParsed(null);
                    setImportResult(null);
                    setImportDone(false);
                    setImportOpen(true);
                  }}
                >
                  <MIcon name="upload" size={14} />
                  导入
                </button>
              )}
              <button type="button" className="m-btn m-btn-ghost" onClick={() => setBatchMode(true)}>
                <MIcon name="check" size={14} />
                选择
              </button>
            </>
          )}
        </div>
      </div>

      {list.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="home" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>没有符合条件的寝室分配</div>
          <div className="m-t4" style={{ marginTop: 4 }}>
            可点击「新增」逐条录入，或「导入」批量上传
          </div>
        </div>
      ) : (
        list.map((d) => {
          const canManage = canManageStudentFront(authUser, d.classId);
          const selectable = batchMode && canManage;
          const checked = selectedIds.includes(d.id);
          return (
            <div
              className={`m-card${selectable ? ' press' : ''}`}
              key={d.id}
              role={selectable ? 'button' : undefined}
              tabIndex={selectable ? 0 : undefined}
              aria-label={selectable ? `${checked ? '取消选择' : '选择'} ${d.name} 的寝室分配` : undefined}
              onClick={selectable ? () => toggleSelect(d.id) : undefined}
              onKeyDown={selectable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelect(d.id);
                    }
                  }
                : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectable && (
                  <span className="m-check" aria-hidden="true">
                    <input type="checkbox" className="m-cbx" checked={checked} readOnly tabIndex={-1} />
                    <span className="m-box">
                      <MIcon name="check" size={14} />
                    </span>
                  </span>
                )}
                <span className="m-ava">{d.name.slice(0, 1)}</span>
                <div className="m-row-main" style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{d.name}</span>
                    {d.gender && <span className="m-tag neutral">{d.gender}</span>}
                  </div>
                  <div className="m-t3" style={{ marginTop: 3 }}>
                    {d.studentNo}
                    {d.className ? ` · ${d.className}` : ''}
                    {d.grade ? ` · ${d.grade}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                  <div className="m-t1">{formatDorm(d.building, d.room)}</div>
                  <div className="m-t4" style={{ marginTop: 2 }}>
                    {d.building} · {d.room}
                  </div>
                </div>
              </div>
              {!batchMode && (
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    marginTop: 6,
                    borderTop: '1px solid var(--m-border)',
                    paddingTop: 4,
                  }}
                >
                  <a
                    className="m-act"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetail(d);
                    }}
                    aria-label={`查看 ${d.name} 的寝室信息`}
                  >
                    <MIcon name="eye" size={18} />
                    查看
                  </a>
                  {canManage && (
                    <a
                      className="m-act"
                      onClick={(e) => {
                        e.stopPropagation();
                        openForm(d);
                      }}
                      aria-label={`编辑 ${d.name} 的寝室信息`}
                    >
                      <MIcon name="edit" size={18} />
                      编辑
                    </a>
                  )}
                  {canManage && (
                    <Popconfirm
                      title="确定删除该寝室分配吗？"
                      description="删除后学生名册的「宿舍」将显示为未分配"
                      onConfirm={() => void handleDelete(d)}
                    >
                      <a
                        className="m-act danger"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`删除 ${d.name} 的寝室分配`}
                      >
                        <MIcon name="trash" size={18} />
                        删除
                      </a>
                    </Popconfirm>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {loading && (
        <div className="m-loadmore">
          <MIcon name="spinner" size={16} className="m-spin" />
          加载中…
        </div>
      )}

      <div ref={sentinel} style={{ height: 1 }} />
      {!loading && hasMore && (
        <button
          type="button"
          className="m-btn m-btn-ghost m-btn-block"
          onClick={() => void loadList(page + 1, keyword, grade, classIds, building)}
        >
          加载更多（还有 {total - list.length} 条）
        </button>
      )}
      {!hasMore && list.length > 0 && (
        <div className="m-loadmore">已加载全部 {total} 条</div>
      )}

      {/* 班级 / 宿舍楼 筛选抽屉 */}
      <FilterSheet
        open={sheetOpen}
        title="筛选寝室分配"
        onClose={() => setSheetOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="m-btn m-btn-ghost"
              onClick={() => {
                setDraftGrade(undefined);
                setDraftClassIds([]);
                setDraftBuilding(undefined);
                setGrade(undefined);
                setClassIds([]);
                setBuilding(undefined);
                setSheetOpen(false);
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              onClick={() => {
                setGrade(draftGrade);
                setClassIds(draftClassIds);
                setBuilding(draftBuilding);
                setSheetOpen(false);
              }}
            >
              确定
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>年级</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`m-seg-btn${!draftGrade ? ' on' : ''}`}
              style={{ flex: '0 0 auto' }}
              onClick={() => {
                setDraftGrade(undefined);
                setDraftClassIds([]);
              }}
            >
              全部
            </button>
            {gradeOptions.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`m-seg-btn${draftGrade === g.name ? ' on' : ''}`}
                style={{ flex: '0 0 auto' }}
                onClick={() => {
                  setDraftGrade(g.name);
                  setDraftClassIds([]);
                }}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
        <div className="m-field" style={{ marginTop: 14 }}>
          <label>班级{draftClassIds.length > 0 ? `（已选 ${draftClassIds.length} 个）` : '（可多选，支持搜索）'}</label>
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="输入关键字搜索班级"
            style={{ width: '100%' }}
            options={draftClassOptions.map((c) => ({
              value: c.id,
              label: draftGrade ? c.name : `${c.gradeName} · ${c.name}`,
            }))}
            value={draftClassIds}
            onChange={(ids) => setDraftClassIds(ids)}
            disabled={draftClassOptions.length === 0}
            notFoundContent="该年级下暂无可选班级"
          />
        </div>
        <div className="m-field" style={{ marginTop: 14 }}>
          <label>宿舍楼</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`m-seg-btn${!draftBuilding ? ' on' : ''}`}
              style={{ flex: '0 0 auto' }}
              onClick={() => setDraftBuilding(undefined)}
            >
              全部
            </button>
            {options.buildings.map((b) => (
              <button
                key={b}
                type="button"
                className={`m-seg-btn${draftBuilding === b ? ' on' : ''}`}
                style={{ flex: '0 0 auto' }}
                onClick={() => setDraftBuilding(b)}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </FilterSheet>

      {/* 新增 / 编辑 */}
      <Modal
        title={editing ? '编辑寝室分配' : '新增寝室分配'}
        open={formOpen}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="studentNo"
            label="学生"
            rules={[{ required: true, message: '请选择学生' }]}
          >
            <Select
              showSearch
              disabled={!!editing}
              placeholder="按姓名或学号搜索"
              optionFilterProp="label"
              options={studentOptions.map((s) => ({
                value: s.studentNo,
                label: `${s.name}（${s.studentNo}）${s.className ? ` · ${s.className}` : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="building"
            label="宿舍楼"
            rules={[
              { required: true, message: '请输入宿舍楼' },
              { max: MAX_BUILDING, message: `宿舍楼不可超过 ${MAX_BUILDING} 个字` },
            ]}
          >
            <Input placeholder="如 荷园B" maxLength={MAX_BUILDING} />
          </Form.Item>
          <Form.Item
            name="room"
            label="房间号"
            rules={[
              { required: true, message: '请输入房间号' },
              { max: MAX_ROOM, message: `房间号不可超过 ${MAX_ROOM} 个字` },
            ]}
          >
            <Input placeholder="如 512" maxLength={MAX_ROOM} />
          </Form.Item>
          <div className="m-t4">
            学生名册中的「宿舍」将显示为：<b>{preview || '（待填写）'}</b>
          </div>
        </Form>
      </Modal>

      {/* 查看详情 */}
      <Modal
        title="寝室分配详情"
        open={!!detail}
        width="calc(100vw - 24px)"
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
            <Descriptions.Item label="宿舍">{formatDorm(detail.building, detail.room)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 批量导入 */}
      <Modal
        title="批量导入寝室分配"
        open={importOpen}
        width="calc(100vw - 24px)"
        onCancel={() => {
          setImportOpen(false);
          if (importResult && importResult.successCount > 0) reloadAll();
        }}
        footer={
          importDone
            ? [
                <Button
                  key="again"
                  onClick={() => {
                    setParsed(null);
                    setImportResult(null);
                    setImportDone(false);
                  }}
                >
                  再次导入
                </Button>,
                <Button key="close" type="primary" onClick={() => setImportOpen(false)}>
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setImportOpen(false)}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Button icon={<MIcon name="download" size={16} />} onClick={downloadDormTemplate} block>
            下载 Excel 模板
          </Button>
          {!importDone && (
            <Upload
              accept=".xlsx,.xls"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                void handleImportFile(file);
                return false;
              }}
            >
              <Button icon={<MIcon name="upload" size={16} />} block>
                选择填写好的 Excel
              </Button>
            </Upload>
          )}

          {parsed && (
            <div className="m-card" style={{ margin: 0 }}>
              <div className="m-t3">
                {importDone ? '导入结果' : '校验结果'}
                ：文件「{parsed.fileName}」共 {parsed.totalRows} 行，可导入 {parsed.valid.length} 条
              </div>
              <div className="m-t4" style={{ marginTop: 4 }}>
                {importDone
                  ? `新增 ${importResult?.insertedCount ?? 0}、更新 ${importResult?.updatedCount ?? 0}、跳过 ${importResult?.skippedCount ?? 0} 条，失败 ${allFailures.length} 行`
                  : `存在问题 ${parsed.failures.length} 行；导入按学号 upsert，已存在且完全相同自动跳过`}
              </div>
              {allFailures.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {allFailures.slice(0, 20).map((f) => (
                    <li key={f.row} className="m-t4">
                      第 {f.row} 行（{f.studentNo}）：{f.reason}
                    </li>
                  ))}
                  {allFailures.length > 20 && (
                    <li className="m-t4">…另有 {allFailures.length - 20} 行，可导出明细查看</li>
                  )}
                </ul>
              )}
              {allFailures.length > 0 && (
                <Button
                  size="small"
                  block
                  style={{ marginTop: 10 }}
                  onClick={() => exportDormImportFailures(allFailures)}
                >
                  导出失败明细
                </Button>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

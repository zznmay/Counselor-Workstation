import { App, Button, Descriptions, Form, Input, Modal, Popconfirm, Select, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDormitory,
  deleteDormitory,
  getDormitories,
  getDormitoryOptions,
  importDormitories,
  updateDormitory,
} from '@/api/dormitory';
import { getStudentOptions } from '@/api/student';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { canManageStudentFront, getStoredUser, subscribeSession } from '@/lib/auth';
import { formatDorm, MAX_BUILDING, MAX_ROOM } from '@/utils/dormitory';
import {
  downloadDormTemplate,
  exportDormImportFailures,
  parseDormExcel,
  validateDormRows,
} from '@/utils/dormImport';
import type {
  DormImportFailure,
  DormImportResult,
  Dormitory,
  DormitoryOptions,
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
  const { message } = App.useApp();
  const [authUser, setAuthUser] = useState(getStoredUser);

  /* ---------- 列表 ---------- */
  const [list, setList] = useState<Dormitory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [className, setClassName] = useState<string | undefined>(undefined);
  const [building, setBuilding] = useState<string | undefined>(undefined);
  const [draftClassName, setDraftClassName] = useState<string | undefined>(undefined);
  const [draftBuilding, setDraftBuilding] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [options, setOptions] = useState<DormitoryOptions>({ buildings: [], classNames: [] });
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);

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

  const loadOptions = useCallback(() => {
    getDormitoryOptions().then(setOptions).catch(() => undefined);
    getStudentOptions().then(setStudentOptions).catch(() => undefined);
  }, []);

  const loadList = useCallback(
    async (targetPage: number, kw: string, cn?: string, bd?: string) => {
      setLoading(true);
      try {
        const res = await getDormitories({
          page: targetPage,
          pageSize: PAGE_SIZE,
          keyword: kw || undefined,
          className: cn,
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
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void loadList(1, keyword, className, building);
      return;
    }
    const timer = setTimeout(() => void loadList(1, keyword, className, building), 300);
    return () => clearTimeout(timer);
  }, [keyword, className, building, loadList]);

  const hasMore = list.length < total;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadList(page + 1, keyword, className, building);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, page, keyword, className, building, loadList]);

  const reloadAll = () => {
    void loadList(1, keyword, className, building);
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
            setDraftClassName(className);
            setDraftBuilding(building);
            setSheetOpen(true);
          }}
        >
          <MIcon name="funnel" size={16} />
          筛选
        </button>
      </div>

      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        共 {total} 条寝室分配
        {className ? ` · ${className}` : ''}
        {building ? ` · ${building}` : ''}
        <button
          type="button"
          className="m-btn m-btn-soft"
          style={{ marginLeft: 'auto' }}
          onClick={() => openForm()}
        >
          <MIcon name="plus" size={14} />
          新增
        </button>
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
          return (
            <div className="m-card" key={d.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
          onClick={() => void loadList(page + 1, keyword, className, building)}
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
                setDraftClassName(undefined);
                setDraftBuilding(undefined);
                setClassName(undefined);
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
                setClassName(draftClassName);
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
          <label>班级</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`m-seg-btn${!draftClassName ? ' on' : ''}`}
              style={{ flex: '0 0 auto' }}
              onClick={() => setDraftClassName(undefined)}
            >
              全部
            </button>
            {options.classNames.map((c) => (
              <button
                key={c}
                type="button"
                className={`m-seg-btn${draftClassName === c ? ' on' : ''}`}
                style={{ flex: '0 0 auto' }}
                onClick={() => setDraftClassName(c)}
              >
                {c}
              </button>
            ))}
          </div>
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

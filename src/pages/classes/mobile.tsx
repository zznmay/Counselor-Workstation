import { App, Form, Input, Modal, Popconfirm, Select } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createClass,
  createGrade,
  deleteClass,
  deleteGrade,
  getClasses,
  getGradeOptions,
  getGrades,
  updateClass,
  updateGrade,
} from '@/api/classes';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import type { Grade, GradeOption, SchoolClass } from '@/types';

type Tab = 'classes' | 'grades';

const PAGE_SIZE = 20;

/**
 * 移动端班级管理：单页承载「班级 / 年级」两个视图（m-seg 分段切换）。
 * - 班级视图：搜索常驻 + 年级筛选抽屉 + 卡片列表 + 新增/编辑/删除
 * - 年级视图：卡片列表 + 新增/编辑/删除（低频配置、数据量小，不分页）
 * 复用 mobile.css 现有令牌（m-seg / m-card / m-btn / FilterSheet），不新增样式。
 */
export default function ClassesMobile() {
  const { message } = App.useApp();

  const [tab, setTab] = useState<Tab>('classes');

  /* ---------- 班级列表 ---------- */
  const [classList, setClassList] = useState<SchoolClass[]>([]);
  const [classTotal, setClassTotal] = useState(0);
  const [classPage, setClassPage] = useState(1);
  const [classLoading, setClassLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [gradeId, setGradeId] = useState<number | undefined>(undefined);
  const [draftGradeId, setDraftGradeId] = useState<number | undefined>(undefined);
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  /* ---------- 年级列表 ---------- */
  const [grades, setGrades] = useState<Grade[]>([]);

  /* ---------- 表单状态 ---------- */
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);
  const [gradeFormOpen, setGradeFormOpen] = useState(false);
  const [editingGrade, setEditingGrade] = useState<Grade | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [classForm] = Form.useForm<{ gradeId: number; name: string }>();
  const [gradeForm] = Form.useForm<{ name: string }>();

  const loadClasses = useCallback(
    async (targetPage: number, kw: string, gid?: number) => {
      setClassLoading(true);
      try {
        const res = await getClasses({
          page: targetPage,
          pageSize: PAGE_SIZE,
          keyword: kw || undefined,
          gradeId: gid,
        });
        setClassList((prev) => (targetPage === 1 ? res.list : [...prev, ...res.list]));
        setClassTotal(res.total);
        setClassPage(targetPage);
      } finally {
        setClassLoading(false);
      }
    },
    [],
  );

  const loadGrades = useCallback(async () => {
    try {
      setGrades(await getGrades());
    } catch {
      /* 年级列表加载失败不打断页面 */
    }
  }, []);

  /* 关键词防抖 300ms；年级筛选变化立即回到第 1 页 */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      void loadClasses(1, keyword, gradeId);
      void loadGrades();
      getGradeOptions().then(setGradeOptions).catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => void loadClasses(1, keyword, gradeId), 300);
    return () => clearTimeout(timer);
  }, [keyword, gradeId, loadClasses, loadGrades]);

  const hasMore = classList.length < classTotal;
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || classLoading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadClasses(classPage + 1, keyword, gradeId);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, classLoading, classPage, keyword, gradeId, loadClasses]);

  const reloadAll = () => {
    void loadClasses(1, keyword, gradeId);
    void loadGrades();
  };

  /* ---------- 班级表单 ---------- */
  const openClassForm = (record?: SchoolClass) => {
    setEditingClass(record ?? null);
    if (record) {
      classForm.setFieldsValue({ gradeId: record.gradeId, name: record.name });
    } else {
      classForm.resetFields();
    }
    setClassFormOpen(true);
  };

  const handleClassSubmit = async () => {
    let values: { gradeId: number; name: string };
    try {
      values = await classForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editingClass) {
        await updateClass(editingClass.id, values);
        message.success('班级已更新');
      } else {
        await createClass(values);
        message.success('新增班级成功');
      }
      setClassFormOpen(false);
      reloadAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClassDelete = async (record: SchoolClass) => {
    try {
      await deleteClass(record.id);
      message.success('删除成功');
      reloadAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  /* ---------- 年级表单 ---------- */
  const openGradeForm = (record?: Grade) => {
    setEditingGrade(record ?? null);
    if (record) {
      gradeForm.setFieldsValue({ name: record.name });
    } else {
      gradeForm.resetFields();
    }
    setGradeFormOpen(true);
  };

  const handleGradeSubmit = async () => {
    let values: { name: string };
    try {
      values = await gradeForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editingGrade) {
        await updateGrade(editingGrade.id, values.name);
        message.success('年级已更新');
      } else {
        await createGrade(values.name);
        message.success('新增年级成功');
      }
      setGradeFormOpen(false);
      reloadAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGradeDelete = async (record: Grade) => {
    try {
      await deleteGrade(record.id);
      message.success('删除成功');
      reloadAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <>
      {/* 班级 / 年级 分段切换 */}
      <div className="m-seg" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`m-seg-btn${tab === 'classes' ? ' on' : ''}`}
          onClick={() => setTab('classes')}
        >
          班级
        </button>
        <button
          type="button"
          className={`m-seg-btn${tab === 'grades' ? ' on' : ''}`}
          onClick={() => setTab('grades')}
        >
          年级
        </button>
      </div>

      {tab === 'classes' ? (
        <>
          <div className="m-search-row">
            <div className="m-search-field">
              <MIcon name="search" size={16} />
              <input
                className="m-inp"
                type="search"
                value={keyword}
                placeholder="搜索班级名称"
                aria-label="搜索班级"
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="m-btn m-btn-ghost"
              onClick={() => {
                setDraftGradeId(gradeId);
                setSheetOpen(true);
              }}
            >
              <MIcon name="funnel" size={16} />
              筛选
            </button>
          </div>

          <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            共 {classTotal} 个班级{gradeId ? '（已筛选）' : ''}
            <button
              type="button"
              className="m-btn m-btn-soft"
              style={{ marginLeft: 'auto' }}
              onClick={() => openClassForm()}
            >
              <MIcon name="plus" size={14} />
              新增班级
            </button>
          </div>

          {classList.length === 0 && !classLoading ? (
            <div className="m-card empty">
              <MIcon name="search" size={22} />
              <div className="m-t3" style={{ marginTop: 6 }}>
                没有符合条件的班级
              </div>
            </div>
          ) : (
            classList.map((c) => (
              <div className="m-card" key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="m-ava">{c.name.slice(0, 1)}</span>
                  <div className="m-row-main">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="m-t1">{c.name}</span>
                      {c.gradeName && <span className="m-tag neutral">{c.gradeName}</span>}
                    </div>
                    <div className="m-t3" style={{ marginTop: 3 }}>
                      {c.studentCount ?? 0} 名学生
                      {c.counselorNames ? ` · ${c.counselorNames}` : ' · 未分配辅导员'}
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
                      openClassForm(c);
                    }}
                    aria-label={`编辑班级 ${c.name}`}
                  >
                    <MIcon name="edit" size={18} />
                    编辑
                  </a>
                  <Popconfirm
                    title="确定删除该班级吗？"
                    description="班级下仍有学生时无法删除"
                    onConfirm={() => void handleClassDelete(c)}
                  >
                    <a
                      className="m-act danger"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`删除班级 ${c.name}`}
                    >
                      <MIcon name="x" size={18} />
                      删除
                    </a>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}

          {classLoading && (
            <div className="m-loadmore">
              <MIcon name="spinner" size={16} className="m-spin" />
              加载中…
            </div>
          )}

          <div ref={sentinel} style={{ height: 1 }} />
          {!classLoading && hasMore && (
            <button
              type="button"
              className="m-btn m-btn-ghost m-btn-block"
              onClick={() => void loadClasses(classPage + 1, keyword, gradeId)}
            >
              加载更多（还有 {classTotal - classList.length} 个）
            </button>
          )}
          {!hasMore && classList.length > 0 && (
            <div className="m-loadmore">已加载全部 {classTotal} 个班级</div>
          )}
        </>
      ) : (
        <>
          <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            共 {grades.length} 个年级
            <button
              type="button"
              className="m-btn m-btn-soft"
              style={{ marginLeft: 'auto' }}
              onClick={() => openGradeForm()}
            >
              <MIcon name="plus" size={14} />
              新增年级
            </button>
          </div>

          {grades.length === 0 ? (
            <div className="m-card empty">
              <MIcon name="file" size={22} />
              <div className="m-t3" style={{ marginTop: 6 }}>
                暂无年级，请先新增
              </div>
            </div>
          ) : (
            grades.map((g) => (
              <div className="m-card" key={g.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="m-ava">{g.name.slice(0, 1)}</span>
                  <div className="m-row-main">
                    <span className="m-t1">{g.name}</span>
                    <div className="m-t3" style={{ marginTop: 3 }}>
                      {g.classCount ?? 0} 个班级
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
                      openGradeForm(g);
                    }}
                    aria-label={`编辑年级 ${g.name}`}
                  >
                    <MIcon name="edit" size={18} />
                    编辑
                  </a>
                  <Popconfirm
                    title="确定删除该年级吗？"
                    description="年级下存在班级时无法删除"
                    onConfirm={() => void handleGradeDelete(g)}
                  >
                    <a
                      className="m-act danger"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`删除年级 ${g.name}`}
                    >
                      <MIcon name="x" size={18} />
                      删除
                    </a>
                  </Popconfirm>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* 年级筛选抽屉 */}
      <FilterSheet
        open={sheetOpen}
        title="筛选班级"
        onClose={() => setSheetOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="m-btn m-btn-ghost"
              onClick={() => {
                setDraftGradeId(undefined);
                setGradeId(undefined);
                setSheetOpen(false);
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="m-btn m-btn-primary"
              onClick={() => {
                setGradeId(draftGradeId);
                setSheetOpen(false);
              }}
            >
              确定
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>所属年级</label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`m-seg-btn${!draftGradeId ? ' on' : ''}`}
              onClick={() => setDraftGradeId(undefined)}
            >
              全部
            </button>
            {gradeOptions.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`m-seg-btn${draftGradeId === g.id ? ' on' : ''}`}
                onClick={() => setDraftGradeId(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      </FilterSheet>

      {/* 新增 / 编辑班级 */}
      <Modal
        title={editingClass ? '编辑班级' : '新增班级'}
        open={classFormOpen}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleClassSubmit}
        onCancel={() => setClassFormOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={classForm} layout="vertical">
          <Form.Item
            name="gradeId"
            label="所属年级"
            rules={[{ required: true, message: '请选择所属年级' }]}
          >
            <Select
              placeholder="请选择所属年级"
              options={gradeOptions.map((g) => ({ value: g.id, label: g.name }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="班级名称"
            rules={[{ required: true, message: '请输入班级名称' }]}
          >
            <Input placeholder="如 计应2601" maxLength={30} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增 / 编辑年级 */}
      <Modal
        title={editingGrade ? '编辑年级' : '新增年级'}
        open={gradeFormOpen}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleGradeSubmit}
        onCancel={() => setGradeFormOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={gradeForm} layout="vertical">
          <Form.Item
            name="name"
            label="年级名称"
            rules={[{ required: true, message: '请输入年级名称' }]}
          >
            <Input placeholder="如 2027级" maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

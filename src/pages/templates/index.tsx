import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Tag,
  Upload,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createCategory,
  deleteCategory,
  deleteTemplate,
  getTemplateBlob,
  getTemplateCategories,
  getTemplates,
  isTemplateNameTaken,
  renameCategory,
  renameTemplate,
  updateTemplateDesc,
  uploadTemplate,
} from '@/api/templateLibrary';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { TEMPLATE_MAX_SIZE, extFormat, FORMAT_META, formatSize, saveBlob, TEMPLATE_ACCEPT } from '@/utils/templateFile';
import type { TemplateCategoryWithCount, TemplateFile } from '@/types';

/* ==================== 上传弹窗（自包含表单与文件校验） ==================== */

interface UploadFormValues {
  name: string;
  categoryId: string;
  description?: string;
}

function UploadModal({
  open,
  categories,
  defaultCategoryId,
  file,
  onFile,
  submitting,
  onOk,
  onCancel,
}: {
  open: boolean;
  categories: TemplateCategoryWithCount[];
  defaultCategoryId?: string;
  file: File | null;
  onFile: (f: File | null) => void;
  submitting: boolean;
  onOk: (values: UploadFormValues) => void;
  onCancel: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<UploadFormValues>();

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ categoryId: defaultCategoryId });
    }
  }, [open, defaultCategoryId, form]);

  const acceptFile = (f: File) => {
    const fmt = extFormat(f.name);
    if (!fmt) {
      message.error('仅支持 doc / docx / xls / xlsx / pdf 格式文件');
      return;
    }
    if (f.size > TEMPLATE_MAX_SIZE) {
      message.error('文件大小不能超过 10MB');
      return;
    }
    onFile(f);
    form.setFieldsValue({ name: f.name.replace(/\.[^.]+$/, '') });
  };

  /** 提交时统一走父组件的 onOk（其内部会取本表单值） */
  const submit = async (): Promise<UploadFormValues | null> => {
    try {
      return await form.validateFields();
    } catch {
      return null;
    }
  };

  return (
    <Modal
      title="上传模板"
      width={560}
      open={open}
      confirmLoading={submitting}
      onOk={async () => {
        const values = await submit();
        if (values) onOk(values);
      }}
      onCancel={onCancel}
      okText="上传"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="categoryId"
          label="所属类别"
          rules={[{ required: true, message: '请选择所属类别' }]}
        >
          <Select
            placeholder="选择类别"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item
          name="name"
          label="模板名称"
          rules={[
            { required: true, message: '请输入模板名称' },
            { max: 40, message: '名称不超过 40 个字' },
            {
              validator: async (_, value: string) => {
                if (value && (await isTemplateNameTaken(value))) {
                  throw new Error('已存在同名模板，请修改名称');
                }
              },
            },
          ]}
          extra="选择文件后自动填入文件名，可自行修改；保存后同步到模板列表"
        >
          <Input placeholder="如：学费缓缴申请表" />
        </Form.Item>
        <Form.Item name="description" label="简要说明">
          <Input.TextArea rows={2} placeholder="模板用途、填写注意事项等（选填）" />
        </Form.Item>
        <Form.Item label="模板文件" required style={{ marginBottom: 0 }}>
          {file ? (
            <div className="upload-file-chip">
              <FileTextOutlined style={{ color: 'var(--app-primary)' }} />
              <span className="chip-name" title={file.name}>
                {file.name}
              </span>
              <span className="chip-size">{formatSize(file.size)}</span>
              <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => onFile(null)} />
            </div>
          ) : (
            <Upload.Dragger
              accept={TEMPLATE_ACCEPT}
              maxCount={1}
              showUploadList={false}
              beforeUpload={(f) => {
                acceptFile(f);
                return false;
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint">支持 doc / docx / xls / xlsx / pdf，单个不超过 10MB</p>
            </Upload.Dragger>
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ==================== 页面 ==================== */

/**
 * 申请表模板汇总库：左侧类别导航（支持新增/重命名/删除），右侧模板卡片列表。
 * 支持按类别筛选、关键词搜索、单个/批量下载、上传（类型/大小/重名校验）与模板管理。
 */
export default function Templates() {
  const isMobile = useIsMobile();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<TemplateCategoryWithCount[]>([]);
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [batchDownloading, setBatchDownloading] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  const [catModal, setCatModal] = useState<{ open: boolean; mode: 'add' | 'rename'; id?: string }>({
    open: false,
    mode: 'add',
  });
  const [catForm] = Form.useForm<{ name: string }>();

  const [fileModal, setFileModal] = useState<{
    open: boolean;
    mode: 'rename' | 'desc';
    target?: TemplateFile;
  }>({ open: false, mode: 'rename' });
  const [fileForm] = Form.useForm<{ value: string }>();
  const [fileSubmitting, setFileSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, files] = await Promise.all([getTemplateCategories(), getTemplates({})]);
      setCategories(cats);
      setTemplates(files);
      setSelected((prev) => {
        const ids = new Set(files.map((f) => f.id));
        const next = new Set([...prev].filter((id) => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const kw = keyword.trim();
  const visible = useMemo(
    () =>
      templates.filter(
        (t) =>
          (!activeCategory || t.categoryId === activeCategory) &&
          (!kw || [t.name, t.description ?? ''].some((f) => f.includes(kw))),
      ),
    [templates, activeCategory, kw],
  );
  const catNameMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const allChecked = visible.length > 0 && visible.every((t) => selected.has(t.id));

  /* ---------- 下载 ---------- */

  const downloadOne = async (t: TemplateFile) => {
    const blob = await getTemplateBlob(t.id);
    saveBlob(blob, `${t.name}.${t.format}`);
  };

  const handleDownload = async (t: TemplateFile) => {
    setDownloadingId(t.id);
    try {
      await downloadOne(t);
      message.success(`已开始下载「${t.name}」`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '下载失败，请稍后重试');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleBatchDownload = async () => {
    if (selected.size === 0) return;
    setBatchDownloading(true);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      const t = templates.find((x) => x.id === id);
      if (!t) continue;
      try {
        await downloadOne(t);
        ok += 1;
      } catch {
        fail += 1;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    setBatchDownloading(false);
    if (fail === 0) message.success(`已批量下载 ${ok} 个模板`);
    else message.warning(`批量下载完成：成功 ${ok} 个，失败 ${fail} 个`);
  };

  /* ---------- 类别管理 ---------- */

  const openCatModal = (mode: 'add' | 'rename', c?: TemplateCategoryWithCount) => {
    setCatModal({ open: true, mode, id: c?.id });
    catForm.setFieldsValue({ name: mode === 'rename' ? (c?.name ?? '') : '' });
  };

  const handleCatOk = async () => {
    let values: { name: string };
    try {
      values = await catForm.validateFields();
    } catch {
      return;
    }
    try {
      if (catModal.mode === 'add') {
        await createCategory(values.name);
        message.success('类别已创建');
      } else if (catModal.id) {
        await renameCategory(catModal.id, values.name);
        message.success('类别已重命名');
      }
      setCatModal({ open: false, mode: 'add' });
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const confirmDeleteCategory = (c: TemplateCategoryWithCount) => {
    modal.confirm({
      title: `删除类别「${c.name}」？`,
      content: '仅可删除空类别；类别下仍有模板时无法删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCategory(c.id);
          message.success('类别已删除');
          if (activeCategory === c.id) setActiveCategory(undefined);
          void reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  /* ---------- 上传 ---------- */

  const handleUploadOk = async (values: { name: string; categoryId: string; description?: string }) => {
    if (!uploadFile) {
      message.warning('请先选择模板文件');
      return;
    }
    setUploadSubmitting(true);
    try {
      const t = await uploadTemplate(
        { name: values.name, categoryId: values.categoryId, description: values.description },
        uploadFile,
      );
      message.success(`模板「${t.name}」上传成功`);
      setUploadOpen(false);
      setUploadFile(null);
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败，请稍后重试');
    } finally {
      setUploadSubmitting(false);
    }
  };

  /* ---------- 模板管理（重命名 / 说明 / 删除） ---------- */

  const openFileModal = (mode: 'rename' | 'desc', t: TemplateFile) => {
    setFileModal({ open: true, mode, target: t });
    fileForm.setFieldsValue({ value: mode === 'rename' ? t.name : (t.description ?? '') });
  };

  const handleFileModalOk = async () => {
    const target = fileModal.target;
    if (!target) return;
    let values: { value: string };
    try {
      values = await fileForm.validateFields();
    } catch {
      return;
    }
    setFileSubmitting(true);
    try {
      if (fileModal.mode === 'rename') {
        await renameTemplate(target.id, values.value);
        message.success('模板已重命名');
      } else {
        await updateTemplateDesc(target.id, values.value);
        message.success('说明已更新');
      }
      setFileModal({ open: false, mode: 'rename' });
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setFileSubmitting(false);
    }
  };

  const confirmDeleteTemplate = (t: TemplateFile) => {
    modal.confirm({
      title: `删除模板「${t.name}」？`,
      content: '删除后不可恢复，确定要删除吗？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteTemplate(t.id);
        message.success('模板已删除');
        void reload();
      },
    });
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((t) => (checked ? next.add(t.id) : next.delete(t.id)));
      return next;
    });
  };

  /* ---------- 渲染 ---------- */

  const renderCategoryItem = (c: TemplateCategoryWithCount) => {
    const active = activeCategory === c.id;
    return (
      <div
        key={c.id}
        className={`cat-item ${active ? 'active' : ''}`}
        onClick={() => setActiveCategory(c.id)}
      >
        <FolderOutlined />
        <span className="cat-name" title={c.name}>
          {c.name}
        </span>
        <span className="cat-count">{c.count}</span>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'rename', icon: <EditOutlined />, label: '重命名' },
              { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'rename') openCatModal('rename', c);
              else confirmDeleteCategory(c);
            },
          }}
        >
          <MoreOutlined className="cat-more" onClick={(e) => e.stopPropagation()} />
        </Dropdown>
      </div>
    );
  };

  const allItem = (
    <div
      className={`cat-item ${activeCategory === undefined ? 'active' : ''}`}
      onClick={() => setActiveCategory(undefined)}
    >
      <InboxOutlined />
      <span className="cat-name">全部模板</span>
      <span className="cat-count">{templates.length}</span>
    </div>
  );

  return (
    <div className="page">
      <PageHeader
        title="申请表模板汇总库"
        subtitle="集中管理学生工作中常用的申请表模板，支持分类浏览、按需下载与自主上传"
        extra={
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
            上传模板
          </Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8} xl={6}>
          <Card
            size="small"
            loading={loading}
            title="模板类别"
            extra={
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCatModal('add')}>
                新增
              </Button>
            }
          >
            <div className={`tpl-cats ${isMobile ? 'is-mobile' : ''}`}>
              {allItem}
              {categories.map(renderCategoryItem)}
              {!loading && categories.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无类别" />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} md={16} xl={18}>
          <Card loading={loading}>
            <div className="tpl-toolbar">
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: 'rgba(47,62,102,0.35)' }} />}
                placeholder="搜索模板名称 / 说明"
                style={{ width: isMobile ? '100%' : 240 }}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <div className="toolbar-spacer" />
              <Checkbox
                checked={allChecked}
                indeterminate={selected.size > 0 && !allChecked}
                disabled={visible.length === 0}
                onChange={(e) => toggleAll(e.target.checked)}
              >
                全选
              </Checkbox>
              <Button
                icon={<DownloadOutlined />}
                disabled={selected.size === 0}
                loading={batchDownloading}
                onClick={handleBatchDownload}
              >
                批量下载{selected.size > 0 ? `（${selected.size}）` : ''}
              </Button>
            </div>

            {!loading && visible.length === 0 ? (
              <Empty
                style={{ padding: '56px 0' }}
                description={
                  templates.length === 0
                    ? '模板库还是空的，上传第一个模板吧'
                    : '没有找到匹配的模板，试试调整类别或关键词'
                }
              >
                {templates.length === 0 ? (
                  <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
                    上传模板
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setKeyword('');
                      setActiveCategory(undefined);
                    }}
                  >
                    清除筛选条件
                  </Button>
                )}
              </Empty>
            ) : (
              <Row gutter={[16, 16]} className="tpl-grid">
                {visible.map((t) => {
                  const meta = FORMAT_META[t.format];
                  return (
                    <Col xs={24} sm={12} xxl={8} key={t.id}>
                      <Card size="small" className="tpl-card">
                        <div className="tpl-top">
                          <Checkbox
                            checked={selected.has(t.id)}
                            onChange={(e) => toggleSelect(t.id, e.target.checked)}
                          />
                          <div
                            className="tpl-icon"
                            style={{
                              color: meta.color,
                              background: `linear-gradient(135deg, ${meta.color}12, ${meta.color}26)`,
                            }}
                          >
                            {meta.label}
                          </div>
                          <div className="tpl-headline">
                            <div className="tpl-name" title={t.name}>
                              {t.name}
                            </div>
                            <div className="tpl-sub">
                              <Tag color="blue">{catNameMap.get(t.categoryId) ?? '未分类'}</Tag>
                              <span>{formatSize(t.size)}</span>
                            </div>
                          </div>
                          <Dropdown
                            trigger={['click']}
                            menu={{
                              items: [
                                { key: 'download', icon: <DownloadOutlined />, label: '下载' },
                                { key: 'rename', icon: <EditOutlined />, label: '重命名' },
                                { key: 'desc', icon: <FileTextOutlined />, label: '编辑说明' },
                                { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
                              ],
                              onClick: ({ key }) => {
                                if (key === 'download') void handleDownload(t);
                                else if (key === 'rename') openFileModal('rename', t);
                                else if (key === 'desc') openFileModal('desc', t);
                                else confirmDeleteTemplate(t);
                              },
                            }}
                          >
                            <Button type="text" size="small" icon={<MoreOutlined />} />
                          </Dropdown>
                        </div>
                        <div className="tpl-desc" title={t.description}>
                          {t.description || '暂无说明'}
                        </div>
                        <div className="tpl-foot">
                          <span className="tpl-by" title={`${t.uploader} · ${t.updatedAt}`}>
                            {t.uploader} · {t.updatedAt.slice(5, 16)}
                          </span>
                          <Button
                            type="link"
                            size="small"
                            icon={<DownloadOutlined />}
                            loading={downloadingId === t.id}
                            onClick={() => handleDownload(t)}
                          >
                            下载
                          </Button>
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            )}
          </Card>
        </Col>
      </Row>

      {/* 类别新增 / 重命名 */}
      <Modal
        title={catModal.mode === 'add' ? '新增类别' : '重命名类别'}
        open={catModal.open}
        onOk={handleCatOk}
        onCancel={() => setCatModal({ open: false, mode: 'add' })}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        <Form form={catForm} layout="vertical">
          <Form.Item
            name="name"
            label="类别名称"
            rules={[
              { required: true, message: '请输入类别名称' },
              { max: 20, message: '名称不超过 20 个字' },
            ]}
          >
            <Input placeholder="如：资助帮扶" onPressEnter={handleCatOk} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 模板重命名 / 编辑说明 */}
      <Modal
        title={
          fileModal.mode === 'rename' ? '重命名模板' : `编辑说明 · ${fileModal.target?.name ?? ''}`
        }
        open={fileModal.open}
        confirmLoading={fileSubmitting}
        onOk={handleFileModalOk}
        onCancel={() => setFileModal({ open: false, mode: 'rename' })}
        okText="保存"
        cancelText="取消"
        width={440}
      >
        <Form form={fileForm} layout="vertical">
          {fileModal.mode === 'rename' ? (
            <Form.Item
              name="value"
              label="模板名称"
              rules={[
                { required: true, message: '请输入模板名称' },
                { max: 40, message: '名称不超过 40 个字' },
            {
              validator: async (_, value: string) => {
                if (value && (await isTemplateNameTaken(value, fileModal.target?.id))) {
                  throw new Error('已存在同名模板，请修改名称');
                }
              },
            },
              ]}
            >
              <Input onPressEnter={handleFileModalOk} />
            </Form.Item>
          ) : (
            <Form.Item name="value" label="简要说明">
              <Input.TextArea rows={3} placeholder="模板用途、填写注意事项等" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 上传模板 */}
      <UploadModal
        open={uploadOpen}
        categories={categories}
        defaultCategoryId={activeCategory}
        file={uploadFile}
        onFile={setUploadFile}
        submitting={uploadSubmitting}
        onOk={handleUploadOk}
        onCancel={() => {
          setUploadOpen(false);
          setUploadFile(null);
        }}
      />
    </div>
  );
}

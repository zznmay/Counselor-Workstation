/**
 * PC 端「心理访谈记录单模板」管理弹窗：
 * 左侧模板列表（适用年级/等级 / 版本 / 引用数），右侧编辑器（名称 + 适用年级 + 适用关注等级 + 分组题目）。
 * 入口在心理健康页页头（仅管理员或心理健康主负责可见）。
 */
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CopyOutlined, PlusOutlined } from '@ant-design/icons';

import type { InterviewTemplate } from '@/types';
import { useTemplateEditor } from './templateShared';

interface TemplateManageModalProps {
  open: boolean;
  onClose: () => void;
}

/** 适用年级展示：空 = 全部年级 */
function GradesTag({ grades }: { grades: string[] }) {
  if (grades.length === 0) return <Tag style={{ marginInlineEnd: 0 }}>全部年级</Tag>;
  return (
    <Space size={4} wrap>
      {grades.map((g) => <Tag key={g} color="blue" style={{ marginInlineEnd: 0 }}>{g}</Tag>)}
    </Space>
  );
}

/** 适用关注等级展示：空 = 不限等级 */
function LevelsTag({ levels }: { levels: string[] }) {
  if (levels.length === 0) return <Tag style={{ marginInlineEnd: 0 }}>不限等级</Tag>;
  return (
    <Space size={4} wrap>
      {levels.map((l) => <Tag key={l} color="purple" style={{ marginInlineEnd: 0 }}>{l}</Tag>)}
    </Space>
  );
}

export default function TemplateManageModal({ open, onClose }: TemplateManageModalProps) {
  const { message } = App.useApp();
  const ed = useTemplateEditor({
    onSaved: (t) => message.success(`已保存模板「${t.name}」（v${t.version}）`),
  });

  const handleSave = async () => {
    await ed.save();
  };

  const handleDelete = async (t: InterviewTemplate) => {
    if (await ed.remove(t.id)) message.success(`已删除模板「${t.name}」`);
  };

  return (
    <Modal
      title="心理访谈记录单模板"
      open={open}
      onCancel={() => { ed.cancelEdit(); onClose(); }}
      width={980}
      footer={
        <Space>
          {ed.draft?.id && (
            <Popconfirm
              title="删除这个模板？"
              description="删除后新访谈不再使用它；已填写的记录不受影响（至少保留一个模板）"
              okText="删除"
              cancelText="取消"
              onConfirm={() => {
                const t = ed.templates.find((x) => x.id === ed.draft?.id);
                if (t) void handleDelete(t);
              }}
            >
              <Button danger disabled={ed.saving}>删除模板</Button>
            </Popconfirm>
          )}
          <Space>
            <Button onClick={() => { ed.cancelEdit(); onClose(); }}>关闭</Button>
            <Button type="primary" disabled={!ed.draft || ed.saving} onClick={handleSave}>
              {ed.saving ? '保存中…' : '保存'}
            </Button>
          </Space>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="记录单模板决定访谈表单的题目。适用年级不选 = 全部年级通用，适用关注等级不选 = 不限等级；年级与等级都命中的模板优先，同分按最近编辑的生效。历史记录按填写时的题目快照展示，改题不影响已填记录。"
      />

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：模板列表 */}
        <div style={{ width: 268, flex: '0 0 auto' }}>
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={ed.startCreate}
            disabled={ed.saving}
            style={{ marginBottom: 8 }}
          >
            新建模板
          </Button>
          <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ed.templates.length === 0 && !ed.loading && (
              <Empty description="暂无模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            {ed.templates.map((t) => {
              const active = ed.draft?.id === t.id;
              return (
                <div key={t.id} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => ed.startEdit(t)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: `1px solid ${active ? '#5F86FF' : '#e5e9f2'}`,
                      background: active ? 'rgba(95, 134, 255, 0.06)' : '#fff',
                      borderRadius: 10,
                      padding: '8px 10px',
                      paddingRight: 34,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <GradesTag grades={t.grades} />
                      <LevelsTag levels={t.levels ?? []} />
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      v{t.version} · {t.usageCount} 条记录引用 · {t.updatedAt?.slice(0, 10) ?? ''}
                      {t.updatedBy ? ` · ${t.updatedBy}` : ''}
                    </Typography.Text>
                  </button>
                  {/* 复制：以该模板为蓝本新建草稿（独立兄弟按钮，避免按钮嵌套） */}
                  <Tooltip title="复制为新模板">
                    <button
                      type="button"
                      aria-label={`复制模板「${t.name}」`}
                      onClick={() => ed.startDuplicate(t)}
                      disabled={ed.saving}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 24,
                        height: 24,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        borderRadius: 6,
                        background: 'transparent',
                        color: '#8a94a6',
                        cursor: ed.saving ? 'not-allowed' : 'pointer',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(95, 134, 255, 0.12)'; e.currentTarget.style.color = '#4568D8'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8a94a6'; }}
                    >
                      <CopyOutlined style={{ fontSize: 13 }} />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右：编辑器 */}
        <div style={{ flex: 1, minWidth: 0, maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
          {!ed.draft && (
            <Empty description="选择左侧模板编辑，或新建一个模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {ed.draft && (
            <>
              <div style={{ marginBottom: 10 }}>
                <Typography.Text strong>模板名称</Typography.Text>
                <Input
                  style={{ marginTop: 4 }}
                  value={ed.draft.name}
                  maxLength={50}
                  showCount
                  placeholder="如：心理访谈记录单（大一专用）"
                  onChange={(e) => ed.patchDraft({ name: e.target.value })}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <Typography.Text strong>适用年级</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    placeholder="不选 = 全部年级适用"
                    value={ed.draft.grades}
                    onChange={(grades) => ed.patchDraft({ grades })}
                    options={ed.gradeOptions.map((g) => ({ value: g, label: g }))}
                    optionFilterProp="label"
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <Typography.Text strong>适用关注等级</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    placeholder="不选 = 不限关注等级"
                    value={ed.draft.levels}
                    onChange={(levels) => ed.patchDraft({ levels })}
                    options={ed.levelOptions.map((l) => ({ value: l, label: l }))}
                  />
                </div>
              </div>

              {ed.draft.groups.map((g, gi) => (
                <div
                  key={gi}
                  style={{
                    border: '1px solid #e5e9f2',
                    borderRadius: 10,
                    padding: '10px 12px',
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Typography.Text strong style={{ fontSize: 13 }}>分组 {gi + 1}</Typography.Text>
                    <Input
                      value={g.title}
                      maxLength={50}
                      placeholder="分组标题，如：一、学生近期学习情况"
                      onChange={(e) => ed.patchGroupTitle(gi, e.target.value)}
                    />
                    <Space size={2}>
                      <Button size="small" type="text" disabled={gi === 0} onClick={() => ed.moveGroup(gi, -1)}>↑</Button>
                      <Button
                        size="small"
                        type="text"
                        disabled={gi === ed.draft!.groups.length - 1}
                        onClick={() => ed.moveGroup(gi, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        danger
                        disabled={ed.draft!.groups.length <= 1}
                        onClick={() => ed.removeGroup(gi)}
                      >
                        删组
                      </Button>
                    </Space>
                  </div>

                  {g.questions.map((q, qi) => (
                    <div
                      key={q.key}
                      style={{
                        background: '#f7f9ff',
                        borderRadius: 8,
                        padding: '8px 10px',
                        marginBottom: 6,
                      }}
                    >
                      <Input.TextArea
                        value={q.text}
                        maxLength={500}
                        showCount
                        rows={2}
                        placeholder="题干"
                        onChange={(e) => ed.patchQuestion(gi, qi, { text: e.target.value })}
                        style={{ marginBottom: 6 }}
                      />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Input
                          value={q.placeholder}
                          maxLength={200}
                          placeholder="预填提示（选填）"
                          onChange={(e) => ed.patchQuestion(gi, qi, { placeholder: e.target.value })}
                          style={{ flex: '1 1 220px' }}
                        />
                        <Space size={4} wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>字数下限</Typography.Text>
                          <Tooltip title={`0-5000 的整数，0 表示不限制；不可超过字数上限（${q.max}）`}>
                            <InputNumber
                              min={0}
                              max={q.max}
                              step={10}
                              value={q.min}
                              onChange={(v) => ed.patchQuestion(gi, qi, { min: Number.isInteger(v) ? (v as number) : 0 })}
                              style={{ width: 84 }}
                            />
                          </Tooltip>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>字数上限</Typography.Text>
                          <InputNumber
                            min={10}
                            max={5000}
                            step={50}
                            value={q.max}
                            onChange={(v) => ed.patchQuestion(gi, qi, { max: Number(v) || 500 })}
                            style={{ width: 92 }}
                          />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>行数</Typography.Text>
                          <InputNumber
                            min={1}
                            max={20}
                            value={q.rows}
                            onChange={(v) => ed.patchQuestion(gi, qi, { rows: Number(v) || 3 })}
                            style={{ width: 64 }}
                          />
                          <Button size="small" type="text" disabled={qi === 0} onClick={() => ed.moveQuestion(gi, qi, -1)}>↑</Button>
                          <Button
                            size="small"
                            type="text"
                            disabled={qi === g.questions.length - 1}
                            onClick={() => ed.moveQuestion(gi, qi, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            size="small"
                            type="text"
                            danger
                            disabled={g.questions.length <= 1}
                            onClick={() => ed.removeQuestion(gi, qi)}
                          >
                            删题
                          </Button>
                        </Space>
                      </div>
                    </div>
                  ))}

                  <Button size="small" type="dashed" block icon={<PlusOutlined />} onClick={() => ed.addQuestion(gi)}>
                    添加题目
                  </Button>
                </div>
              ))}

              <Button type="dashed" block icon={<PlusOutlined />} onClick={ed.addGroup}>
                添加分组
              </Button>
            </>
          )}
        </div>
      </div>

      {ed.error && (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>
          {ed.error}
        </Typography.Text>
      )}
    </Modal>
  );
}

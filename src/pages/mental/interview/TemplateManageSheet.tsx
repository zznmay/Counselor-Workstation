/**
 * 移动端「心理访谈记录单模板」管理面板（FilterSheet）。
 * 与桌面端共用 templateShared 编辑用例；列表用分段按钮切换，编辑器用 m-* 表单。
 */
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import type { InterviewTemplate } from '@/types';
import { useTemplateEditor } from './templateShared';

interface TemplateManageSheetProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功（新建/修订） */
  onSaved?: (t: InterviewTemplate) => void;
  /** 删除成功 */
  onDeleted?: (t: InterviewTemplate) => void;
}

/** 适用年级展示：空 = 全部年级 */
function gradesText(grades: string[]): string {
  return grades.length > 0 ? grades.join('、') : '全部年级';
}

/** 适用关注等级展示：空 = 不限等级 */
function levelsText(levels: string[]): string {
  return levels.length > 0 ? levels.join('、') : '不限等级';
}

export default function TemplateManageSheet({ open, onClose, onSaved, onDeleted }: TemplateManageSheetProps) {
  const ed = useTemplateEditor({ onSaved, onDeleted });

  return (
    <FilterSheet
      open={open}
      title="访谈记录单模板"
      onClose={() => { ed.cancelEdit(); onClose(); }}
      footer={
        <>
          <button
            type="button"
            className="m-btn m-btn-ghost"
            disabled={ed.saving}
            onClick={() => { ed.cancelEdit(); onClose(); }}
          >
            关闭
          </button>
          <button
            type="button"
            className="m-btn m-btn-primary"
            disabled={!ed.draft || ed.saving}
            onClick={() => void ed.save()}
          >
            {ed.saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="m-notice-card m-card" data-tone="info" style={{ padding: '8px 12px' }}>
        <div className="m-t4" style={{ lineHeight: 1.7 }}>
          模板决定访谈表单题目；适用年级不选 = 全部年级通用，适用关注等级不选 = 不限等级；年级与等级都命中优先、同分按最近编辑生效；改题不影响已填记录。
        </div>
      </div>

      {/* 模板列表 */}
      <div className="m-sec-head" style={{ marginTop: 12 }}>
        <span className="m-sec-title">模板（{ed.templates.length}）</span>
        <button type="button" className="m-btn m-btn-ghost" style={{ minHeight: 30, padding: '0 10px' }} onClick={ed.startCreate}>
          <MIcon name="plus" size={14} />
          新建
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ed.templates.map((t) => (
          <TemplateRow
            key={t.id}
            t={t}
            active={ed.draft?.id === t.id}
            onEdit={() => ed.startEdit(t)}
            onDuplicate={() => ed.startDuplicate(t)}
            onDelete={() => void ed.remove(t.id)}
          />
        ))}
        {ed.templates.length === 0 && <div className="m-t4">暂无模板</div>}
      </div>

      {/* 编辑器 */}
      {ed.draft && (
        <>
          <div className="m-group-title" style={{ marginTop: 14 }}>
            {ed.draft.id ? '编辑模板' : '新建模板'}
          </div>

          <div className="m-field">
            <label>模板名称<span className="m-req">*</span></label>
            <input
              className="m-inp"
              value={ed.draft.name}
              maxLength={50}
              placeholder="如：心理访谈记录单（大一专用）"
              onChange={(e) => ed.patchDraft({ name: e.target.value })}
            />
          </div>

          <div className="m-field">
            <label>适用年级（不选 = 全部年级）</label>
            <div className="m-seg" style={{ flexWrap: 'wrap' }}>
              {ed.gradeOptions.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`m-seg-btn${ed.draft!.grades.includes(g) ? ' on' : ''}`}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 12 }}
                  onClick={() => ed.toggleGrade(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="m-field">
            <label>适用关注等级（不选 = 不限等级）</label>
            <div className="m-seg" style={{ flexWrap: 'wrap' }}>
              {ed.levelOptions.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`m-seg-btn${ed.draft!.levels.includes(l) ? ' on' : ''}`}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 12 }}
                  onClick={() => ed.toggleLevel(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {ed.draft.groups.map((g, gi) => (
            <div className="m-card" key={gi} style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="m-t3" style={{ fontWeight: 600 }}>分组 {gi + 1}</span>
                <button type="button" className="m-btn m-btn-ghost" style={{ minHeight: 28, padding: '0 8px' }} disabled={gi === 0} onClick={() => ed.moveGroup(gi, -1)}>↑</button>
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  style={{ minHeight: 28, padding: '0 8px' }}
                  disabled={gi === ed.draft!.groups.length - 1}
                  onClick={() => ed.moveGroup(gi, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="m-btn m-btn-ghost"
                  style={{ minHeight: 28, padding: '0 8px', marginLeft: 'auto', color: 'var(--danger-fg)' }}
                  disabled={ed.draft!.groups.length <= 1}
                  onClick={() => ed.removeGroup(gi)}
                >
                  删组
                </button>
              </div>
              <div className="m-field" style={{ marginTop: 6 }}>
                <input
                  className="m-inp"
                  value={g.title}
                  maxLength={50}
                  placeholder="分组标题，如：一、学生近期学习情况"
                  onChange={(e) => ed.patchGroupTitle(gi, e.target.value)}
                />
              </div>

              {g.questions.map((q, qi) => (
                <div key={q.key} style={{ borderTop: '1px dashed var(--app-border, #e5e9f2)', paddingTop: 8, marginTop: 4 }}>
                  <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    第 {qi + 1} 题
                    <button type="button" className="m-btn m-btn-ghost" style={{ minHeight: 26, padding: '0 8px' }} disabled={qi === 0} onClick={() => ed.moveQuestion(gi, qi, -1)}>↑</button>
                    <button
                      type="button"
                      className="m-btn m-btn-ghost"
                      style={{ minHeight: 26, padding: '0 8px' }}
                      disabled={qi === g.questions.length - 1}
                      onClick={() => ed.moveQuestion(gi, qi, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="m-btn m-btn-ghost"
                      style={{ minHeight: 26, padding: '0 8px', marginLeft: 'auto', color: 'var(--danger-fg)' }}
                      disabled={g.questions.length <= 1}
                      onClick={() => ed.removeQuestion(gi, qi)}
                    >
                      删题
                    </button>
                  </div>
                  <div className="m-field">
                    <label>题干<span className="m-req">*</span></label>
                    <textarea
                      className="m-inp"
                      rows={2}
                      maxLength={500}
                      value={q.text}
                      placeholder="题干"
                      onChange={(e) => ed.patchQuestion(gi, qi, { text: e.target.value })}
                    />
                    <div className="m-t4" style={{ textAlign: 'right' }}>{q.text.length}/500</div>
                  </div>
                  <div className="m-field">
                    <label>预填提示（选填）</label>
                    <input
                      className="m-inp"
                      value={q.placeholder}
                      maxLength={200}
                      onChange={(e) => ed.patchQuestion(gi, qi, { placeholder: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div className="m-field" style={{ flex: 1 }}>
                      <label>字数下限</label>
                      <input
                        className="m-inp"
                        type="number"
                        min={0}
                        max={q.max}
                        value={q.min}
                        onChange={(e) => ed.patchQuestion(gi, qi, { min: Number.isInteger(Number(e.target.value)) ? Number(e.target.value) : 0 })}
                      />
                      <div className="m-t4">0-5000 的整数，0 表示不限制</div>
                    </div>
                    <div className="m-field" style={{ flex: 1 }}>
                      <label>字数上限</label>
                      <input
                        className="m-inp"
                        type="number"
                        min={10}
                        max={5000}
                        value={q.max}
                        onChange={(e) => ed.patchQuestion(gi, qi, { max: Number(e.target.value) || 500 })}
                      />
                    </div>
                    <div className="m-field" style={{ flex: 1 }}>
                      <label>行数</label>
                      <input
                        className="m-inp"
                        type="number"
                        min={1}
                        max={20}
                        value={q.rows}
                        onChange={(e) => ed.patchQuestion(gi, qi, { rows: Number(e.target.value) || 3 })}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="m-btn m-btn-ghost m-btn-block"
                style={{ marginTop: 8 }}
                onClick={() => ed.addQuestion(gi)}
              >
                <MIcon name="plus" size={14} />
                添加题目
              </button>
            </div>
          ))}

          <button type="button" className="m-btn m-btn-ghost m-btn-block" style={{ marginTop: 8 }} onClick={ed.addGroup}>
            <MIcon name="plus" size={16} />
            添加分组
          </button>

          {ed.error && (
            <div className="m-notice-card m-card" data-tone="warning" style={{ padding: '8px 12px', marginTop: 8 }}>
              <div className="m-t3" style={{ color: 'var(--warning-fg)' }}>{ed.error}</div>
            </div>
          )}
        </>
      )}
    </FilterSheet>
  );
}

function TemplateRow({
  t,
  active,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  t: InterviewTemplate;
  active: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="m-card" style={{ padding: '8px 12px', borderColor: active ? 'var(--app-primary-action)' : undefined }}>
      <button
        type="button"
        onClick={onEdit}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="m-t2" style={{ fontWeight: 600 }}>{t.name}</span>
          <span className="m-tag info">{gradesText(t.grades)}</span>
          <span className="m-tag neutral">{levelsText(t.levels ?? [])}</span>
          <span className="m-t4">v{t.version}</span>
        </div>
        <div className="m-t4" style={{ marginTop: 2 }}>
          {t.usageCount} 条记录引用{t.updatedBy ? ` · ${t.updatedBy}` : ''}
        </div>
      </button>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" className="m-btn m-btn-soft" style={{ flex: 1, minHeight: 30 }} onClick={onEdit}>
          <MIcon name="edit" size={14} />
          编辑
        </button>
        <button type="button" className="m-btn m-btn-soft" style={{ flex: 1, minHeight: 30 }} onClick={onDuplicate}>
          <MIcon name="copy" size={14} />
          复制
        </button>
        <button
          type="button"
          className="m-btn m-btn-soft"
          style={{ flex: 1, minHeight: 30, color: 'var(--danger-fg)' }}
          onClick={() => {
            if (window.confirm(`删除模板「${t.name}」？删除后新访谈不再使用它；已填写的记录不受影响（至少保留一个模板）。`)) {
              onDelete();
            }
          }}
        >
          <MIcon name="trash" size={14} />
          删除
        </button>
      </div>
    </div>
  );
}

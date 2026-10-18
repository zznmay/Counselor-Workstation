/**
 * 心理访谈记录单模板编辑：共享草稿状态与用例（桌面 antd Modal 与移动端
 * FilterSheet 共用）。UI 各自渲染，逻辑全部收敛在本文件。
 *
 * 业务规则（与服务端 lib/interviewTemplate.js 同口径）：
 * - 适用年级多选；不选 = 全部年级适用；同一年级命中多个模板时按最近编辑的生效；
 * - 题目 key 一经使用不可变更（变更等于丢失该题历史答案）——编辑只改题干/上限/行数；
 * - 删除模板至少保留一个；历史记录用填写时的快照渲染，不受改题影响。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createInterviewTemplate,
  deleteInterviewTemplate,
  getInterviewTemplates,
  updateInterviewTemplate,
} from '@/api/mental';
import { getGradeOptions } from '@/api/classes';
import type { InterviewTemplate, InterviewTemplateGroup, InterviewTemplateInput } from '@/types';

export interface DraftQuestion {
  key: string;
  text: string;
  placeholder: string;
  max: number;
  rows: number;
}

export interface DraftGroup {
  title: string;
  questions: DraftQuestion[];
}

export interface TemplateDraft {
  /** null = 新建 */
  id: string | null;
  name: string;
  grades: string[];
  groups: DraftGroup[];
}

const MAX_GROUPS = 20;
const MAX_QUESTIONS = 30;

function newKey() {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function questionOf(q: InterviewTemplateGroup['questions'][number]): DraftQuestion {
  return {
    key: q.key,
    text: q.text,
    placeholder: q.placeholder ?? '',
    max: q.max,
    rows: q.rows,
  };
}

/** 由模板行构建草稿 */
export function draftFromTemplate(t: InterviewTemplate): TemplateDraft {
  return {
    id: t.id,
    name: t.name,
    grades: [...t.grades],
    groups: t.groups.map((g) => ({ title: g.title, questions: g.questions.map(questionOf) })),
  };
}

/** 新建草稿：一组两题起步（避免空单） */
export function emptyDraft(): TemplateDraft {
  return {
    id: null,
    name: '',
    grades: [],
    groups: [
      {
        title: '一、',
        questions: [
          { key: newKey(), text: '', placeholder: '', max: 500, rows: 3 },
          { key: newKey(), text: '', placeholder: '', max: 500, rows: 3 },
        ],
      },
    ],
  };
}

/** 前端预校验（与服务端同口径；返回错误文案或 null） */
export function validateDraft(draft: TemplateDraft): string | null {
  if (!draft.name.trim()) return '请填写模板名称';
  if (draft.name.trim().length > 50) return '模板名称不可超过 50 个字';
  if (draft.groups.length === 0) return '至少需要一个题目分组';
  if (draft.groups.length > MAX_GROUPS) return `题目分组不可超过 ${MAX_GROUPS} 个`;
  const keys = new Set<string>();
  let total = 0;
  for (const [gi, g] of draft.groups.entries()) {
    if (!g.title.trim()) return `第 ${gi + 1} 个分组标题不能为空`;
    if (g.title.trim().length > 50) return `第 ${gi + 1} 个分组标题不可超过 50 个字`;
    if (g.questions.length === 0) return `分组「${g.title.trim()}」至少需要一道题`;
    if (g.questions.length > MAX_QUESTIONS) return `分组「${g.title.trim()}」题目不可超过 ${MAX_QUESTIONS} 道`;
    for (const [qi, q] of g.questions.entries()) {
      if (!q.text.trim()) return `「${g.title.trim()}」第 ${qi + 1} 题题干不能为空`;
      if (q.text.trim().length > 500) return `「${g.title.trim()}」第 ${qi + 1} 题题干不可超过 500 字`;
      if (q.placeholder.length > 200) return `「${g.title.trim()}」第 ${qi + 1} 题提示不可超过 200 字`;
      if (!Number.isInteger(q.max) || q.max < 10 || q.max > 5000) {
        return `「${g.title.trim()}」第 ${qi + 1} 题字数上限需为 10-5000`;
      }
      if (!Number.isInteger(q.rows) || q.rows < 1 || q.rows > 20) {
        return `「${g.title.trim()}」第 ${qi + 1} 题行数需为 1-20`;
      }
      if (keys.has(q.key)) return `题目 key 重复（${q.key}），请刷新后重试`;
      keys.add(q.key);
      total += 1;
    }
  }
  if (total === 0) return '至少需要一道题';
  return null;
}

/** 草稿 → 接口入参 */
export function draftToInput(draft: TemplateDraft): InterviewTemplateInput {
  return {
    name: draft.name.trim(),
    grades: [...draft.grades],
    groups: draft.groups.map((g) => ({
      title: g.title.trim(),
      questions: g.questions.map((q) => ({
        key: q.key,
        text: q.text.trim(),
        ...(q.placeholder.trim() ? { placeholder: q.placeholder.trim() } : {}),
        max: q.max,
        rows: q.rows,
      })),
    })),
  };
}

/** 数组移动（from → to；其余保持顺序） */
function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface TemplateEditorApi {
  templates: InterviewTemplate[];
  loading: boolean;
  saving: boolean;
  gradeOptions: string[];
  /** 当前编辑草稿；null = 未进入编辑 */
  draft: TemplateDraft | null;
  error: string;
  startCreate: () => void;
  startEdit: (t: InterviewTemplate) => void;
  cancelEdit: () => void;
  patchDraft: (patch: Partial<TemplateDraft>) => void;
  toggleGrade: (grade: string) => void;
  addGroup: () => void;
  removeGroup: (gi: number) => void;
  moveGroup: (gi: number, dir: -1 | 1) => void;
  patchGroupTitle: (gi: number, title: string) => void;
  addQuestion: (gi: number) => void;
  removeQuestion: (gi: number, qi: number) => void;
  moveQuestion: (gi: number, qi: number, dir: -1 | 1) => void;
  patchQuestion: (gi: number, qi: number, patch: Partial<DraftQuestion>) => void;
  /** 保存当前草稿；返回是否成功 */
  save: () => Promise<boolean>;
  /** 删除指定模板；返回是否成功 */
  remove: (id: string) => Promise<boolean>;
}

/** 模板编辑用例（两端共用） */
export function useTemplateEditor(options: {
  onSaved?: (t: InterviewTemplate) => void;
  onDeleted?: (t: InterviewTemplate) => void;
} = {}): TemplateEditorApi {
  const [templates, setTemplates] = useState<InterviewTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    getInterviewTemplates()
      .then(setTemplates)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    getGradeOptions()
      .then((opts) => setGradeOptions(opts.map((o) => o.name)))
      .catch(() => undefined);
  }, [reload]);

  const startCreate = useCallback(() => {
    setError('');
    setDraft(emptyDraft());
  }, []);

  const startEdit = useCallback((t: InterviewTemplate) => {
    setError('');
    setDraft(draftFromTemplate(t));
  }, []);

  const cancelEdit = useCallback(() => {
    setError('');
    setDraft(null);
  }, []);

  const patchDraft = useCallback((patch: Partial<TemplateDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const toggleGrade = useCallback((grade: string) => {
    setDraft((d) => (d
      ? { ...d, grades: d.grades.includes(grade) ? d.grades.filter((g) => g !== grade) : [...d.grades, grade] }
      : d));
  }, []);

  const addGroup = useCallback(() => {
    setDraft((d) => (d
      ? {
        ...d,
        groups: [
          ...d.groups,
          { title: `${'一二三四五六七八九十'[Math.min(d.groups.length, 9)]}、`, questions: [{ key: newKey(), text: '', placeholder: '', max: 500, rows: 3 }] },
        ],
      }
      : d));
  }, []);

  const removeGroup = useCallback((gi: number) => {
    setDraft((d) => (d && d.groups.length > 1 ? { ...d, groups: d.groups.filter((_, i) => i !== gi) } : d));
  }, []);

  const moveGroup = useCallback((gi: number, dir: -1 | 1) => {
    setDraft((d) => (d ? { ...d, groups: move(d.groups, gi, gi + dir) } : d));
  }, []);

  const patchGroupTitle = useCallback((gi: number, title: string) => {
    setDraft((d) => (d
      ? { ...d, groups: d.groups.map((g, i) => (i === gi ? { ...g, title } : g)) }
      : d));
  }, []);

  const addQuestion = useCallback((gi: number) => {
    setDraft((d) => (d
      ? {
        ...d,
        groups: d.groups.map((g, i) => (i === gi
          ? { ...g, questions: [...g.questions, { key: newKey(), text: '', placeholder: '', max: 500, rows: 3 }] }
          : g)),
      }
      : d));
  }, []);

  const removeQuestion = useCallback((gi: number, qi: number) => {
    setDraft((d) => (d
      ? {
        ...d,
        groups: d.groups.map((g, i) => (i === gi ? { ...g, questions: g.questions.filter((_, j) => j !== qi) } : g)),
      }
      : d));
  }, []);

  const moveQuestion = useCallback((gi: number, qi: number, dir: -1 | 1) => {
    setDraft((d) => (d
      ? {
        ...d,
        groups: d.groups.map((g, i) => (i === gi ? { ...g, questions: move(g.questions, qi, qi + dir) } : g)),
      }
      : d));
  }, []);

  const patchQuestion = useCallback((gi: number, qi: number, patch: Partial<DraftQuestion>) => {
    setDraft((d) => (d
      ? {
        ...d,
        groups: d.groups.map((g, i) => (i === gi
          ? { ...g, questions: g.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) }
          : g)),
      }
      : d));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    const err = validateDraft(draft);
    if (err) {
      setError(err);
      return false;
    }
    setSaving(true);
    setError('');
    try {
      const input = draftToInput(draft);
      const out = draft.id
        ? await updateInterviewTemplate(draft.id, input)
        : await createInterviewTemplate(input);
      setTemplates((prev) => (draft.id
        ? prev.map((t) => (t.id === out.id ? out : t))
        : [out, ...prev]));
      setDraft(null);
      options.onSaved?.(out);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, options]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const target = templates.find((t) => t.id === id);
    setSaving(true);
    setError('');
    try {
      await deleteInterviewTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setDraft((d) => (d && d.id === id ? null : d));
      if (target) options.onDeleted?.(target);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [templates, options]);

  return useMemo(() => ({
    templates,
    loading,
    saving,
    gradeOptions,
    draft,
    error,
    startCreate,
    startEdit,
    cancelEdit,
    patchDraft,
    toggleGrade,
    addGroup,
    removeGroup,
    moveGroup,
    patchGroupTitle,
    addQuestion,
    removeQuestion,
    moveQuestion,
    patchQuestion,
    save,
    remove,
  }), [
    templates, loading, saving, gradeOptions, draft, error,
    startCreate, startEdit, cancelEdit, patchDraft, toggleGrade,
    addGroup, removeGroup, moveGroup, patchGroupTitle,
    addQuestion, removeQuestion, moveQuestion, patchQuestion,
    save, remove,
  ]);
}

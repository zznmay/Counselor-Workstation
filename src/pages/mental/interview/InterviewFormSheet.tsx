/**
 * 移动端「心理访谈记录单」全屏分步向导。
 * 步骤由生效记录单模板的分组动态生成（每组两步、最后一步为评估与签字）：
 * 编辑历史记录时按该记录填写时的题目快照渲染与校验（record.formGroups）。
 * 每步只校验当前步字段，草稿存 sessionStorage（按学生+学期），
 * 软键盘由 FilterSheet fullscreen 适配。
 */
import { useEffect, useState } from 'react';

import { createMentalInterview, updateMentalInterview } from '@/api/mental';
import FilterSheet from '@/components/mobile/FilterSheet';
import {
  DEFAULT_INTERVIEW_FORM,
  INTERVIEW_DATE_LABEL,
  INTERVIEW_LEVELS,
  INTERVIEW_REQUIRED,
  LEVEL_ASSESSMENT_LABEL,
  SIGNATURE_CONFIRM_TEXT,
} from '@/constants/interview';
import { getStoredUser } from '@/lib/auth';
import { currentSemester, previousSemester, todayCN } from '@/lib/semester';
import type { InterviewFormModel, InterviewLevel, MentalInterview } from '@/types';
import {
  answerLength,
  collectAnswersWith,
  formQuestionMeta,
  groupTitleShort,
  recordFormOf,
} from './shared';

export interface InterviewStudentRefM {
  id: string;
  name: string;
  className?: string | null;
  studentNo?: string;
}

interface InterviewFormSheetProps {
  open: boolean;
  student: InterviewStudentRefM | null;
  /** 编辑态传入记录 */
  record?: MentalInterview | null;
  /** 生效记录单模板（新增态按学生年级解析；缺省用内置默认单） */
  form?: InterviewFormModel;
  onClose: () => void;
  onSaved: (result: { done: number; levelSynced: boolean; levelAfter: InterviewLevel }) => void;
}

type FormState = {
  [key: string]: string | boolean | InterviewLevel;
  levelAfter: InterviewLevel | '';
  interviewDate: string;
  confirmed: boolean;
};

/** 由模板分组构建向导步骤：每步最多 2 个分组，末步固定为「评估与签字」 */
function buildSteps(form: InterviewFormModel): { title: string; keys: string[] }[] {
  const steps: { title: string; keys: string[] }[] = [];
  for (let i = 0; i < form.groups.length; i += 2) {
    const chunk = form.groups.slice(i, i + 2);
    steps.push({
      title: chunk.map((g) => groupTitleShort(g.title)).join('・'),
      keys: chunk.flatMap((g) => g.questions.map((q) => q.key)),
    });
  }
  steps.push({ title: '评估与签字', keys: [] });
  return steps;
}

function emptyState(form: InterviewFormModel): FormState {
  const base: FormState = { levelAfter: '', interviewDate: todayCN(), confirmed: false };
  for (const key of Object.keys(formQuestionMeta(form))) base[key] = '';
  return base;
}

function draftKeyOf(studentId: string, semesterKey: string) {
  return `mentalInterviewDraft:${studentId}:${semesterKey}`;
}

export default function InterviewFormSheet({ open, student, record, form, onClose, onSaved }: InterviewFormSheetProps) {
  const authUser = getStoredUser();
  // 生效表单：编辑态用记录快照（模板改题不追溯）；新增态用按年级解析的模板
  const activeForm = record
    ? recordFormOf(record, form ?? DEFAULT_INTERVIEW_FORM)
    : (form ?? DEFAULT_INTERVIEW_FORM);
  const STEPS = buildSteps(activeForm);
  const meta = formQuestionMeta(activeForm);

  const [state, setState] = useState<FormState>(() => emptyState(activeForm));
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);

  /** .m-sheet-body 是唯一滚动容器（FilterSheet 内部），换步后回顶 */
  const scrollBodyTop = () => {
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('.m-sheet-full .m-sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 30);
  };

  const semester = currentSemester();
  const prevSem = previousSemester(semester);
  const isEdit = !!record;

  // 打开时初始化：编辑态回填记录；新增态恢复草稿
  useEffect(() => {
    if (!open || !student) return;
    setError('');
    setStep(0);
    setRestored(false);
    if (record) {
      setState({
        ...record.answers,
        levelAfter: record.levelAfter,
        interviewDate: record.interviewDate,
        confirmed: true,
      });
      return;
    }
    const key = draftKeyOf(String(student.id), semester.key);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as FormState;
        if (draft && typeof draft === 'object') {
          setState({ ...emptyState(activeForm), ...draft });
          setRestored(true);
          return;
        }
      }
    } catch { /* 草稿损坏则忽略 */ }
    setState(emptyState(activeForm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record, student?.id]);

  // 草稿持久化（编辑态不写草稿）
  useEffect(() => {
    if (!open || isEdit || !student) return;
    try {
      sessionStorage.setItem(draftKeyOf(String(student.id), semester.key), JSON.stringify(state));
    } catch { /* 存储满则忽略 */ }
  }, [state, open, isEdit, student, semester.key]);

  const hasContent = Object.keys(meta).some((k) => String(state[k] ?? '').trim() !== '')
    || state.levelAfter !== '' || state.confirmed;

  const clearDraft = () => {
    if (student && !isEdit) {
      try { sessionStorage.removeItem(draftKeyOf(String(student.id), semester.key)); } catch { /* ignore */ }
    }
    setState(emptyState(activeForm));
    setRestored(false);
    setError('');
  };

  const attemptClose = () => {
    if (!isEdit && hasContent && !window.confirm('放弃已填写的内容？')) return;
    onClose();
  };

  const jumpToField = (key: string) => {
    window.setTimeout(() => {
      document.getElementById(`iv-f-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
  };

  const validateKeys = (keys: string[]): boolean => {
    for (const key of keys) {
      const q = meta[key];
      if (!q) continue;
      const v = String(state[key] ?? '').trim();
      if (!v) {
        setError(`请填写：${q.text.slice(0, 18)}…`);
        jumpToField(key);
        return false;
      }
      if (v.length > q.max) {
        setError(`「${q.group}」一题不可超过 ${q.max} 字`);
        jumpToField(key);
        return false;
      }
      // 字数下限：min = 0 表示不限制（历史题目行为不变）
      if (q.min > 0 && v.length < q.min) {
        setError(`「${q.group}」一题不少于 ${q.min} 字，当前 ${v.length} 字，请补充后再提交`);
        jumpToField(key);
        return false;
      }
    }
    return true;
  };

  const goNext = () => {
    setError('');
    if (!validateKeys(STEPS[step].keys)) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    scrollBodyTop();
  };

  const goPrev = () => {
    setError('');
    setStep((s) => Math.max(0, s - 1));
    scrollBodyTop();
  };

  const submit = async () => {
    if (!student) return;
    setError('');
    // 全量校验：从第一个未通过的步骤开始提示
    for (let i = 0; i < STEPS.length; i += 1) {
      if (!validateKeys(STEPS[i].keys)) {
        setStep(i);
        return;
      }
    }
    if (!state.levelAfter) {
      setError('请选择访谈后关注等级评估');
      return;
    }
    const d = state.interviewDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setError('请选择访谈时间');
      return;
    }
    if (d > todayCN()) {
      setError('访谈时间不能晚于今天');
      return;
    }
    if (d < prevSem.startDate) {
      setError('访谈时间最早可选择上一学期（假期补录）');
      return;
    }
    if (!state.confirmed) {
      setError('请勾选签字确认');
      return;
    }

    const answers = collectAnswersWith(state, activeForm);
    const payload = {
      interviewDate: d,
      levelAfter: state.levelAfter as InterviewLevel,
      answers,
      summary: answers.summary ?? '',
      signatureConfirmed: true,
      ...(!isEdit ? { clientRequestId: crypto.randomUUID() } : {}),
    };

    setSaving(true);
    try {
      if (isEdit && record) {
        const res = await updateMentalInterview(record.id, payload);
        onSaved({ done: res.done, levelSynced: res.levelSynced, levelAfter: payload.levelAfter });
      } else {
        const res = await createMentalInterview({ studentId: String(student.id), ...payload });
        if (student && !isEdit) {
          try { sessionStorage.removeItem(draftKeyOf(String(student.id), semester.key)); } catch { /* ignore */ }
        }
        onSaved({ done: res.done, levelSynced: res.levelSynced, levelAfter: payload.levelAfter });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSaving(false);
    }
  };

  const questionField = (key: string) => {
    const q = meta[key];
    const len = answerLength(state[key]);
    // 下限未达标时计数标红，给出即时反馈（提交时仍以 validateKeys 的拦截为准）
    const belowMin = q.min > 0 && len < q.min;
    return (
      <div className="m-field" key={key} id={`iv-f-${key}`}>
        <label htmlFor={`iv-i-${key}`}>{q.text}<span className="m-req">*</span></label>
        {q.min > 0 && (
          <div className="m-t4" style={{ marginBottom: 4 }}>
            本题不少于 {q.min} 字，最多 {q.max} 字
          </div>
        )}
        <textarea
          id={`iv-i-${key}`}
          className="m-inp"
          rows={q.rows}
          maxLength={q.max}
          placeholder={q.placeholder}
          value={String(state[key] ?? '')}
          onChange={(e) => setState((s) => ({ ...s, [key]: e.target.value }))}
        />
        <div
          className="m-t4"
          style={{ textAlign: 'right', marginTop: 2, color: belowMin ? 'var(--warning-fg)' : undefined }}
        >
          {q.min > 0 ? `${len}/${q.min}-${q.max}` : `${len}/${q.max}`}
        </div>
      </div>
    );
  };

  const renderStep = () => {
    if (step < STEPS.length - 1) {
      const keys = STEPS[step].keys;
      const groups = new Map<string, string[]>();
      for (const key of keys) {
        const q = meta[key];
        if (!q) continue;
        const list = groups.get(q.group) ?? [];
        list.push(key);
        groups.set(q.group, list);
      }
      return (
        <>
          {[...groups.entries()].map(([group, groupKeys]) => (
            <div key={group}>
              <div className="m-group-title">{group}</div>
              {groupKeys.map(questionField)}
            </div>
          ))}
        </>
      );
    }
    return (
      <>
        <div className="m-field">
          <label>{LEVEL_ASSESSMENT_LABEL}<span className="m-req">*</span></label>
          <div className="m-seg" style={{ flexWrap: 'wrap' }}>
            {INTERVIEW_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`m-seg-btn${state.levelAfter === l ? ' on' : ''}`}
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap', paddingInline: 12 }}
                onClick={() => setState((s) => ({ ...s, levelAfter: l }))}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="m-t4" style={{ marginTop: 4 }}>
            评估为「无需关注」将把该生标记为无需关注并保留在心理健康模块中；其他等级将同步更新。
          </div>
        </div>
        <div className="m-field" id="iv-f-date">
          <label htmlFor="iv-i-date">{INTERVIEW_DATE_LABEL}<span className="m-req">*</span></label>
          <input
            id="iv-i-date"
            className="m-inp"
            type="date"
            min={prevSem.startDate}
            max={todayCN()}
            value={state.interviewDate}
            onChange={(e) => setState((s) => ({ ...s, interviewDate: e.target.value }))}
          />
          <div className="m-t4" style={{ marginTop: 4 }}>
            可选范围：{prevSem.startDate}（上一学期）至今天
          </div>
        </div>
        <div className="m-field">
          <label>访谈教师签字</label>
          <div className="m-t3">电子签名：{authUser?.displayName ?? '—'}</div>
        </div>
        <div className="m-field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
            <input
              type="checkbox"
              style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--app-primary-action)' }}
              checked={state.confirmed}
              onChange={(e) => setState((s) => ({ ...s, confirmed: e.target.checked }))}
            />
            <span>{SIGNATURE_CONFIRM_TEXT}<span className="m-req">*</span></span>
          </label>
        </div>
      </>
    );
  };

  return (
    <FilterSheet
      open={open}
      title={isEdit ? `修订访谈 · ${student?.name ?? ''}` : `心理访谈记录单 · ${student?.name ?? ''}`}
      onClose={attemptClose}
      fullscreen
      dismissible={false}
      footer={
        <>
          {step > 0 && (
            <button type="button" className="m-btn m-btn-ghost" disabled={saving} onClick={goPrev}>
              上一步
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={goNext}>
              下一步
            </button>
          ) : (
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={submit}>
              {saving ? '提交中…' : isEdit ? '保存修订' : '提交访谈'}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="m-step-head">
            <span className="m-step-title">第 {step + 1}/{STEPS.length} 步 · {STEPS[step].title}</span>
            <span className="m-step-index">{student?.className ?? ''} · {student?.name ?? ''}</span>
          </div>
          <div className="m-step-bar" aria-hidden="true">
            <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        <div className="m-t4">
          记录单：{activeForm.name}
          {activeForm.grades.length > 0 ? `（适用年级：${activeForm.grades.join('、')}）` : '（全部年级适用）'}
        </div>

        {restored && (
          <div className="m-notice-card m-card" data-tone="info" style={{ padding: '8px 12px' }}>
            <div className="m-t4">已恢复上次未提交的草稿。</div>
            <div className="m-notice-actions">
              <button type="button" className="m-btn m-btn-ghost" onClick={clearDraft}>清空重填</button>
            </div>
          </div>
        )}

        {error && (
          <div className="m-notice-card m-card" data-tone="warning" style={{ padding: '8px 12px' }}>
            <div className="m-t3" style={{ color: 'var(--warning-fg)' }}>{error}</div>
          </div>
        )}

        {renderStep()}
      </div>
    </FilterSheet>
  );
}

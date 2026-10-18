/**
 * 心理访谈组件共用工具：问答配对、等级变更日志展示文案、表单模型助手。
 * PC（antd）与移动端（m-* 样式）的渲染各自实现，但文案与数据结构共用本文件。
 * 题目以「生效记录单模板」为准（服务端按学生年级解析）；历史记录用填写时的快照渲染。
 */
import type {
  InterviewFormModel,
  InterviewTemplateGroup,
  InterviewTemplateQuestion,
  MentalInterview,
  MentalLevelLog,
} from '@/types';

/** 等级变更来源 → 展示标签 */
export const LEVEL_LOG_SOURCE_LABELS: Record<MentalLevelLog['source'], string> = {
  init: '初始化',
  manual: '手工调整',
  interview: '访谈评估',
  'interview-edit': '访谈修订',
  'interview-delete': '记录作废',
};

/** 等级变更来源 → antd Tag 颜色 */
export const LEVEL_LOG_SOURCE_COLORS: Record<MentalLevelLog['source'], string> = {
  init: 'default',
  manual: 'blue',
  interview: 'geekblue',
  'interview-edit': 'purple',
  'interview-delete': 'red',
};

/** 日志里的等级文案：null = 未标记或取消关注 */
export function levelLogText(level: string | null | undefined): string {
  return level ? level : '取消关注';
}

/**
 * 历史记录的表单模型：优先用填写时的题目快照（模板改题不追溯），
 * 老记录无快照时回退当前生效模板。
 */
export function recordFormOf(record: MentalInterview, fallback: InterviewFormModel): InterviewFormModel {
  const groups = Array.isArray(record.formGroups) && record.formGroups.length > 0
    ? record.formGroups
    : fallback.groups;
  return { ...fallback, id: record.templateId ?? fallback.id, groups };
}

export interface InterviewQa {
  key: string;
  group: string;
  question: string;
  answer: string;
}

/** 记录的问答配对（按表单顺序；answers 缺失时留空串） */
export function recordQaPairs(record: MentalInterview, form: InterviewFormModel): InterviewQa[] {
  return form.groups.flatMap((group) =>
    group.questions.map((q) => ({
      key: q.key,
      group: group.title,
      question: q.text,
      answer: record.answers?.[q.key] ?? '',
    })),
  );
}

/** 表单题目总数 */
export function formQuestionCount(form: InterviewFormModel): number {
  return form.groups.reduce((n, g) => n + g.questions.length, 0);
}

/** 题目元信息扁平表（移动端步骤渲染/校验用） */
export interface InterviewQuestionMeta {
  key: string;
  group: string;
  text: string;
  placeholder?: string;
  max: number;
  rows: number;
}

export function formQuestionMeta(form: InterviewFormModel): Record<string, InterviewQuestionMeta> {
  return Object.fromEntries(
    form.groups.flatMap((group) =>
      group.questions.map((q) => [q.key, {
        key: q.key,
        group: group.title,
        text: q.text,
        placeholder: q.placeholder,
        max: q.max,
        rows: q.rows,
      }]),
    ),
  );
}

/** 按表单题目收集答案（trim；移动端与 PC 共用；白名单外 key 忽略） */
export function collectAnswersWith(values: Record<string, unknown>, form: InterviewFormModel): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const group of form.groups) {
    for (const q of group.questions) {
      answers[q.key] = String(values[q.key] ?? '').trim();
    }
  }
  return answers;
}

/** 表单全部题目 key（顺序即渲染顺序） */
export function formQuestionKeys(form: InterviewFormModel): string[] {
  return form.groups.flatMap((g) => g.questions.map((q) => q.key));
}

/** 分组标题简写（去掉「一、」类序号前缀，用于移动端步骤标题） */
export function groupTitleShort(title: string): string {
  const m = /^[一二三四五六七八九十]+、(.+)$/.exec(title);
  return m ? m[1] : title;
}

export type { InterviewTemplateGroup, InterviewTemplateQuestion };

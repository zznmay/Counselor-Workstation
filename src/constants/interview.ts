/**
 * 心理访谈表单常量：题目分组、题干、上限与评估等级。
 * 本题单为「内置默认记录单」——与纸质《心理访谈记录单（期末大一大二）》逐字对齐；
 * 线上生效题目以服务端按年级解析的模板为准（GET /mental/interviews 返回 form），
 * 本常量仅用于模板播种对齐、历史记录兜底与无网演示。
 * key 为服务端 answers 白名单的唯一事实来源（一经使用不得变更）。
 */
import type { InterviewFormModel, InterviewLevel } from '@/types';

/** 每名学生每学期至少提交次数（服务端 REQUIRED_COUNT 同值） */
export const INTERVIEW_REQUIRED = 2;

/** 访谈后评估等级：与关注列表 5 档 ATTENTION_LEVELS 完全一致（含「无需关注」） */
export const INTERVIEW_LEVELS: InterviewLevel[] = ['无需关注', '一般关注', '日常关注', '重点关注', '密切关注'];

export interface InterviewQuestion {
  key: string;
  /** 题干（纸质表原文） */
  text: string;
  /** 预填提示 */
  placeholder?: string;
  max: number;
  rows: number;
}

export interface InterviewQuestionGroup {
  /** 分组标题（对应纸质表分区标题） */
  title: string;
  questions: InterviewQuestion[];
}

/** 逐题定义（顺序即纸质表顺序） */
export const INTERVIEW_QUESTION_GROUPS: InterviewQuestionGroup[] = [
  {
    title: '一、学生近期学习情况',
    questions: [
      {
        key: 'q_study_pressure',
        text: '临近期末考试了，你有感到紧张和学习压力增加吗？如果是，你觉得主要是哪些方面造成的？',
        max: 500,
        rows: 3,
        placeholder: '如：临近期末有些紧张，主要担心两门专业课不及格，复习计划偏乱',
      },
      {
        key: 'q_study_reaction',
        text: '你在面对学习压力时有哪些身体或情绪上的反应？是否有焦虑、失眠、注意力不集中等问题？',
        max: 500,
        rows: 3,
        placeholder: '如：偶有失眠、注意力不集中，白天容易烦躁，考试周加重',
      },
    ],
  },
  {
    title: '二、学生近期睡眠情况',
    questions: [
      {
        key: 'q_sleep_schedule',
        text: '你最近通常几点入睡和几点醒来？是否存在入睡困难的情况？',
        max: 500,
        rows: 3,
        placeholder: '如：一般 1 点入睡、7 点半起床，入睡需 30 分钟以上，偶有入睡困难',
      },
      {
        key: 'q_sleep_impact',
        text: '你觉得近期睡眠问题对你的日常生活、学习或情绪状态有何影响？',
        max: 500,
        rows: 3,
        placeholder: '如：白天上课犯困、复习效率下降，情绪略显低落',
      },
    ],
  },
  {
    title: '三、学生近期生活状况',
    questions: [
      {
        key: 'q_life_emotion',
        text: '近期你在校生活是否出现过情绪波动、情绪低落或焦虑等情况？请描述一下你的具体感受和表现',
        max: 500,
        rows: 3,
        placeholder: '如：近两周两次情绪低落，每次约半天，可自行缓解，未见明显诱因',
      },
      {
        key: 'q_life_event',
        text: '最近生活中是否有遇到过重大负面事件（包括至亲去世、被诈骗、失恋等）',
        max: 500,
        rows: 3,
        placeholder: '如：无重大负面事件；如有请写明事件与当前影响',
      },
    ],
  },
  {
    title: '四、学生同家长的联系沟通情况',
    questions: [
      {
        key: 'q_family_contact',
        text: '你同家人一般多久沟通一次？最近一次沟通在什么时候？是否融洽？',
        max: 500,
        rows: 3,
        placeholder: '如：每周与母亲通话一次，最近一次为上周日，沟通融洽',
      },
      {
        key: 'q_family_support',
        text: '在困难或挫折面前，你觉得家人对你的支持程度如何？他们在你需要帮助时会给予支持和鼓励吗？',
        max: 500,
        rows: 3,
        placeholder: '如：家人支持度较高，遇到困难会主动鼓励并给建议',
      },
    ],
  },
  {
    title: '五、学生社交人际关系情况',
    questions: [
      {
        key: 'q_social_dorm',
        text: '你觉得你们寝室（或班级）氛围如何？你和同学相处有遇到过什么困难吗？',
        max: 500,
        rows: 3,
        placeholder: '如：寝室氛围融洽，与同学相处无明显困难',
      },
    ],
  },
  {
    title: '六、学生目前情况概述',
    questions: [
      {
        key: 'summary',
        text: '学生目前情况概述（请写清楚学生目前精神状态是否正常）',
        max: 800,
        rows: 4,
        placeholder: '请写清楚学生目前精神状态是否正常，以及主要表现、判断依据与后续安排',
      },
    ],
  },
];

/** 全部题目 key（与组件逐题渲染/校验共用） */
export const INTERVIEW_QUESTION_KEYS = INTERVIEW_QUESTION_GROUPS.flatMap((g) => g.questions.map((q) => q.key));

/** 签字确认文案（纸质表「访谈教师签字」的电子化替代） */
export const SIGNATURE_CONFIRM_TEXT = '本人确认以上访谈记录真实完整，电子签名与纸质签字具有同等效力';

/** 「访谈后关注等级评估」题干（纸质表原文） */
export const LEVEL_ASSESSMENT_LABEL = '访谈后关注等级评估';

/** 「访谈时间」题干（纸质表为 年 月 日） */
export const INTERVIEW_DATE_LABEL = '访谈时间';

/** 内置默认记录单（库内无启用模板时的兜底模型；须在题目分组声明之后） */
export const DEFAULT_INTERVIEW_FORM: InterviewFormModel = {
  id: null,
  name: '内置默认记录单',
  grades: [],
  levels: [],
  groups: INTERVIEW_QUESTION_GROUPS,
  version: 1,
};

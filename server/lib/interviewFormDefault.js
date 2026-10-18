/**
 * 心理访谈记录单「内置默认模板」纯数据（无任何依赖，供 db.js 播种与
 * interviewTemplate.js 兜底共用）。
 *
 * 题目与纸质《心理访谈记录单（期末大一大二）》逐字对齐，与前端
 * `src/constants/interview.ts` 的 INTERVIEW_QUESTION_GROUPS 保持同源同序：
 * key 为 answers JSON 的唯一标识，一经使用不得变更（变更等于丢历史答案）。
 * 管理员可在「记录单模板」中复制后改题；本文件仅作为初始种子与最终兜底。
 */
const DEFAULT_TEMPLATE_ID = 'tpl_default';
const DEFAULT_TEMPLATE_NAME = '心理访谈记录单（默认模板）';

const DEFAULT_FORM_GROUPS = [
  {
    title: '一、学生近期学习情况',
    questions: [
      {
        key: 'q_study_pressure',
        text: '临近期末考试了，你有感到紧张和学习压力增加吗？如果是，你觉得主要是哪些方面造成的？',
        placeholder: '如：临近期末有些紧张，主要担心两门专业课不及格，复习计划偏乱',
        max: 500,
        rows: 3,
      },
      {
        key: 'q_study_reaction',
        text: '你在面对学习压力时有哪些身体或情绪上的反应？是否有焦虑、失眠、注意力不集中等问题？',
        placeholder: '如：偶有失眠、注意力不集中，白天容易烦躁，考试周加重',
        max: 500,
        rows: 3,
      },
    ],
  },
  {
    title: '二、学生近期睡眠情况',
    questions: [
      {
        key: 'q_sleep_schedule',
        text: '你最近通常几点入睡和几点醒来？是否存在入睡困难的情况？',
        placeholder: '如：一般 1 点入睡、7 点半起床，入睡需 30 分钟以上，偶有入睡困难',
        max: 500,
        rows: 3,
      },
      {
        key: 'q_sleep_impact',
        text: '你觉得近期睡眠问题对你的日常生活、学习或情绪状态有何影响？',
        placeholder: '如：白天上课犯困、复习效率下降，情绪略显低落',
        max: 500,
        rows: 3,
      },
    ],
  },
  {
    title: '三、学生近期生活状况',
    questions: [
      {
        key: 'q_life_emotion',
        text: '近期你在校生活是否出现过情绪波动、情绪低落或焦虑等情况？请描述一下你的具体感受和表现',
        placeholder: '如：近两周两次情绪低落，每次约半天，可自行缓解，未见明显诱因',
        max: 500,
        rows: 3,
      },
      {
        key: 'q_life_event',
        text: '最近生活中是否有遇到过重大负面事件（包括至亲去世、被诈骗、失恋等）',
        placeholder: '如：无重大负面事件；如有请写明事件与当前影响',
        max: 500,
        rows: 3,
      },
    ],
  },
  {
    title: '四、学生同家长的联系沟通情况',
    questions: [
      {
        key: 'q_family_contact',
        text: '你同家人一般多久沟通一次？最近一次沟通在什么时候？是否融洽？',
        placeholder: '如：每周与母亲通话一次，最近一次为上周日，沟通融洽',
        max: 500,
        rows: 3,
      },
      {
        key: 'q_family_support',
        text: '在困难或挫折面前，你觉得家人对你的支持程度如何？他们在你需要帮助时会给予支持和鼓励吗？',
        placeholder: '如：家人支持度较高，遇到困难会主动鼓励并给建议',
        max: 500,
        rows: 3,
      },
    ],
  },
  {
    title: '五、学生社交人际关系情况',
    questions: [
      {
        key: 'q_social_dorm',
        text: '你觉得你们寝室（或班级）氛围如何？你和同学相处有遇到过什么困难吗？',
        placeholder: '如：寝室氛围融洽，与同学相处无明显困难',
        max: 500,
        rows: 3,
      },
    ],
  },
  {
    title: '六、学生目前情况概述',
    questions: [
      {
        key: 'summary',
        text: '学生目前情况概述（请写清楚学生目前精神状态是否正常）',
        placeholder: '请写清楚学生目前精神状态是否正常，以及主要表现、判断依据与后续安排',
        max: 800,
        rows: 4,
      },
    ],
  },
];

module.exports = { DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, DEFAULT_FORM_GROUPS };

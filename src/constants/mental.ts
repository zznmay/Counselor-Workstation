import type { AttentionLevel } from '@/types';

/** 关注等级（展示顺序即紧急程度从高到低；与服务端 routes/mental.js LEVELS 一致） */
export const ATTENTION_LEVELS: AttentionLevel[] = ['密切关注', '重点关注', '日常关注', '一般关注'];

/** 等级 → antd Tag 颜色（红→灰递减，颜色仅辅助、等级文字始终可读） */
export const ATTENTION_TAG_COLORS: Record<AttentionLevel, string> = {
  密切关注: 'red',
  重点关注: 'orange',
  日常关注: 'blue',
  一般关注: 'default',
};

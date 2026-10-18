import type { AttentionLevel } from '@/types';

/**
 * 关注等级（展示顺序即紧急程度从高到低；末位「无需关注」为留档档位——
 * 访谈评估或手工标记为该档的学生保留在心理健康模块内，仅作留档，不再安排访谈）。
 * 与服务端 routes/mental.js LEVELS 一致。
 */
export const ATTENTION_LEVELS: AttentionLevel[] = ['密切关注', '重点关注', '日常关注', '一般关注', '无需关注'];

/** 等级 → antd Tag 颜色（红→灰递减，颜色仅辅助、等级文字始终可读） */
export const ATTENTION_TAG_COLORS: Record<AttentionLevel, string> = {
  密切关注: 'red',
  重点关注: 'orange',
  日常关注: 'blue',
  一般关注: 'default',
  无需关注: 'default',
};

/**
 * 外部谈话记录平台地址：辅导员在心理健康模块点击「新增谈话」后直接跳转填写。
 * 学校既有系统，本系统不开发表单；地址为固定值（不随学生变化）。
 */
export const TALK_RECORD_EXTERNAL_URL =
  'https://xgxt-hzpt-edu-cn-s.webvpn.hzpt.edu.cn:8118/xsfw/sys/txthapphzpt/*default/index.do#/txth';

/**
 * 「新增谈话」入口仅对上述三类关注学生开放（一般关注不在范围内）。
 * 与服务端 routes/mental.js LEVELS 顺序无关，仅取需要的子集。
 */
export const TALK_RECORD_TARGET_LEVELS: AttentionLevel[] = ['密切关注', '重点关注', '日常关注'];

/** 该等级学生是否可发起外部谈话记录填写 */
export function isTalkRecordLevel(level: AttentionLevel | '' | null | undefined): boolean {
  return !!level && TALK_RECORD_TARGET_LEVELS.includes(level);
}

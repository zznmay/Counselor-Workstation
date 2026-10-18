/** 心理健康：关注标记与谈心谈话联动（服务端按带班严格限定可见范围） */
import { request } from './request';
import type {
  AttentionLevel,
  MentalCandidate,
  MentalConcern,
  MentalLevelSummary,
  MentalTimeline,
  PageResult,
} from '@/types';

/** 关注等级汇总（页首分类卡，四个等级恒齐全） */
export function getMentalSummary(): Promise<MentalLevelSummary[]> {
  return request<MentalLevelSummary[]>('/mental/summary');
}

/** 关注学生列表：等级/关键字/班级筛选 + 分页 */
export function getMentalConcerns(params: {
  page: number;
  pageSize: number;
  level?: AttentionLevel | '';
  keyword?: string;
  classId?: number;
}): Promise<PageResult<MentalConcern>> {
  const sp = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.level) sp.set('level', params.level);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.classId) sp.set('classId', String(params.classId));
  return request<PageResult<MentalConcern>>(`/mental/concerns?${sp.toString()}`);
}

/**
 * 设置/调整关注标记；level 传空串表示取消关注（服务端删除标记行）。
 * 仅所带班级学生可维护（服务端 canManageStudent 同口径校验）。
 */
export function setAttention(
  studentId: string,
  data: { level: AttentionLevel | ''; note?: string },
): Promise<{ ok: true; cleared?: true }> {
  return request<{ ok: true; cleared?: true }>(`/mental/${studentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 可标记学生候选：可见范围内、尚未标记（远端搜索） */
export function getMentalCandidates(keyword = ''): Promise<MentalCandidate[]> {
  const sp = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
  return request<MentalCandidate[]>(`/mental/candidates${sp}`);
}

/** 某学生的全部谈心谈话记录（只读打通；仅带班范围内学生） */
export function getMentalTimeline(studentId: string): Promise<MentalTimeline> {
  return request<MentalTimeline>(`/mental/timeline?studentId=${encodeURIComponent(studentId)}`);
}

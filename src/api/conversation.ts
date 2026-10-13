/** 谈心谈话记录：服务端接口（列表/时间线/增删改查） */
import { request } from './request';
import type { Conversation, ConversationInput, ConversationQuery, PageResult, TalkedStudentOption } from '@/types';

/** 列表：关键字 + 类型/方式/跟进/日期区间/学生筛选 + 分页 */
export async function getConversations(query: ConversationQuery): Promise<PageResult<Conversation>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Conversation>>(`/conversations?${params.toString()}`);
}

/** 时间线：某学生全部谈话记录（最新在前，需该学生可见） */
export async function getConversationTimeline(query: {
  studentId: string;
  type?: ConversationQuery['type'];
}): Promise<Conversation[]> {
  const params = new URLSearchParams({ studentId: query.studentId });
  if (query.type) params.set('type', query.type);
  return request<Conversation[]>(`/conversations/timeline?${params.toString()}`);
}

/** 时间线学生选项：有谈话记录的学生（按最近谈话倒序，含统计） */
export async function getTalkedStudents(): Promise<TalkedStudentOption[]> {
  return request<TalkedStudentOption[]>('/conversations/talked-students');
}

/** 新增谈话记录（学生姓名/学号由服务端按 id 反查补全） */
export async function createConversation(input: ConversationInput): Promise<void> {
  await request('/conversations', { method: 'POST', body: JSON.stringify(input) });
}

/** 编辑谈话记录 */
export async function updateConversation(id: string, input: ConversationInput): Promise<void> {
  await request(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

/** 删除谈话记录 */
export async function deleteConversation(id: string): Promise<void> {
  await request(`/conversations/${id}`, { method: 'DELETE' });
}

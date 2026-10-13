/** 通知发布：服务端接口（草稿/发布/撤回） */
import { request } from './request';
import type { Notice, NoticeInput, NoticeQuery, PageResult } from '@/types';

/** 通知列表：关键字 + 类型/状态筛选 + 分页（置顶优先，时间倒序） */
export async function getNotices(query: NoticeQuery): Promise<PageResult<Notice>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Notice>>(`/notices?${params.toString()}`);
}

/** 新建通知（默认草稿） */
export async function createNotice(input: NoticeInput): Promise<void> {
  await request('/notices', { method: 'POST', body: JSON.stringify(input) });
}

/** 编辑通知 */
export async function updateNotice(id: string, input: NoticeInput): Promise<void> {
  await request(`/notices/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

/** 发布通知 */
export async function publishNotice(id: string): Promise<void> {
  await request(`/notices/${id}/publish`, { method: 'POST' });
}

/** 撤回通知 */
export async function withdrawNotice(id: string): Promise<void> {
  await request(`/notices/${id}/withdraw`, { method: 'POST' });
}

/** 删除通知 */
export async function deleteNotice(id: string): Promise<void> {
  await request(`/notices/${id}`, { method: 'DELETE' });
}

/** 学业与心理预警：服务端接口（待处理优先排序在服务端完成） */
import { request } from './request';
import type { PageResult, Warning, WarningInput, WarningQuery } from '@/types';

/** 预警列表：关键字 + 类型/等级/状态筛选 + 分页 */
export async function getWarnings(query: WarningQuery): Promise<PageResult<Warning>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Warning>>(`/warnings?${params.toString()}`);
}

/** 录入预警（学生信息由服务端按 id 反查补全） */
export async function createWarning(input: WarningInput): Promise<void> {
  await request('/warnings', { method: 'POST', body: JSON.stringify(input) });
}

/** 编辑预警 / 更新处理措施（状态流转到已解除时服务端自动补充处理时间） */
export async function updateWarning(id: string, input: WarningInput): Promise<void> {
  await request(`/warnings/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

/** 删除预警 */
export async function deleteWarning(id: string): Promise<void> {
  await request(`/warnings/${id}`, { method: 'DELETE' });
}

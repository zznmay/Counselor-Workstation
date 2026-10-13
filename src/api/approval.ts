/** 审批中心：服务端接口（通过/驳回/登记/删除，随学生归属过滤） */
import { request } from './request';
import type { Approval, ApprovalInput, ApprovalQuery, ApprovalStatus, PageResult } from '@/types';

/** 审批列表：关键字 + 类型/状态筛选 + 分页（待审批优先，时间倒序） */
export async function getApprovals(query: ApprovalQuery): Promise<PageResult<Approval>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Approval>>(`/approvals?${params.toString()}`);
}

/** 登记申请（代学生提交，初始状态待审批） */
export async function createApproval(input: ApprovalInput): Promise<void> {
  await request('/approvals', { method: 'POST', body: JSON.stringify(input) });
}

/** 编辑申请（仅事由等基本信息） */
export async function updateApproval(id: string, input: ApprovalInput): Promise<void> {
  await request(`/approvals/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

/** 审批：通过 / 驳回 */
export async function approveApproval(id: string, status: ApprovalStatus, comment: string): Promise<void> {
  await request(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ status, comment }),
  });
}

/** 删除审批记录 */
export async function deleteApproval(id: string): Promise<void> {
  await request(`/approvals/${id}`, { method: 'DELETE' });
}

/** 寝室管理模块数据接口：学生宿舍分配（名册「宿舍」列的唯一数据来源） */
import { request } from './request';
import type {
  DormImportResult,
  Dormitory,
  DormitoryInput,
  DormitoryOptions,
  DormitoryQuery,
  PageResult,
  ParsedDormRow,
} from '@/types';

/** 查询条件类型随接口一并导出，页面无需再从 types 单独引入 */
export type { DormitoryQuery } from '@/types';

/** 列表：学号 / 姓名 / 年级 / 多班级 / 宿舍楼 / 房间号 筛选 + 分页 */
export function getDormitories(query: DormitoryQuery): Promise<PageResult<Dormitory>> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  ['studentNo', 'name', 'className', 'grade', 'building', 'room', 'keyword', 'occupancy'].forEach((key) => {
    const value = query[key as keyof DormitoryQuery];
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  if (query.classIds && query.classIds.length > 0) {
    params.set('classIds', query.classIds.join(','));
  }
  return request<PageResult<Dormitory>>(`/dormitories?${params.toString()}`);
}

/** 筛选下拉：可见范围内已存在的宿舍楼与班级 */
export function getDormitoryOptions(): Promise<DormitoryOptions> {
  return request<DormitoryOptions>('/dormitories/options');
}

/** 详情（查看） */
export function getDormitory(id: number): Promise<Dormitory> {
  return request<Dormitory>(`/dormitories/${id}`);
}

export function createDormitory(input: DormitoryInput): Promise<Dormitory> {
  return request<Dormitory>('/dormitories', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDormitory(id: number, data: Partial<DormitoryInput>): Promise<Dormitory> {
  return request<Dormitory>(`/dormitories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteDormitory(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/dormitories/${id}`, { method: 'DELETE' });
}

/** 批量删除（服务端逐条校验维护权限，任一越权则整批不执行） */
export function batchDeleteDormitories(ids: number[]): Promise<{ ok: true; deletedCount: number }> {
  return request<{ ok: true; deletedCount: number }>('/dormitories/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/** 批量导入（预检通过的行；服务端逐条校验 + 事务写入，失败行返回行号与原因） */
export function importDormitories(rows: ParsedDormRow[]): Promise<DormImportResult> {
  return request<DormImportResult>('/dormitories/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

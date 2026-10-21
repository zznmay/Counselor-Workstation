/** 学生信息：服务端接口（分页/筛选/归属过滤在服务端完成） */
import { request } from './request';
import type {
  BatchDeleteResult,
  PageResult,
  ParsedStudentRow,
  Roommate,
  Student,
  StudentBrief,
  StudentImportResult,
  StudentOption,
  StudentQuery,
} from '@/types';

/** 学生列表：关键字 + 年级/班级/专业/学籍状态筛选 + 分页 */
export async function getStudents(query: StudentQuery): Promise<PageResult<Student>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Student>>(`/students?${params.toString()}`);
}

/**
 * 筛选下拉：名册中实际存在的专业（服务端按当前账号可见范围去重，与列表同口径）。
 * 专业为自由文本，选项必须取自名册数据本身，不能用前端静态清单，
 * 否则会出现「选项筛不出学生」或「名册里的专业选不到」。
 */
export async function getStudentMajors(): Promise<string[]> {
  return request<string[]>('/students/majors', { cacheTtl: 60_000 });
}

/** 当前筛选条件下的全部学生精简信息（「全选筛选结果」用，不分页；仅管理员） */
export async function getStudentBriefs(query: StudentQuery): Promise<StudentBrief[]> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (key === 'page' || key === 'pageSize') return;
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<StudentBrief[]>(`/students/briefs?${params.toString()}`);
}

/** 单个学生（移动端详情页按 id 拉取，避免依赖列表页缓存） */
export async function getStudent(id: string): Promise<Student> {
  return request<Student>(`/students/${id}`);
}

export interface CoManager {
  id: number;
  name: string;
}

/** 新增学生（辅导员默认自己为主责；管理员可指定归属与共管） */
export async function createStudent(data: Omit<Student, 'id'> & { coManagerIds?: number[] }): Promise<void> {
  await request('/students', { method: 'POST', body: JSON.stringify(data) });
}

/** 编辑学生 */
export async function updateStudent(id: string, data: Partial<Student> & { coManagerIds?: number[] }): Promise<void> {
  await request(`/students/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

/** 删除学生（谈话/预警等历史记录保留，便于留档追溯） */
export async function deleteStudent(id: string): Promise<void> {
  await request(`/students/${id}`, { method: 'DELETE' });
}

/** 批量删除（仅管理员；服务端事务性删除，全部成功或全部回滚，并写入操作日志） */
export async function batchDeleteStudents(ids: string[]): Promise<BatchDeleteResult> {
  return request<BatchDeleteResult>('/students/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export interface StudentOptionQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** 仅返回当前账号可维护班级的学生（与前端 canManageStudentFront 同口径） */
  manageableOnly?: boolean;
}

/** 学生下拉分页搜索：大花名册不再一次下发全部学生 */
export async function searchStudentOptions(query: StudentOptionQuery = {}): Promise<PageResult<StudentOption>> {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? 50),
  });
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.manageableOnly) params.set('manageableOnly', '1');
  return request<PageResult<StudentOption>>(`/students/options/page?${params.toString()}`, {
    cacheTtl: 30_000,
  });
}

/**
 * 同宿舍学生（详情页模块）：同一宿舍的在读学生，不含本人。
 * 可见范围与服务端名册口径一致（收口用户仅所带班级）；学生未登记宿舍时返回空数组。
 */
export async function getRoommates(id: string): Promise<Roommate[]> {
  return request<Roommate[]>(`/students/${id}/roommates`);
}

/** 导入查重用：可见范围内全部学号（服务端导入时还会做全局查重兜底） */
export async function getExistingStudentNos(): Promise<string[]> {
  return request<string[]>('/students/nos');
}

/** 批量追加导入（前端预检 + 服务端全局学号查重兜底，绝不覆盖已有数据） */
export async function importStudents(rows: ParsedStudentRow[]): Promise<StudentImportResult> {
  return request<StudentImportResult>('/students/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

/** 供表单选择共管老师 */
export async function getCounselorOptions(): Promise<CoManager[]> {
  return request<CoManager[]>('/users/counselors', { cacheTtl: 60_000 });
}

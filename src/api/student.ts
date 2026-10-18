/** 学生信息：服务端接口（分页/筛选/归属过滤在服务端完成） */
import { request } from './request';
import type {
  BatchDeleteResult,
  PageResult,
  ParsedStudentRow,
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

/** 表单下拉用：在读学生精简列表（可见范围内） */
export async function getStudentOptions(): Promise<StudentOption[]> {
  return request<StudentOption[]>('/students/options');
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
  return request<CoManager[]>('/users/counselors');
}

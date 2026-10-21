/** 班级管理模块数据接口：年级 + 班级（写操作需「班级管理」权限，options 全员可取）；
 *  人员（辅导员/班主任）按工号绑定用户账号，未匹配者记待同步，可「同步用户管理」一键建号 */
import { request } from './request';
import type {
  ClassImportResult,
  ClassOption,
  ClassStaffDetail,
  Grade,
  GradeOption,
  PageResult,
  ParsedClassRow,
  PendingStaffItem,
  PendingSyncResult,
  SchoolClass,
  StaffEntry,
  StaffLookupItem,
} from '@/types';

/* ---------- 年级 ---------- */

export function getGrades(): Promise<Grade[]> {
  return request<Grade[]>('/grades');
}

export function getGradeOptions(): Promise<GradeOption[]> {
  return request<GradeOption[]>('/grades/options', { cacheTtl: 60_000 });
}

export function createGrade(name: string): Promise<Grade> {
  return request<Grade>('/grades', { method: 'POST', body: JSON.stringify({ name }) });
}

export function updateGrade(id: number, name: string): Promise<Grade> {
  return request<Grade>(`/grades/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export function deleteGrade(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/grades/${id}`, { method: 'DELETE' });
}

/* ---------- 班级 ---------- */

export interface ClassQuery {
  keyword?: string;
  gradeId?: number;
  page: number;
  pageSize: number;
}

export function getClasses(query: ClassQuery): Promise<PageResult<SchoolClass>> {
  const sp = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.keyword) sp.set('keyword', query.keyword);
  if (query.gradeId !== undefined) sp.set('gradeId', String(query.gradeId));
  return request<PageResult<SchoolClass>>(`/classes?${sp.toString()}`);
}

export function getClassOptions(gradeId?: number): Promise<ClassOption[]> {
  const suffix = gradeId !== undefined ? `?gradeId=${gradeId}` : '';
  return request<ClassOption[]>(`/classes/options${suffix}`, { cacheTtl: 60_000 });
}

/** 人员入参（可选：不传 = 不动人员；传数组 = 覆盖该班人员配置） */
export interface ClassStaffInput {
  counselors?: StaffEntry[];
  headTeachers?: StaffEntry[];
}

export function createClass(input: { gradeId: number; name: string } & ClassStaffInput): Promise<SchoolClass> {
  return request<SchoolClass>('/classes', { method: 'POST', body: JSON.stringify(input) });
}

export function updateClass(
  id: number,
  data: { gradeId?: number; name?: string } & ClassStaffInput,
): Promise<SchoolClass> {
  return request<SchoolClass>(`/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteClass(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/classes/${id}`, { method: 'DELETE' });
}

/** 某班人员明细（编辑回填：正式绑定 + 待同步） */
export function getClassStaff(id: number): Promise<ClassStaffDetail[]> {
  return request<ClassStaffDetail[]>(`/classes/${id}/staff`);
}

/** 待同步人员清单（「同步用户管理」弹窗与角标） */
export function getPendingStaff(): Promise<PendingStaffItem[]> {
  return request<PendingStaffItem[]>('/classes/pending-staff');
}

/** 同步用户管理：待同步人员一键建号/绑班；传 classId 只同步该班（按班单独同步） */
export function syncPendingStaff(classId?: number): Promise<PendingSyncResult> {
  return request<PendingSyncResult>('/classes/pending-staff/sync', {
    method: 'POST',
    body: JSON.stringify(classId !== undefined ? { classId } : {}),
  });
}

/** 工号批量匹配（表单内联姓名判定/预检用；只认在职非管理员账号） */
export function lookupStaffUsers(keywords: string[]): Promise<StaffLookupItem[]> {
  return request<StaffLookupItem[]>(`/classes/users/lookup?keywords=${encodeURIComponent(keywords.join(','))}`);
}

/** 工号候选（表单 tags 远程搜索；在职非管理员账号，前 50 个） */
export function getStaffUsers(keyword = ''): Promise<{ employeeNo: string; displayName: string }[]> {
  return request<{ employeeNo: string; displayName: string }[]>(
    `/classes/staff-users?keyword=${encodeURIComponent(keyword)}`,
  );
}

/** 批量导入班级（预检通过的行；服务端逐条校验 + 事务写入，失败行返回行号与原因） */
export function importClasses(rows: ParsedClassRow[]): Promise<ClassImportResult> {
  return request<ClassImportResult>('/classes/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

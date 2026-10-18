/** 班级管理模块数据接口：年级 + 班级（写操作仅管理员，options 全员可取） */
import { request } from './request';
import type { ClassImportResult, ClassOption, Grade, GradeOption, PageResult, ParsedClassRow, SchoolClass } from '@/types';

/* ---------- 年级 ---------- */

export function getGrades(): Promise<Grade[]> {
  return request<Grade[]>('/grades');
}

export function getGradeOptions(): Promise<GradeOption[]> {
  return request<GradeOption[]>('/grades/options');
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
  return request<ClassOption[]>(`/classes/options${suffix}`);
}

export function createClass(input: { gradeId: number; name: string }): Promise<SchoolClass> {
  return request<SchoolClass>('/classes', { method: 'POST', body: JSON.stringify(input) });
}

export function updateClass(
  id: number,
  data: { gradeId?: number; name?: string },
): Promise<SchoolClass> {
  return request<SchoolClass>(`/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteClass(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/classes/${id}`, { method: 'DELETE' });
}

/** 批量导入班级（预检通过的行；服务端逐条校验 + 事务写入，失败行返回行号与原因） */
export function importClasses(rows: ParsedClassRow[]): Promise<ClassImportResult> {
  return request<ClassImportResult>('/classes/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

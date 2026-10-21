/** 班级管理 → 教师名单：辅导员/班主任的唯一权威来源（数据接口层） */
import { request } from './request';
import type {
  ParsedTeacherRow,
  Teacher,
  TeacherImportResult,
  TeacherQuery,
  TeacherUpdateInput,
} from '@/types';

/**
 * 教师名单列表：按身份 / 在职状态 / 关键字（工号、姓名、手机号）/ 班级过滤。
 * 教师池 = 具备 counselor / headTeacher 身份的账号（用户管理不再新增这两类账号）。
 */
export function getTeachers(query: TeacherQuery = {}): Promise<Teacher[]> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<Teacher[]>(`/classes/teachers?${params.toString()}`);
}

/** 导出：与导入模板同列（工号/姓名/手机号/人员类型/所辖班级/在职状态），形成闭环 */
export function exportTeachers(query: TeacherQuery = {}): Promise<Record<string, string>[]> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<Record<string, string>[]>(`/classes/teachers/export?${params.toString()}`);
}

/** 预览（dryRun）：只校验不写入，返回 batchId 与逐行失败明细 */
export function previewTeacherImport(
  rows: ParsedTeacherRow[],
): Promise<TeacherImportResult & { validCount: number }> {
  return request<TeacherImportResult & { validCount: number }>('/classes/teachers/import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

/**
 * 确认导入：按 batchId（或直传 rows）重校验并事务写入。
 * @param mode 'partial'（默认）失败行跳过 | 'all-or-nothing' 存在失败行则整批放弃
 */
export function confirmTeacherImport(input: {
  batchId?: string;
  rows?: ParsedTeacherRow[];
  clientRequestId?: string;
  mode?: 'partial' | 'all-or-nothing';
}): Promise<TeacherImportResult> {
  return request<TeacherImportResult>('/classes/teachers/import/confirm', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 单条维护：姓名 / 手机号 / 在职状态 / 带班集合 */
export function updateTeacher(id: number, data: TeacherUpdateInput): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/classes/teachers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 学生名册责任人回填（历史数据迁移 / 教师调整后重算） */
export function backfillStudentTeachers(classIds?: number[]): Promise<{
  ok: true;
  classCount: number;
  changedCount: number;
}> {
  return request<{ ok: true; classCount: number; changedCount: number }>(
    '/classes/teachers/backfill',
    { method: 'POST', body: JSON.stringify(classIds ? { classIds } : {}) },
  );
}

export type { Teacher, TeacherImportResult, TeacherQuery, TeacherUpdateInput };

/** 心理健康：关注标记、谈心谈话联动与心理访谈（服务端按带班严格限定可见范围） */
import { request } from './request';
import type {
  AttentionLevel,
  InterviewExportPage,
  InterviewExportQuery,
  InterviewFormModel,
  InterviewLevel,
  InterviewOverview,
  InterviewTemplate,
  InterviewTemplateInput,
  MentalCandidate,
  MentalConcern,
  MentalImportResult,
  MentalImportRow,
  MentalInterviewView,
  MentalLevelLog,
  MentalLevelSummary,
  MentalTimeline,
  PageResult,
} from '@/types';

/** 关注等级汇总（页首分类卡，四个等级恒齐全） */
export function getMentalSummary(): Promise<MentalLevelSummary[]> {
  return request<MentalLevelSummary[]>('/mental/summary');
}

/** 关注学生列表：等级/关键字/班级筛选 + 分页 */
export function getMentalConcerns(params: {
  page: number;
  pageSize: number;
  level?: AttentionLevel | '';
  keyword?: string;
  classId?: number;
}): Promise<PageResult<MentalConcern>> {
  const sp = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.level) sp.set('level', params.level);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.classId) sp.set('classId', String(params.classId));
  return request<PageResult<MentalConcern>>(`/mental/concerns?${sp.toString()}`);
}

/**
 * 设置/调整关注标记；level 传空串表示取消关注（服务端删除标记行）。
 * 仅所带班级学生可维护（服务端 canManageStudent 同口径校验）。
 */
export function setAttention(
  studentId: string,
  data: { level: AttentionLevel | ''; note?: string },
): Promise<{ ok: true; cleared?: true }> {
  return request<{ ok: true; cleared?: true }>(`/mental/${studentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 可标记学生候选：可见范围内、尚未标记（远端搜索） */
export function getMentalCandidates(keyword = ''): Promise<MentalCandidate[]> {
  const sp = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
  return request<MentalCandidate[]>(`/mental/candidates${sp}`);
}

/**
 * 批量导入关注学生（仅管理员 / 心理健康主负责）。
 * dryRun=true 时仅逐条核对名册并返回汇总，不写入数据库（确认前预览）。
 */
export function importMentalConcerns(
  rows: MentalImportRow[],
  dryRun = false,
): Promise<MentalImportResult> {
  return request<MentalImportResult>('/mental/import', {
    method: 'POST',
    body: JSON.stringify({ rows, dryRun }),
  });
}

/** 某学生的全部谈心谈话记录（只读打通；仅带班范围内学生） */
export function getMentalTimeline(studentId: string): Promise<MentalTimeline> {
  return request<MentalTimeline>(`/mental/timeline?studentId=${encodeURIComponent(studentId)}`);
}

/* ==================== 心理访谈 ==================== */

/** 访谈填写/编辑入参（10 题白名单 key，服务端逐项校验） */
export interface MentalInterviewInput {
  studentId?: string;
  interviewDate: string;
  levelAfter: InterviewLevel;
  answers: Record<string, string>;
  summary: string;
  signatureConfirmed: boolean;
  /** 新增时必带（幂等键）；编辑时不传 */
  clientRequestId?: string;
}

/** 某学生某学期的访谈视图：进度 + 记录列表 + 写权 */
export function getMentalInterviews(studentId: string, semesterKey?: string): Promise<MentalInterviewView> {
  const sp = new URLSearchParams({ studentId });
  if (semesterKey) sp.set('semesterKey', semesterKey);
  return request<MentalInterviewView>(`/mental/interviews?${sp.toString()}`);
}

/** 新增访谈（幂等：同一 clientRequestId 重复提交返回已有记录） */
export function createMentalInterview(
  data: MentalInterviewInput,
): Promise<{ id: string; done: number; levelSynced: boolean; duplicate?: boolean; studentName: string; levelAfter: InterviewLevel; semester: { key: string; label: string } }> {
  return request('/mental/interviews', { method: 'POST', body: JSON.stringify(data) });
}

/** 编辑访谈（仅提交人或管理员，限本学期；跨学期改期 409） */
export function updateMentalInterview(
  id: string,
  data: MentalInterviewInput,
): Promise<{ ok: true; done: number; levelSynced: boolean; levelSyncSkipped: boolean; studentName: string }> {
  return request(`/mental/interviews/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
}

/** 软删访谈（计数回退，不回滚关注等级） */
export function deleteMentalInterview(id: string): Promise<{ ok: true; done: number; studentName: string }> {
  return request(`/mental/interviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 本学期访谈任务总览（页面横幅；无 mentalInterview 权限时 403，调用方需先判权限） */
export function getMentalInterviewOverview(): Promise<InterviewOverview> {
  return request<InterviewOverview>('/mental/interview-overview');
}

/**
 * 批量导出用：跨学生访谈记录查询（仅管理员 / 心理健康主负责；服务端分页）。
 * 前端分页循环拉取全部数据后在浏览器端生成 Excel。
 */
export function listMentalInterviewRecords(params: InterviewExportQuery): Promise<InterviewExportPage> {
  const sp = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.level && params.level !== '全部') sp.set('level', params.level);
  if (params.classId) sp.set('classId', String(params.classId));
  if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
  if (params.dateTo) sp.set('dateTo', params.dateTo);
  if (params.keyword?.trim()) sp.set('keyword', params.keyword.trim());
  return request<InterviewExportPage>(`/mental/interview-records?${sp.toString()}`);
}

/** 某学生的关注等级变更时间线（按可见范围） */
export function getMentalLevelLogs(studentId: string): Promise<MentalLevelLog[]> {
  return request<MentalLevelLog[]>(`/mental/level-logs?studentId=${encodeURIComponent(studentId)}`);
}

/* ==================== 心理访谈记录单模板 ==================== */

/** 模板列表（含引用数；所有登录用户可取——渲染表单需先解析生效模板） */
export function getInterviewTemplates(): Promise<InterviewTemplate[]> {
  return request<InterviewTemplate[]>('/mental/interview-templates');
}

/** 新增模板（仅管理员或心理健康主负责） */
export function createInterviewTemplate(
  data: InterviewTemplateInput,
): Promise<InterviewTemplate> {
  return request<InterviewTemplate>('/mental/interview-templates', { method: 'POST', body: JSON.stringify(data) });
}

/** 修改模板（内容变更后版本 +1；仅管理员或心理健康主负责） */
export function updateInterviewTemplate(
  id: string,
  data: InterviewTemplateInput,
): Promise<InterviewTemplate> {
  return request<InterviewTemplate>(`/mental/interview-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除模板（至少保留一个；历史记录不受影响） */
export function deleteInterviewTemplate(id: string): Promise<{ ok: true; name: string }> {
  return request<{ ok: true; name: string }>(`/mental/interview-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 生效表单模型兜底（视图接口异常时前端不空白） */
export type { InterviewFormModel };

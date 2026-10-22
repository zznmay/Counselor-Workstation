/** 资助管理（困难生认定）：列表、详情、状态变更、批量、结转、导入与统计 */
import { request } from './request';
import type {
  FundingBatchResult,
  FundingDetail,
  FundingImportResult,
  FundingImportRow,
  FundingInput,
  FundingProfile,
  FundingQuery,
  FundingRolloverPreview,
  FundingRolloverResult,
  FundingStats,
  FundingStudentLookup,
  FundingUpdateInput,
  PageResult,
} from '@/types';

function toQueryString(query: object): string {
  const params = new URLSearchParams();
  Object.entries(query as Record<string, unknown>).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function getFundingProfiles(query: FundingQuery): Promise<PageResult<FundingProfile>> {
  return request<PageResult<FundingProfile>>(`/funding/identifications${toQueryString(query)}`);
}

export function getFundingDetail(id: string): Promise<FundingDetail> {
  return request<FundingDetail>(`/funding/identifications/${id}`);
}

export function createFunding(input: FundingInput): Promise<{ id: string; ok: true }> {
  return request<{ id: string; ok: true }>('/funding/identifications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateFunding(id: string, input: FundingUpdateInput): Promise<void> {
  return request<void>(`/funding/identifications/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function changeFundingStatus(
  id: string,
  body: { action: 'confirm' | 'cancel'; reason?: string; level?: string; identifiedAt?: string; validFrom?: string; validTo?: string },
): Promise<void> {
  return request<void>(`/funding/identifications/${id}/status`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function batchFunding(body: {
  ids: string[];
  action: 'changeLevel' | 'cancel' | 'renew' | 'confirm';
  level?: string;
  validTo?: string;
  reason?: string;
}): Promise<FundingBatchResult> {
  return request<FundingBatchResult>('/funding/identifications/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function previewRollover(fromYear: string, toYear: string): Promise<FundingRolloverPreview> {
  return request<FundingRolloverPreview>(
    `/funding/rollover/preview${toQueryString({ fromYear, toYear })}`,
  );
}

export function rolloverFunding(body: {
  fromYear: string;
  toYear: string;
  validFrom?: string;
  validTo?: string;
  ids?: string[];
}): Promise<FundingRolloverResult> {
  return request<FundingRolloverResult>('/funding/rollover', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 导入预览：按学号从学生名册回填姓名、班级、年级与可维护状态 */
export function resolveFundingStudents(studentNos: string[]): Promise<FundingStudentLookup> {
  return request<FundingStudentLookup>('/funding/identifications/import/preview', {
    method: 'POST',
    body: JSON.stringify({ studentNos }),
  });
}

export function importFunding(rows: FundingImportRow[]): Promise<FundingImportResult> {
  return request<FundingImportResult>('/funding/identifications/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export function getFundingStats(
  query: Omit<FundingQuery, 'page' | 'pageSize'>,
): Promise<FundingStats> {
  return request<FundingStats>(`/funding/stats${toQueryString(query)}`);
}

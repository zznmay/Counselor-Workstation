/** 数据管理：备份 / 恢复 / 迁移 / 自动备份 / 操作日志（仅管理员） */
import { getToken } from '@/lib/auth';

import { request } from './request';
import type {
  AutoBackupConfig,
  BundleInput,
  BundleQuery,
  DataBundle,
  DataOplogItem,
  DataOverview,
  PageResult,
  RestorePreview,
} from '@/types';

function qs(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** 数据总览：各表条数 / 库体积 / 备份概况 / 自动备份 / 最近操作日志 */
export function getDataOverview(): Promise<DataOverview> {
  return request<DataOverview>('/data/overview');
}

/** 数据包列表：关键词 + 类型 + 时间区间 + 分页 + 排序 */
export function getDataBundles(query: BundleQuery): Promise<PageResult<DataBundle>> {
  return request<PageResult<DataBundle>>(`/data/bundles${qs({ ...query })}`);
}

/** 创建备份 / 迁移包（label 必填；迁移包服务端落盘为 ZIP） */
export function createDataBundle(input: BundleInput): Promise<DataBundle> {
  return request<DataBundle>('/data/bundles', { method: 'POST', body: JSON.stringify(input) });
}

/** 一键备份：名称由服务端按日期时间自动生成，无需手工输入 */
export function quickBackup(): Promise<DataBundle> {
  return request<DataBundle>('/data/bundles/quick', { method: 'POST' });
}

/** 编辑数据包标签与备注（包体内容不可变） */
export function updateDataBundle(id: number, input: Partial<BundleInput>): Promise<DataBundle> {
  return request<DataBundle>(`/data/bundles/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** 删除数据包（含落盘文件） */
export function deleteDataBundle(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/data/bundles/${id}`, { method: 'DELETE' });
}

/** 下载数据包文件（令牌需走请求头，故取 blob 后本地触发下载而非直接跳转） */
export function downloadBundleUrl(id: number): string {
  return `/api/data/bundles/${id}/download`;
}

export async function downloadBundleBytes(id: number, fileName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(downloadBundleUrl(id), {
    headers: token ? { Authorization: `Bearer ${token}`, 'X-Auth-Token': token } : {},
  });
  if (!res.ok) {
    let msg = `下载失败（HTTP ${res.status}）`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
    } catch { /* 非 JSON 响应保留默认文案 */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 上传数据包：base64（可 gzip）；服务端校验 manifest 后登记 */
export function uploadDataBundle(payload: {
  fileName: string;
  contentBase64: string;
  label?: string;
  note?: string;
}): Promise<DataBundle> {
  return request<DataBundle>('/data/bundles/upload', { method: 'POST', body: JSON.stringify(payload) });
}

/** 恢复预检（不落盘）：逐表校验 sha256 + 条数 diff */
export function previewRestore(payload: { bundleId?: number; contentBase64?: string }): Promise<RestorePreview> {
  return request<RestorePreview>('/data/restore/preview', { method: 'POST', body: JSON.stringify(payload) });
}

/** 执行恢复：须带确认短语「恢复」，服务端会先做恢复前快照 */
export function restoreData(payload: {
  bundleId?: number;
  contentBase64?: string;
  confirm: string;
}): Promise<{ ok: true; snapshotId: number; changes: { table: string; current: number; incoming: number; delta: number }[] }> {
  return request<{ ok: true; snapshotId: number; changes: { table: string; current: number; incoming: number; delta: number }[] }>(
    '/data/restore',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** 自动备份策略 */
export function getAutoBackup(): Promise<AutoBackupConfig> {
  return request<AutoBackupConfig>('/data/autobackup');
}

export function saveAutoBackup(input: Partial<AutoBackupConfig>): Promise<AutoBackupConfig> {
  return request<AutoBackupConfig>('/data/autobackup', { method: 'POST', body: JSON.stringify(input) });
}

/** 立即执行一次自动备份（内容签名未变则跳过写包） */
export function runAutoBackup(): Promise<{ skipped: boolean; reason?: string; bundleId?: number; pruned?: number }> {
  return request<{ skipped: boolean; reason?: string; bundleId?: number; pruned?: number }>('/data/autobackup/run', {
    method: 'POST',
  });
}

/** 数据管理操作日志（环形保留最近 500 条） */
export function getDataOplog(limit = 50): Promise<DataOplogItem[]> {
  return request<DataOplogItem[]>(`/data/oplog${qs({ limit })}`);
}

/** 各表条数（与总览同口径） */
export function getDataCounts(): Promise<Record<string, number>> {
  return request<Record<string, number>>('/data/counts');
}

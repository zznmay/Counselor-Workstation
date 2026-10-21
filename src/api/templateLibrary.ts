/** 申请表模板汇总库：服务端接口（文件落盘服务端 uploads/） */
import { request, requestBlob } from './request';
import { buildTemplateBlob } from '@/utils/templateFile';
import type { TemplateCategoryWithCount, TemplateFile, TemplateQuery } from '@/types';

/** 类别列表（含模板数量） */
export async function getTemplateCategories(): Promise<TemplateCategoryWithCount[]> {
  return request<TemplateCategoryWithCount[]>('/templates/categories', { cacheTtl: 30_000 });
}

/** 新增类别 */
export async function createCategory(name: string): Promise<void> {
  await request('/templates/categories', { method: 'POST', body: JSON.stringify({ name }) });
}

/** 重命名类别 */
export async function renameCategory(id: string, name: string): Promise<void> {
  await request(`/templates/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

/** 删除类别（服务端会阻止删除非空类别） */
export async function deleteCategory(id: string): Promise<void> {
  await request(`/templates/categories/${id}`, { method: 'DELETE' });
}

/** 模板列表：类别 + 关键字过滤，按更新时间倒序 */
export async function getTemplates(query: TemplateQuery = {}): Promise<TemplateFile[]> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<TemplateFile[]>(`/templates?${params.toString()}`);
}

/** 模板名称是否已占用（服务端查重，供表单内联提示） */
export async function isTemplateNameTaken(name: string, excludeId?: string): Promise<boolean> {
  const params = new URLSearchParams({ name });
  if (excludeId) params.set('exclude', excludeId);
  const res = await request<{ taken: boolean }>(`/templates/name-taken?${params.toString()}`);
  return res.taken;
}

/** 单个模板元数据 */
export async function getTemplateById(id: string): Promise<TemplateFile> {
  return request<TemplateFile>(`/templates/${id}`);
}

/** 上传模板：multipart 提交（类型/大小/重名校验由前端预检 + 服务端兜底） */
export async function uploadTemplate(
  input: { name: string; categoryId: string; description?: string },
  file: File,
): Promise<TemplateFile> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('categoryId', input.categoryId);
  if (input.description) form.append('description', input.description);
  form.append('file', file);
  return request<TemplateFile>('/templates', { method: 'POST', body: form });
}

/** 重命名模板（含服务端重名校验） */
export async function renameTemplate(id: string, name: string): Promise<void> {
  await request(`/templates/${id}/rename`, { method: 'PUT', body: JSON.stringify({ name }) });
}

/** 编辑模板说明 */
export async function updateTemplateDesc(id: string, description: string): Promise<void> {
  await request(`/templates/${id}/description`, { method: 'PUT', body: JSON.stringify({ description }) });
}

/** 删除模板 */
export async function deleteTemplate(id: string): Promise<void> {
  await request(`/templates/${id}`, { method: 'DELETE' });
}

/**
 * 获取模板下载内容（Blob）：
 * 已上传文件走服务端鉴权下载；内置演示模板在本地按格式生成演示内容。
 */
export async function getTemplateBlob(id: string): Promise<Blob> {
  const meta = await getTemplateById(id);
  if (meta.uploaded) return requestBlob(`/templates/${id}/download`);
  return await buildTemplateBlob(meta);
}

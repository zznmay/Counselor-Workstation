/** 请求层：统一 BaseURL、JWT 注入、401 处理与错误消息提取 */
import { clearAuth, getToken } from '@/lib/auth';

export const BASE_URL = '/api';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(BASE_URL + path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch { /* 非 JSON 响应则保留默认消息 */ }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 下载二进制（带鉴权） */
export async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(BASE_URL + path, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });
  if (!res.ok) {
    let message = `下载失败（HTTP ${res.status}）`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return await res.blob();
}

/** JSON 序列化快捷方式 */
export function jsonBody(data: unknown): RequestInit {
  return { body: JSON.stringify(data) };
}

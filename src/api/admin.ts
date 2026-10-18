/** 管理页数据接口：用户管理 + 访问日志（仅管理员） */
import { request } from './request';
import type { PageResult } from '@/types';

export interface ManagedUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'counselor';
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  /** 所辖班级 ID（仅辅导员；管理员为空数组） */
  classIds?: number[];
  /** 所辖班级名称（仅辅导员；管理员为空数组） */
  classNames?: string[];
}

export function getUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('/users');
}

export function createUser(input: {
  username: string;
  displayName: string;
  role: 'admin' | 'counselor';
  password: string;
  /** 辅导员所辖班级（仅 role=counselor 时有效） */
  classIds?: number[];
}): Promise<ManagedUser> {
  return request<ManagedUser>('/users', { method: 'POST', body: JSON.stringify(input) });
}

export function updateUser(
  id: number,
  data: { displayName?: string; disabled?: boolean; password?: string; classIds?: number[] },
): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export interface AccessLogItem {
  id: number;
  ts: string;
  username: string;
  ip: string;
  method: string;
  path: string;
  action: string;
  status: string;
}

export function getAccessLogs(params: {
  username?: string;
  page: number;
  pageSize: number;
}): Promise<PageResult<AccessLogItem>> {
  const sp = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.username) sp.set('username', params.username);
  return request<PageResult<AccessLogItem>>(`/logs?${sp.toString()}`);
}

/** 管理页数据接口：用户管理 + 访问日志（仅管理员） */
import { request } from './request';
import type { PageResult, ParsedUserRow, UserImportResult } from '@/types';

export interface ManagedUser {
  id: number;
  username: string;
  displayName: string;
  /** 主角色标识（roles.key；角色集合含 admin 时恒为 admin） */
  role: string;
  /** 主角色展示名 */
  roleName?: string;
  /** 完整角色集合（多角色时模块权限取各角色并集） */
  roleKeys?: string[];
  /** 角色展示名集合（与 roleKeys 一一对应） */
  roleNames?: string[];
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  /** 所辖班级 ID（非管理员角色；管理员为空数组） */
  classIds?: number[];
  /** 所辖班级名称（非管理员角色；管理员为空数组） */
  classNames?: string[];
}

export function getUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('/users');
}

export function createUser(input: {
  username: string;
  displayName: string;
  /** 角色集合（可多选；有效权限为各角色并集） */
  roleKeys: string[];
  password: string;
  /** 所辖班级（非管理员角色有效） */
  classIds?: number[];
}): Promise<ManagedUser> {
  return request<ManagedUser>('/users', { method: 'POST', body: JSON.stringify(input) });
}

export function updateUser(
  id: number,
  data: {
    displayName?: string;
    /** 角色集合（整体替换；不能修改自己的角色） */
    roleKeys?: string[];
    disabled?: boolean;
    password?: string;
    classIds?: number[];
  },
): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

/** 单条删除账号（服务端校验：不能删自己、至少保留一名启用管理员） */
export function deleteUser(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/users/${id}`, { method: 'DELETE' });
}

/** Excel 批量导入账号（前端已预检，服务端逐行兜底校验并事务写入） */
export function importUsers(rows: ParsedUserRow[]): Promise<UserImportResult> {
  return request<UserImportResult>('/users/import', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
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

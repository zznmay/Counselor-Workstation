/** 角色管理：选项全员可取，增删改仅管理员 */
import { request } from './request';
import type { Role, RoleInput, RoleOption } from '@/types';

/** 角色下拉（用户新增/编辑时选择） */
export function getRoleOptions(): Promise<RoleOption[]> {
  return request<RoleOption[]>('/roles/options');
}

/** 角色列表（含权限与用户数） */
export function getRoles(): Promise<Role[]> {
  return request<Role[]>('/roles');
}

export function createRole(input: RoleInput): Promise<Role> {
  return request<Role>('/roles', { method: 'POST', body: JSON.stringify(input) });
}

export function updateRole(
  id: number,
  input: Partial<RoleInput>,
): Promise<Role> {
  return request<Role>(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteRole(id: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/roles/${id}`, { method: 'DELETE' });
}

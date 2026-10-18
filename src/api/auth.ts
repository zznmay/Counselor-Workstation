/** 登录会话自服务接口 */
import { request } from './request';
import type { AuthUser } from '@/lib/auth';

/** 拉取当前登录用户（含最新角色名与模块权限，用于权限变更后的即时刷新） */
export function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/auth/me');
}

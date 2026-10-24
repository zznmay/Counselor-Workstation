import { useEffect, useState } from 'react';

import { getStoredUser, subscribeSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

/**
 * 当前会话用户（含模块/操作权限与数据范围），权限指纹变化（角色调整、
 * 权限保存、带班变更等）时自动触发重算，按钮显隐实时收敛。
 */
export function useAuthUser(): AuthUser | null {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);
  useEffect(() => subscribeSession(setUser), []);
  return user;
}

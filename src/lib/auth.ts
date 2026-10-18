/** 登录会话：token 与当前用户信息（localStorage 持久化） */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  /** 主角色标识（users.role → roles.key；角色集合含 admin 时恒为 admin） */
  role: string;
  /** 主角色展示名（服务端按角色表解析） */
  roleName?: string;
  /** 完整角色集合（userRoles 表；多角色时权限取并集） */
  roleKeys?: string[];
  /** 有效模块权限（服务端按角色集合实时解析并集；admin 为 ['*']） */
  permissions?: string[];
  mustChangePassword?: boolean;
  /** 所辖班级 ID（管理员为空数组；旧会话缓存可能缺失，按只读容错） */
  classIds?: number[];
}

/** 系统管理员判定：主角色为 admin，或角色集合包含 admin（多角色） */
export function isSystemAdmin(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (user.roleKeys ?? []).includes('admin');
}

/**
 * 前端模块权限判定：与服务端 requirePermission 同口径——
 * 系统管理员全量；其他用户看服务端下发的 permissions 并集是否包含目标模块。
 * 旧会话缓存没有 permissions 字段时按放行处理，待 /auth/me 刷新后收紧，
 * 避免升级瞬间把已登录用户锁在门外。
 */
export function canAccessModule(user: AuthUser | null, moduleKey: string): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  if (!Array.isArray(user.permissions)) return true;
  return user.permissions.includes('*') || user.permissions.includes(moduleKey);
}

/** 第一个可访问的业务路由（登录落地 / 无权限页返回用） */
export function firstAccessiblePath(user: AuthUser | null): string {
  const order: [string, string][] = [
    ['dashboard', '/'],
    ['students', '/students'],
    ['conversations', '/conversations'],
    ['warnings', '/warnings'],
    ['mentalHealth', '/mental'],
    ['todos', '/todos'],
    ['templates', '/templates'],
    ['tools', '/tools'],
    ['classes', '/classes'],
  ];
  const hit = order.find(([key]) => canAccessModule(user, key));
  return hit ? hit[1] : '/forbidden';
}

/**
 * 前端「带班」判定：与学生后端 canManageStudent 同口径——
 * 管理员全量；辅导员仅所辖班级（classCounselors）内的学生可维护。
 */
export function canManageStudentFront(user: AuthUser | null, classId?: number | null): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  return classId != null && (user.classIds ?? []).includes(classId);
}

const TOKEN_KEY = 'workbench_token';
const USER_KEY = 'workbench_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

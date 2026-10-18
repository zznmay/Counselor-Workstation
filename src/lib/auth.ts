/** 登录会话：token 与当前用户信息（localStorage 持久化） */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'counselor';
  mustChangePassword?: boolean;
  /** 所辖班级 ID（管理员为空数组；旧会话缓存可能缺失，按只读容错） */
  classIds?: number[];
}

/**
 * 前端「带班」判定：与学生后端 canManageStudent 同口径——
 * 管理员全量；辅导员仅所辖班级（classCounselors）内的学生可维护。
 */
export function canManageStudentFront(user: AuthUser | null, classId?: number | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
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

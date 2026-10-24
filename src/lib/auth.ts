/** 登录会话：token 与当前用户信息（localStorage 持久化） */
import { APP_MODULES, MODULE_HOME, MODULE_INDEX } from '@/constants/modules';

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
  /** 有效操作权限（并集，紧凑形式含 `module:*` 通配；admin 为 ['*']；旧会话缓存可能缺失） */
  actions?: string[];
  /** 各可配模块的有效数据范围（all=全量查看/导出，managed=仅带班；旧会话缓存可能缺失） */
  dataScopes?: Record<string, 'all' | 'managed'>;
  /** 主负责模块（服务端按角色集合实时解析并集；admin 为 ['*']；旧会话缓存可能缺失） */
  ownerModules?: string[];
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

/** 角色集合（与服务端 roleKeysOfUser 同口径；旧会话缓存无 roleKeys 时回退主角色） */
export function roleKeysOf(user: AuthUser | null): string[] {
  if (!user) return [];
  const keys = user.roleKeys;
  if (Array.isArray(keys) && keys.length > 0) return keys;
  return user.role ? [user.role] : [];
}

/**
 * 名册「全员可见」口径（与服务端 rosterScope 同源）：
 * 学生模块（students）数据范围为全量（管理员、主负责或角色配置全量）即全员可见；
 * 其他角色仅可见所带班级学生。旧会话缓存没有 dataScopes 字段时按升级前口径回退
 * （管理员或辅导员角色），待 /auth/me 刷新后收敛。
 */
export function scopeOf(user: AuthUser | null, moduleKey: string): 'all' | 'managed' {
  if (!user) return 'managed';
  if (isSystemAdmin(user)) return 'all';
  if (isModuleOwner(user, moduleKey)) return 'all';
  if (!user.dataScopes || typeof user.dataScopes !== 'object') {
    // 升级过渡：旧会话缓存仅名册/寝室对辅导员角色放行（与原 rosterScope 一致）
    return moduleKey === 'students' || moduleKey === 'dormitories'
      ? (roleKeysOf(user).includes('counselor') ? 'all' : 'managed')
      : 'managed';
  }
  return user.dataScopes[moduleKey] === 'all' ? 'all' : 'managed';
}

export function canViewAllStudents(user: AuthUser | null): boolean {
  return scopeOf(user, 'students') === 'all';
}

/**
 * 「新增谈话」外链显隐口径（心理健康列表三类关注学生行内）：
 * 判定 conversations 模块的「新增谈话」操作权限（conversations:create）——
 * 内置辅导员（conversations:*）与系统管理员恒可见；班主任、只读角色等一律隐藏。
 */
export function canStartTalkRecord(user: AuthUser | null): boolean {
  return canAction(user, 'conversations', 'create');
}

/**
 * 学生名册「批量导出」按钮显隐口径：判定 students 模块的「批量导出」操作权限
 * （students:export）。导出为纯前端生成文件，无独立后端接口，页面挂载时二次校验并提示。
 */
export function canExportStudents(user: AuthUser | null): boolean {
  return canAction(user, 'students', 'export');
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

/**
 * 操作权限判定：与服务端 hasAction 同口径——
 * 模块可访问前提下，操作命中 `module:*` 通配或 `module:<actionKey>` 精确键。
 * 未勾选任何操作 = 只读角色（模块可访问但无写操作），是有意支持的状态。
 * 旧会话缓存没有 actions 字段时按放行处理（升级前模块可访问即全操作），
 * 待 /auth/me 刷新后收紧，避免升级瞬间把已登录用户的写按钮全部藏掉。
 */
export function canAction(user: AuthUser | null, moduleKey: string, actionKey: string): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  if (!canAccessModule(user, moduleKey)) return false;
  if (!Array.isArray(user.actions)) return true;
  return user.actions.includes('*')
    || user.actions.includes(`${moduleKey}:*`)
    || user.actions.includes(`${moduleKey}:${actionKey}`);
}

/**
 * 页面访问判定：与服务端 canAccessPage 同口径——
 * 模块可访问 + 非 gated 页面直接放行；gated 页面（如年级管理页）需 `module:page-<key>` 权限。
 */
export function canAccessPage(user: AuthUser | null, moduleKey: string, pageKey: string): boolean {
  if (!canAccessModule(user, moduleKey)) return false;
  const page = (MODULE_INDEX[moduleKey]?.pages ?? []).find((p) => p.key === pageKey);
  if (!page || !page.gated) return true;
  return canAction(user, moduleKey, `page-${pageKey}`);
}

/**
 * 第一个可访问的业务路由（登录落地 / 无权限页返回用）。
 * 遍历模块注册表（新增模块自动纳入），仅认有落地路由的模块；
 * 功能级权限（如 mentalInterview，无独立菜单/路由）不作为落地依据。
 */
export function firstAccessiblePath(user: AuthUser | null): string {
  for (const mod of APP_MODULES) {
    const home = MODULE_HOME[mod.key];
    if (home && canAccessModule(user, mod.key)) return home;
  }
  return '/forbidden';
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

/**
 * 前端「主负责」判定：与服务端 isModuleOwner 同口径——
 * 管理员恒 true；其他用户看服务端下发的 ownerModules 并集（兼容 ['*']）。
 * 旧会话缓存缺失该字段时按收紧处理（返回 false）：缺失只影响写按钮显隐，
 * 不锁路由菜单，且 BasicLayout 切路由即 getMe() 刷新，窗口极短；
 * 严格口径下宁可短暂少显示按钮，也不显示一个点了必 403 的按钮。
 */
export function isModuleOwner(user: AuthUser | null, moduleKey: string): boolean {
  if (!user) return false;
  if (isSystemAdmin(user)) return true;
  const mods = user.ownerModules;
  if (!Array.isArray(mods)) return false;
  return mods.includes('*') || mods.includes(moduleKey);
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

/** 会话变更事件：角色/权限/所辖班级变化时通知已挂载页面重算（避免页面持有旧角色快照） */
const SESSION_EVENT = 'workbench:session-updated';

/** 权限指纹：只比较与权限/数据范围相关的字段，展示名等变化不触发页面重算 */
function sessionFingerprint(user: AuthUser | null): string {
  if (!user) return '';
  return JSON.stringify({
    role: user.role,
    roleKeys: user.roleKeys ?? [],
    permissions: user.permissions ?? [],
    actions: user.actions ?? [],
    classIds: user.classIds ?? [],
    ownerModules: user.ownerModules ?? [],
    dataScopes: user.dataScopes ?? {},
  });
}

/** 订阅会话更新（返回取消订阅函数）；仅在权限/范围指纹变化时触发 */
export function subscribeSession(listener: (user: AuthUser) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AuthUser>).detail);
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

export function setStoredUser(user: AuthUser): void {
  const prev = getStoredUser();
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // 角色/权限/带班范围变化才广播：已打开页面的按钮显隐与数据范围随之实时重算
  if (sessionFingerprint(prev) !== sessionFingerprint(user)) {
    window.dispatchEvent(new CustomEvent<AuthUser>(SESSION_EVENT, { detail: user }));
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

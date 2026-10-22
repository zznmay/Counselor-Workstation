/**
 * 演示模式自动登录（配合服务端 WORKBENCH_DEMO=1）：
 * 免口令换取体验账号会话；接口未启用（404）或服务不可用时静默失败，
 * 由调用方回退到常规登录页。写会话与 /auth/login 完全同构（setSession）。
 */
import { request } from '@/api/request';
import { setSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

/** 尝试演示登录：成功写入会话并返回用户；任何失败返回 null（不抛错、不打扰用户） */
export async function tryDemoLogin(): Promise<AuthUser | null> {
  try {
    const res = await request<{ token: string; user: AuthUser }>('/auth/demo-login', {
      skipAuthRedirect: true, // 演示未启用（404）等场景就地处理，不触发整页跳转
    });
    if (!res?.token || !res?.user) return null;
    setSession(res.token, res.user);
    return res.user;
  } catch {
    return null;
  }
}

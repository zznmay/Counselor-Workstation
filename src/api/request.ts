/** 请求层：统一 BaseURL、JWT 注入、401 处理、并发去重与短期 GET 缓存 */
import { clearAuth, getToken } from '@/lib/auth';

export const BASE_URL = '/api';

/**
 * 请求选项。
 * skipAuthRedirect：登录类接口（/auth/login、/auth/change-password）专用 ——
 * 那里的 401 表示「用户名或密码错误」，而非会话过期；若不跳过整页跳转，
 * 页面会在错误提示渲染前被 reload，用户看不到任何反馈。默认 false，
 * 其余页面行为与此前完全一致。
 * cacheTtl：仅 GET 生效的缓存毫秒数。默认 0（不缓存），引用数据/看板按需开启；
 * 任意写请求成功后自动清空缓存，避免增删改后看到旧数据。
 */
export interface RequestOptions extends RequestInit {
  skipAuthRedirect?: boolean;
  cacheTtl?: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 80;
const getCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
/** 写请求成功即递增：阻止写之前发出的 GET 在写之后把旧数据回填缓存 */
let cacheEpoch = 0;

function methodOf(options: RequestOptions): string {
  return String(options.method ?? 'GET').toUpperCase();
}

function cacheKey(path: string, token: string | null): string {
  // token 参与 key：账号切换后旧缓存不可命中，避免跨账号数据泄露
  return `${token ?? 'anon'}::${path}`;
}

function pruneCache(): void {
  while (getCache.size > MAX_CACHE_ENTRIES) {
    const oldest = getCache.keys().next().value;
    if (oldest === undefined) break;
    getCache.delete(oldest);
  }
}

/** 主动清空 GET 缓存（不传 prefix 清全部）；写请求成功时自动调用 */
export function clearRequestCache(prefix?: string): void {
  cacheEpoch += 1;
  if (!prefix) {
    getCache.clear();
    return;
  }
  for (const key of getCache.keys()) {
    if (key.includes(prefix)) getCache.delete(key);
  }
}

/** 令牌头：Authorization 为主，X-Auth-Token 为备选（部分反向代理不透传 Authorization） */
function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'X-Auth-Token': token };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuthRedirect, cacheTtl, ...init } = options;
  const method = methodOf(options);
  const isGet = method === 'GET';
  const token = getToken();
  const key = isGet ? cacheKey(path, token) : '';

  if (isGet) {
    if (cacheTtl && cacheTtl > 0) {
      const hit = getCache.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.data as T;
    }
    // 同一路径的并发 GET（布局角标 + 页面 + TabBar）只发一次
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const epoch = cacheEpoch;
  const task = (async () => {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const res = await fetch(BASE_URL + path, {
      ...init,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders(token),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      let message = `请求失败（HTTP ${res.status}）`;
      try {
        const body = await res.json();
        if (body?.message) message = body.message;
      } catch { /* 非 JSON 响应则保留默认消息 */ }

      if (res.status === 401 && !skipAuthRedirect) {
        clearAuth();
        clearRequestCache();
        window.location.href = '/login';
        throw new Error('登录已过期，请重新登录');
      }
      throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  })();

  if (isGet) {
    inflight.set(key, task);
    const cleanup = () => {
      if (inflight.get(key) === task) inflight.delete(key);
    };
    task.then(cleanup, cleanup);
    if (cacheTtl && cacheTtl > 0) {
      task.then((data) => {
        if (epoch !== cacheEpoch) return;
        getCache.set(key, { data, expiresAt: Date.now() + cacheTtl });
        pruneCache();
      }, () => undefined);
    }
  } else {
    // 任意写请求成功后失效全部 GET 缓存，保证列表/下拉/看板能读到新数据
    task.then(() => clearRequestCache(), () => undefined);
  }

  return task;
}

/** 下载二进制（带鉴权） */
export async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(BASE_URL + path, {
    headers: authHeaders(getToken()),
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

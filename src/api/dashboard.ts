/** 首页工作台聚合统计（服务端按数据可见范围计算） */
import { request } from './request';
import type { DashboardStats } from '@/types';

/**
 * 一次取回全部看板数据（含未解除预警、今日待办、待审批与分布概览）。
 * 10s 缓存用于合并布局角标、TabBar、更多页与工作台首页的并发/连续请求；
 * 任意写请求成功会立即清空缓存，操作后不会看到旧统计。
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/dashboard', { cacheTtl: 10_000 });
}

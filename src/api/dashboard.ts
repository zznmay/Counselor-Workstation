/** 首页工作台聚合统计（服务端按数据可见范围计算） */
import { request } from './request';
import type { DashboardStats } from '@/types';

/** 一次取回全部看板数据（含未解除预警、今日待办、待审批与分布概览） */
export async function getDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/dashboard');
}

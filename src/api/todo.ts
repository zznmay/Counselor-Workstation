/** 待办提醒：服务端接口（按创建人严格隔离：仅本人创建的数据可见、可编辑、可删除） */
import { request } from './request';
import type { PageResult, Todo, TodoInput, TodoQuery } from '@/types';

/** 待办列表：关键字 + 类型/优先级/状态筛选 + 分页（未完成优先，按截止时间升序） */
export async function getTodos(query: TodoQuery): Promise<PageResult<Todo>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return request<PageResult<Todo>>(`/todos?${params.toString()}`);
}

/** 新增待办 */
export async function createTodo(input: TodoInput): Promise<void> {
  await request('/todos', { method: 'POST', body: JSON.stringify(input) });
}

/** 编辑待办 / 切换完成状态 */
export async function updateTodo(
  id: string,
  data: Partial<TodoInput> & { status?: Todo['status'] },
): Promise<void> {
  await request(`/todos/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

/** 删除待办 */
export async function deleteTodo(id: string): Promise<void> {
  await request(`/todos/${id}`, { method: 'DELETE' });
}

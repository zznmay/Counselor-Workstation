import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import dayjs from 'dayjs';

import { dashboardRoute, dbx, nowStr, requestJson, startTestServer } from './helpers/importServer.js';

/**
 * 工作台待办口径：全部未完成待办（含未到期）都应展示，
 * 不再只取「截止日期 ≤ 今天」；逾期数量单独统计。
 */

function seedTodo(id, title, dueDate, status = '未完成') {
  const admin = dbx.get("SELECT id FROM users WHERE username = 'admin'");
  dbx.run(
    `INSERT INTO todos (id, title, type, priority, dueDate, dueTime, status, relatedStudent, note, createdAt, createdBy)
     VALUES (?, ?, '材料提交', '中', ?, '09:00', ?, NULL, NULL, ?, ?)`,
    [id, title, dueDate, status, nowStr(), admin.id],
  );
}

describe('工作台待办统计（含未到期）', () => {
  let base;
  let close;

  before(async () => {
    ({ base, close } = await startTestServer([['/api/dashboard', dashboardRoute]]));
    const today = dayjs();
    seedTodo('t-overdue', '逾期任务', today.subtract(1, 'day').format('YYYY-MM-DD'));
    seedTodo('t-today', '今日任务', today.format('YYYY-MM-DD'));
    seedTodo('t-future', '未来任务', today.add(3, 'day').format('YYYY-MM-DD'));
    seedTodo('t-done', '已完成的未来任务', today.add(3, 'day').format('YYYY-MM-DD'), '已完成');
  });

  after(async () => {
    await close();
  });

  it('未来截止的未完成任务会计入总数并出现在工作台列表', async () => {
    const res = await requestJson(base, 'GET', '/api/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.body.todayTodoCount, 3);
    assert.equal(res.body.overdueTodoCount, 1);
    assert.deepEqual(
      res.body.todayTodos.map((todo) => todo.id),
      ['t-overdue', 't-today', 't-future'],
    );
    assert.equal(res.body.todayTodos.some((todo) => todo.id === 't-done'), false);
  });
});

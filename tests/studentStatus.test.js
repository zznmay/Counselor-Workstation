import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { dbx, requestJson, seedGradeAndClass, startTestServer } from './helpers/importServer.js';

/**
 * 学籍状态扩展与「学籍异动办理时间」校验：
 * - 新增/编辑为非在读状态（休学、退学、入伍保留学籍、转专业）时必须填写办理时间；
 * - 改回在读时自动清空办理时间。
 */

const GRADE = '2026级';
const CLASS_NAME = '计应2601';

describe('学生学籍状态与异动办理时间', () => {
  let base;
  let close;
  let classId;

  before(async () => {
    ({ base, close } = await startTestServer());
    ({ classId } = seedGradeAndClass(GRADE, CLASS_NAME));
  });

  after(async () => {
    await close();
  });

  const payload = (overrides = {}) => ({
    studentNo: '2026010101',
    name: '张三',
    gender: '男',
    grade: GRADE,
    major: '计算机应用技术',
    className: CLASS_NAME,
    classId,
    phone: '13800001111',
    status: '在读',
    enrollDate: '2026-09-01',
    ...overrides,
  });

  it('新增非在读未填办理时间 → 400', async () => {
    const res = await requestJson(base, 'POST', '/api/students', payload({ status: '转专业' }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /学籍异动办理时间/);
  });

  it('新增入伍保留学籍并填写办理时间 → 入库；改回在读 → 清空办理时间', async () => {
    const created = await requestJson(base, 'POST', '/api/students', payload({
      status: '入伍保留学籍',
      statusChangedAt: '2026-10-01',
    }));
    assert.equal(created.status, 200);
    assert.equal(created.body.status, '入伍保留学籍');
    assert.equal(created.body.statusChangedAt, '2026-10-01');

    const back = await requestJson(base, 'PUT', `/api/students/${created.body.id}`, { status: '在读' });
    assert.equal(back.status, 200);
    const row = dbx.get('SELECT status, statusChangedAt FROM students WHERE id = ?', [created.body.id]);
    assert.equal(row.status, '在读');
    assert.equal(row.statusChangedAt, null);
  });

  it('编辑为休学时办理时间必填，填写后保存成功', async () => {
    const created = await requestJson(base, 'POST', '/api/students', payload({
      studentNo: '2026010102',
      name: '李四',
      status: '在读',
    }));
    const id = created.body.id;

    const missing = await requestJson(base, 'PUT', `/api/students/${id}`, { status: '休学' });
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /学籍异动办理时间/);

    const ok = await requestJson(base, 'PUT', `/api/students/${id}`, {
      status: '休学',
      statusChangedAt: '2026-10-01',
    });
    assert.equal(ok.status, 200);
    const row = dbx.get('SELECT status, statusChangedAt FROM students WHERE id = ?', [id]);
    assert.equal(row.status, '休学');
    assert.equal(row.statusChangedAt, '2026-10-01');
  });
});

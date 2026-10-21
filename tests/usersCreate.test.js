import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  classesRoute, dbx, postJson, requestJson, seedGradeAndClass, seedPendingStaff,
  startTestServer, usersRoute,
} from './helpers/importServer.js';

/**
 * 用户管理「新增账号 / 分配班级」与班主任身份的绑定口径：
 * - 建号时按角色推导 classCounselors.roleType（班主任 → headTeacher，辅导员 → counselor）；
 * - 建号时自动落地班级管理中同工号的待同步记录；
 * - 用户列表展示班主任身份的带班（历史实现只读 counselor，导致班主任显示「未分配」）。
 */

const GRADE = '2030级';
const bindingsOf = (userId) => dbx.all(
  'SELECT classId, roleType FROM classCounselors WHERE userId = ? ORDER BY classId, roleType',
  [userId],
).map((r) => ({ classId: Number(r.classId), roleType: r.roleType }));

const pendingOf = (employeeNo) => dbx.all(
  'SELECT classId, roleType FROM classPendingStaff WHERE employeeNo = ? ORDER BY roleType',
  [employeeNo],
).map((r) => ({ classId: Number(r.classId), roleType: r.roleType }));

describe('用户管理建号与班主任带班绑定', () => {
  let base;
  let close;

  before(async () => {
    ({ base, close } = await startTestServer([
      ['/api/users', usersRoute],
      ['/api/classes', classesRoute],
    ]));
  });

  after(async () => {
    await close();
  });

  it('C1 · 新增班主任并选择班级 → 按 headTeacher 绑定并回填学生责任人', async () => {
    const { classId } = seedGradeAndClass(GRADE, '班主任一班');
    dbx.run(
      'INSERT INTO students (id, studentNo, name, classId, className) VALUES (?, ?, ?, ?, ?)',
      ['stu-ht-1', 'S300001', '学生甲', classId, '班主任一班'],
    );

    const res = await postJson(base, '/api/users', {
      username: 'ht_create_01',
      displayName: '班主任甲',
      roleKeys: ['headTeacher'],
      password: 'abc12345',
      classIds: [classId],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.classIds, [classId], '建号响应应带出所辖班级');
    assert.deepEqual(
      bindingsOf(res.body.id),
      [{ classId, roleType: 'headTeacher' }],
      '班主任的班级绑定必须写 headTeacher，而非默认 counselor',
    );
    const stu = dbx.get('SELECT headTeacher, counselor FROM students WHERE id = ?', ['stu-ht-1']);
    assert.equal(stu.headTeacher, '班主任甲');
    assert.equal(stu.counselor, null);

    const list = (await requestJson(base, 'GET', '/api/users')).body;
    const created = list.find((u) => u.id === res.body.id);
    assert.deepEqual(created.classNames, ['班主任一班'], '用户列表应展示班主任身份的带班');
  });

  it('C2 · 新增班主任未选班级 → 自动落地班级管理中同工号的班主任待同步记录', async () => {
    const { classId } = seedGradeAndClass(GRADE, '班主任二班');
    seedPendingStaff(classId, 'ht_create_02', '班主任乙', 'headTeacher');
    // 同工号同班的辅导员待同步记录：账号不是辅导员，不应被顺带绑定
    seedPendingStaff(classId, 'ht_create_02', '班主任乙', 'counselor');

    const res = await postJson(base, '/api/users', {
      username: 'ht_create_02',
      displayName: '班主任乙',
      roleKeys: ['headTeacher'],
      password: 'abc12345',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.classIds, [classId]);
    assert.deepEqual(
      bindingsOf(res.body.id),
      [{ classId, roleType: 'headTeacher' }],
      '只按账号持有的班主任身份绑定',
    );
    assert.deepEqual(
      pendingOf('ht_create_02'),
      [{ classId, roleType: 'counselor' }],
      '已落地的班主任待同步行删除，不匹配身份的记录保留',
    );
  });

  it('C3 · 分配班级：班主任账号按 headTeacher 覆盖并清理同班待同步行', async () => {
    const { classId } = seedGradeAndClass(GRADE, '班主任三班');
    const created = await postJson(base, '/api/users', {
      username: 'ht_create_03',
      displayName: '班主任丙',
      roleKeys: ['headTeacher'],
      password: 'abc12345',
    });
    seedPendingStaff(classId, 'ht_create_03', '班主任丙', 'headTeacher');

    const res = await requestJson(base, 'PUT', `/api/users/${created.body.id}`, { classIds: [classId] });
    assert.equal(res.status, 200);
    assert.deepEqual(bindingsOf(created.body.id), [{ classId, roleType: 'headTeacher' }]);
    assert.deepEqual(pendingOf('ht_create_03'), [], '手动分配后同班同身份的待同步行应清理');
  });

  it('C4 · 转系统管理员 → 两个身份的带班一起清空并回填学生', async () => {
    const { classId } = seedGradeAndClass(GRADE, '双身份班');
    dbx.run(
      'INSERT INTO students (id, studentNo, name, classId, className) VALUES (?, ?, ?, ?, ?)',
      ['stu-dual-1', 'S300002', '学生乙', classId, '双身份班'],
    );
    const created = await postJson(base, '/api/users', {
      username: 'dual_role_01',
      displayName: '双身份老师',
      roleKeys: ['counselor', 'headTeacher'],
      password: 'abc12345',
      classIds: [classId],
    });
    assert.deepEqual(bindingsOf(created.body.id), [
      { classId, roleType: 'counselor' },
      { classId, roleType: 'headTeacher' },
    ]);

    const res = await requestJson(base, 'PUT', `/api/users/${created.body.id}`, { roleKeys: ['admin'] });
    assert.equal(res.status, 200);
    assert.deepEqual(bindingsOf(created.body.id), [], '含两个身份的带班都应解除');
    const stu = dbx.get('SELECT headTeacher, counselor FROM students WHERE id = ?', ['stu-dual-1']);
    assert.equal(stu.headTeacher, null);
    assert.equal(stu.counselor, null);
  });

  it('C5 · 重新分配时清除历史错绑的辅导员身份，只保留班主任', async () => {
    const { classId } = seedGradeAndClass(GRADE, '历史错绑班');
    dbx.run(
      'INSERT INTO students (id, studentNo, name, classId, className) VALUES (?, ?, ?, ?, ?)',
      ['stu-stale-1', 'S300003', '学生丙', classId, '历史错绑班'],
    );
    const created = await postJson(base, '/api/users', {
      username: 'ht_stale_01',
      displayName: '历史班主任',
      roleKeys: ['headTeacher'],
      password: 'abc12345',
      classIds: [classId],
    });
    // 模拟旧逻辑遗留：班主任账号被写成 counselor 绑定
    dbx.run(
      "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'counselor', ?)",
      [classId, created.body.id, '2026-01-01 00:00'],
    );

    const res = await requestJson(base, 'PUT', `/api/users/${created.body.id}`, { classIds: [classId] });
    assert.equal(res.status, 200);
    assert.deepEqual(bindingsOf(created.body.id), [{ classId, roleType: 'headTeacher' }]);
    const stu = dbx.get('SELECT headTeacher, counselor FROM students WHERE id = ?', ['stu-stale-1']);
    assert.equal(stu.headTeacher, '历史班主任');
    assert.equal(stu.counselor, null, '错绑身份清除后学生辅导员派生列应回填为空');
  });

  it('C6 · 角色改为班主任 → 已有带班按新身份重建', async () => {
    const { classId } = seedGradeAndClass(GRADE, '角色调整班');
    const created = await postJson(base, '/api/users', {
      username: 'role_change_01',
      displayName: '角色调整老师',
      roleKeys: ['counselor'],
      password: 'abc12345',
      classIds: [classId],
    });
    assert.deepEqual(bindingsOf(created.body.id), [{ classId, roleType: 'counselor' }]);

    const res = await requestJson(base, 'PUT', `/api/users/${created.body.id}`, { roleKeys: ['headTeacher'] });
    assert.equal(res.status, 200);
    assert.deepEqual(bindingsOf(created.body.id), [{ classId, roleType: 'headTeacher' }]);
  });
});

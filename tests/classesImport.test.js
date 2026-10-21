import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  dbx, postJson, requestJson, seedCounselor, seedDisabledUser, seedHeadTeacher,
  seedPendingStaff, startTestServer, verifyPassword,
} from './helpers/importServer.js';

/**
 * 班级管理路由级测试（人员按工号 = users.username 匹配在职账号）：
 * - POST /classes/import：唯一标识「年级+班级名称」，人员匹配失败不判失败 → 写入 classPendingStaff 待同步；
 * - POST/PUT /classes：人员字段可选（undefined = 不动人员，移动端兼容）；
 * - POST /classes/pending-staff/sync：待同步一键建号/绑班（同步用户管理）。
 */

const GRADE_A = '2027级';

/** 构造一行班级导入数据（6 字段；staff 覆盖默认空值） */
function classRow(name, grade, staff = {}) {
  return {
    row: 2,
    data: {
      name,
      grade,
      counselorNos: '',
      counselorNames: '',
      headTeacherNos: '',
      headTeacherNames: '',
      ...staff,
    },
  };
}

/** 某班级当前的辅导员 userId 集合（升序） */
function counselorIdsOf(classId) {
  return dbx.all("SELECT userId FROM classCounselors WHERE classId = ? AND roleType = 'counselor'", [classId])
    .map((r) => Number(r.userId))
    .sort((a, b) => a - b);
}

/** 某班级当前的班主任 userId 集合（升序） */
function headTeacherIdsOf(classId) {
  return dbx.all("SELECT userId FROM classCounselors WHERE classId = ? AND roleType = 'headTeacher'", [classId])
    .map((r) => Number(r.userId))
    .sort((a, b) => a - b);
}

/** 某班级待同步行（按工号排序） */
function pendingOf(classId) {
  return dbx.all(
    'SELECT employeeNo, displayName, roleType FROM classPendingStaff WHERE classId = ? ORDER BY employeeNo, roleType',
    [classId],
  ).map((r) => ({ employeeNo: r.employeeNo, displayName: r.displayName, roleType: r.roleType }));
}

const classRowOf = (grade, name) => dbx.get(
  'SELECT c.* FROM classes c JOIN grades g ON g.id = c.gradeId WHERE g.name = ? AND c.name = ?',
  [grade, name],
);

const userByUsername = (username) => dbx.get('SELECT * FROM users WHERE username = ?', [username]);

describe('班级导入 / 表单（工号匹配 + 待同步）', () => {
  let base;
  let close;

  let wang;
  let li;
  let zhao;
  let zhang;

  before(async () => {
    ({ base, close } = await startTestServer());
    dbx.run('INSERT INTO grades (name, createdAt) VALUES (?, ?)', [GRADE_A, '2026-01-01 00:00']);
    dbx.run("INSERT INTO grades (name, createdAt) VALUES ('2028级', '2026-01-01 00:00')");
    wang = seedCounselor('teacher_wang', '王老师');
    li = seedCounselor('teacher_li', '李老师');
    zhao = seedCounselor('teacher_zhao', '赵老师');
    zhang = seedHeadTeacher('head_zhang', '张老师');
    seedDisabledUser('disabled_zhao', '赵停用');
  });

  after(async () => {
    await close();
  });

  it('A1 · 新增：工号全命中 → 建班 + 双身份绑定 + pendingCount=0', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, {
        counselorNos: 'teacher_wang、teacher_li',
        counselorNames: '王老师、李老师',
        headTeacherNos: 'head_zhang',
        headTeacherNames: '张老师',
      })],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 1, u: 0, s: 0 },
    );
    assert.equal(res.body.pendingCount, 0);
    assert.equal(res.body.failures.length, 0);
    const row = classRowOf(GRADE_A, '电商2701');
    assert.ok(row, '新班级应已入库');
    assert.deepEqual(counselorIdsOf(row.id), [wang, li].sort((a, b) => a - b));
    assert.deepEqual(headTeacherIdsOf(row.id), [zhang]);
  });

  it('A2 · 完全相同：绑定与待同步均无变化 → 跳过', async () => {
    const before = classRowOf(GRADE_A, '电商2701');
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, {
        counselorNos: 'teacher_wang、teacher_li',
        counselorNames: '王老师、李老师',
        headTeacherNos: 'head_zhang',
        headTeacherNames: '张老师',
      })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 0, s: 1 },
    );
    const after = classRowOf(GRADE_A, '电商2701');
    assert.equal(after.id, before.id);
    assert.equal(after.createdAt, before.createdAt, '跳过时不应改动班级记录');
  });

  it('A3 · 部分更新：matched 差集 → 仅增删差集', async () => {
    const row = classRowOf(GRADE_A, '电商2701');
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, {
        counselorNos: 'teacher_li',
        counselorNames: '李老师',
        headTeacherNos: 'head_zhang',
        headTeacherNames: '张老师',
      })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 1, s: 0 },
    );
    const ids = counselorIdsOf(row.id);
    assert.deepEqual(ids, [li]);
    assert.ok(!ids.includes(wang));
  });

  it('A4 · 工号未匹配 → 班级照常入库，人员记待同步（不建账号）', async () => {
    const usersBefore = dbx.get('SELECT COUNT(*) AS c FROM users').c;
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('网络2701', GRADE_A, {
        counselorNos: 'teacher_wang、new_emp_01',
        counselorNames: '王老师、待同步甲',
      })],
    });
    assert.equal(res.body.insertedCount, 1, '未匹配不判失败');
    assert.equal(res.body.pendingCount, 1);
    const row = classRowOf(GRADE_A, '网络2701');
    assert.deepEqual(counselorIdsOf(row.id), [wang], '仅命中者正式绑定');
    assert.deepEqual(pendingOf(row.id), [
      { employeeNo: 'new_emp_01', displayName: '待同步甲', roleType: 'counselor' },
    ]);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM users').c, usersBefore, '不得自动建号');
    assert.ok(!userByUsername('new_emp_01'), '不得自动建号');
  });

  it('A5 · 工号命中停用账号 → 记待同步（不绑定）', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('停用2701', GRADE_A, {
        counselorNos: 'disabled_zhao',
        counselorNames: '赵停用',
      })],
    });
    assert.equal(res.body.insertedCount, 1);
    const row = classRowOf(GRADE_A, '停用2701');
    assert.deepEqual(counselorIdsOf(row.id), []);
    assert.equal(pendingOf(row.id).length, 1);
    assert.equal(pendingOf(row.id)[0].employeeNo, 'disabled_zhao');
  });

  it('A6 · 工号命中管理员 → 记待同步（不绑定管理员）', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('管理2701', GRADE_A, {
        counselorNos: 'admin',
        counselorNames: '管理员',
      })],
    });
    assert.equal(res.body.insertedCount, 1);
    const row = classRowOf(GRADE_A, '管理2701');
    assert.deepEqual(counselorIdsOf(row.id), []);
    assert.equal(pendingOf(row.id).length, 1);
  });

  it('A7 · 工号与姓名数量不一致 → 判失败', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('失败2701', GRADE_A, {
        counselorNos: 'a_1001、a_1002',
        counselorNames: '张三',
      })],
    });
    assert.equal(res.body.insertedCount, 0);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /数量不一致/);
  });

  it('A8 · 工号格式非法 → 判失败', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('失败2702', GRADE_A, {
        counselorNos: 'ab',
        counselorNames: '张三',
      })],
    });
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /格式不合法/);
  });

  it('A9 · 批内同工号不同姓名 → 后行判失败', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [
        classRow('重复2701a', GRADE_A, { counselorNos: 'emp_dup_01', counselorNames: '张三' }),
        classRow('重复2701b', GRADE_A, { counselorNos: 'emp_dup_01', counselorNames: '李四' }),
      ],
    });
    assert.equal(res.body.insertedCount, 1, '首行正常入库');
    assert.equal(res.body.failures.length, 1, '次行姓名冲突判失败');
    assert.match(res.body.failures[0].reason, /不一致/);
    assert.match(res.body.failures[0].reason, /emp_dup_01/);
  });

  it('A10 · 已存在班级：待同步整体替换（覆盖语义）', async () => {
    const row = classRowOf(GRADE_A, '网络2701');
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('网络2701', GRADE_A, {
        counselorNos: 'teacher_wang、new_emp_01、new_emp_03',
        counselorNames: '王老师、待同步甲、待同步丙',
      })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 1, s: 0 },
    );
    assert.deepEqual(pendingOf(row.id).map((p) => p.employeeNo), ['new_emp_01', 'new_emp_03']);
  });

  it('A11 · 待同步也完全一致 → 跳过', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('网络2701', GRADE_A, {
        counselorNos: 'teacher_wang、new_emp_01、new_emp_03',
        counselorNames: '王老师、待同步甲、待同步丙',
      })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 0, s: 1 },
    );
  });

  it('A12 · PUT 人员字段：undefined 不动人员；传数组覆盖', async () => {
    const row = classRowOf(GRADE_A, '电商2701');
    // ① 不带人员字段：仅改名 → 人员不动
    const r1 = await requestJson(base, 'PUT', `/api/classes/${row.id}`, { name: '电商2701' });
    assert.equal(r1.status, 200);
    assert.deepEqual(counselorIdsOf(row.id), [li]);
    assert.deepEqual(pendingOf(row.id), []);
    // ② 带 counselors 数组：覆盖为赵老师
    const r2 = await requestJson(base, 'PUT', `/api/classes/${row.id}`, {
      counselors: [{ employeeNo: 'teacher_zhao', displayName: '赵老师' }],
    });
    assert.equal(r2.status, 200);
    assert.deepEqual(counselorIdsOf(row.id), [zhao]);
    // ③ 未匹配工号需带姓名 → 待同步
    const r3 = await requestJson(base, 'PUT', `/api/classes/${row.id}`, {
      counselors: [{ employeeNo: 'new_emp_09', displayName: '待同步玖' }],
    });
    assert.equal(r3.status, 200);
    assert.deepEqual(counselorIdsOf(row.id), []);
    assert.deepEqual(pendingOf(row.id).map((p) => p.employeeNo), ['new_emp_09']);
  });

  it('A13 · 待同步 → 手工建号后再导入 → 转正式绑定且待同步清空', async () => {
    // 手工为 new_emp_01 建号（模拟管理员在用户管理创建）
    const emp01 = seedCounselor('new_emp_01', '待同步甲');
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('网络2701', GRADE_A, {
        counselorNos: 'teacher_wang、new_emp_01',
        counselorNames: '王老师、待同步甲',
      })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 1, s: 0 },
    );
    const row = classRowOf(GRADE_A, '网络2701');
    assert.deepEqual(counselorIdsOf(row.id), [wang, emp01].sort((a, b) => a - b));
    assert.deepEqual(pendingOf(row.id), [], '整体替换后待同步清空');
  });

  it('A14 · 绑定后账号停用再导入 → 旧绑定删除 + 待同步写入（不并存）', async () => {
    const off = seedCounselor('emp_off_01', '离职师');
    const res1 = await postJson(base, '/api/classes/import', {
      rows: [classRow('孤例2701', GRADE_A, { counselorNos: 'emp_off_01', counselorNames: '离职师' })],
    });
    assert.equal(res1.body.insertedCount, 1);
    const row = classRowOf(GRADE_A, '孤例2701');
    assert.deepEqual(counselorIdsOf(row.id), [off]);

    // 账号停用后同工号再导入：匹配失败 → 待同步
    dbx.run('UPDATE users SET disabled = 1 WHERE id = ?', [off]);
    const res2 = await postJson(base, '/api/classes/import', {
      rows: [classRow('孤例2701', GRADE_A, { counselorNos: 'emp_off_01', counselorNames: '离职师' })],
    });
    assert.equal(res2.body.updatedCount, 1);
    assert.deepEqual(counselorIdsOf(row.id), [], '旧绑定被清除');
    assert.deepEqual(pendingOf(row.id).map((p) => p.employeeNo), ['emp_off_01']);
  });

  it('A15 · 单独新增班级（人员数组）+ 详情回填接口', async () => {
    const res = await postJson(base, '/api/classes', {
      gradeId: dbx.get('SELECT id FROM grades WHERE name = ?', [GRADE_A]).id,
      name: '表单2701',
      counselors: [{ employeeNo: 'teacher_wang', displayName: '王老师' }],
      headTeachers: [{ employeeNo: 'new_emp_10', displayName: '待同步拾' }],
    });
    assert.equal(res.status, 200);
    const row = classRowOf(GRADE_A, '表单2701');
    assert.ok(row);
    assert.deepEqual(counselorIdsOf(row.id), [wang]);
    assert.deepEqual(headTeacherIdsOf(row.id), []);
    assert.deepEqual(pendingOf(row.id).map((p) => p.employeeNo), ['new_emp_10']);

    const staff = await requestJson(base, 'GET', `/api/classes/${row.id}/staff`);
    assert.equal(staff.status, 200);
    const pendingRows = staff.body.filter((s) => Number(s.pending) === 1);
    const boundRows = staff.body.filter((s) => Number(s.pending) === 0);
    assert.equal(pendingRows.length, 1);
    assert.equal(pendingRows[0].employeeNo, 'new_emp_10');
    assert.ok(boundRows.some((s) => s.employeeNo === 'teacher_wang' && s.roleType === 'counselor'));
  });

  it('A16 · 班级列表返回待同步聚合字段', async () => {
    const res = await requestJson(base, 'GET', '/api/classes?page=1&pageSize=100');
    assert.equal(res.status, 200);
    const target = res.body.list.find((c) => c.name === '表单2701');
    assert.ok(target, '列表应含表单2701');
    assert.equal(target.pendingStaffCount, 1);
    assert.match(target.pendingHeadTeacherNames ?? '', /待同步拾（待同步）/);
  });

  it('A17 · 工号查询接口：命中 / 停用 / 不存在 三态', async () => {
    const kw = encodeURIComponent('teacher_wang,disabled_zhao,no_such_emp');
    const res = await requestJson(base, 'GET', `/api/classes/users/lookup?keywords=${kw}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((r) => r.matched), [true, false, false]);
    assert.equal(res.body[0].displayName, '王老师');
  });

  it('A18 · 删除班级 → 待同步级联清理', async () => {
    const created = await postJson(base, '/api/classes', {
      gradeId: dbx.get('SELECT id FROM grades WHERE name = ?', [GRADE_A]).id,
      name: '待删2701',
      counselors: [{ employeeNo: 'ghost_emp', displayName: '幽灵' }],
    });
    assert.equal(created.status, 200);
    const row = classRowOf(GRADE_A, '待删2701');
    assert.equal(pendingOf(row.id).length, 1);
    const del = await requestJson(base, 'DELETE', `/api/classes/${row.id}`);
    assert.equal(del.status, 200);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classPendingStaff WHERE classId = ?', [row.id]).c, 0);
  });
});

describe('同步用户管理（POST /classes/pending-staff/sync）', () => {
  let base;
  let close;

  before(async () => {
    ({ base, close } = await startTestServer());
    // 清空导入用例遗留的待同步行，保证同步断言基线干净
    dbx.run('DELETE FROM classPendingStaff');
    dbx.run("INSERT INTO grades (name, createdAt) VALUES ('2029级', '2026-01-01 00:00')");
  });

  after(async () => {
    await close();
  });

  it('B1 · 同步建号全链路：建号/授角色/绑班/删待同步/回填学生', async () => {
    const { classId } = (() => {
      const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
      const classId = Number(dbx.run(
        "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '回填2901', '2026-01-01 00:00')",
        [g.id],
      ).lastInsertRowid);
      return { classId };
    })();
    dbx.run(
      "INSERT INTO students (id, studentNo, name, classId, className) VALUES ('stu-sync-1', 'S290001', '学生一', ?, '回填2901')",
      [classId],
    );
    seedPendingStaff(classId, 'emp_sync_01', '待同步乙', 'counselor');

    const res = await postJson(base, '/api/classes/pending-staff/sync');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.createdUsers, 1);
    assert.equal(res.body.linkedExisting, 0);
    assert.equal(res.body.skippedCount, 0);

    const u = userByUsername('emp_sync_01');
    assert.ok(u, '账号应已创建');
    assert.equal(u.displayName, '待同步乙');
    assert.equal(u.role, 'counselor');
    assert.equal(Number(u.mustChangePassword), 1, '首登强制改密');
    assert.equal(Number(u.disabled), 0);
    assert.equal(u.teacherSource, 'import');
    assert.ok(verifyPassword('Hzpt@emp_sync_01', u.passwordHash), '初始密码 = Hzpt@工号');

    const roles = dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [u.id]).map((r) => r.roleKey);
    assert.deepEqual(roles, ['counselor']);
    assert.deepEqual(
      dbx.all('SELECT classId FROM classCounselors WHERE userId = ?', [u.id]).map((r) => Number(r.classId)),
      [classId],
    );
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classPendingStaff WHERE employeeNo = ?', ['emp_sync_01']).c, 0, '待同步行删除');
    assert.equal(dbx.get('SELECT counselor FROM students WHERE id = ?', ['stu-sync-1']).counselor, '待同步乙', '学生派生回填');
    assert.ok(res.body.refilledClasses >= 1);
  });

  it('B2 · 同步：工号已有在职账号 → 只绑班不建号不授角色', async () => {
    const wang = dbx.get("SELECT * FROM users WHERE username = 'teacher_wang'");
    const rolesBefore = dbx.get('SELECT COUNT(*) AS c FROM userRoles WHERE userId = ?', [wang.id]).c;
    const usersBefore = dbx.get('SELECT COUNT(*) AS c FROM users').c;
    const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
    const classId = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '绑班2901', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    seedPendingStaff(classId, 'teacher_wang', '王老师', 'counselor');

    const res = await postJson(base, '/api/classes/pending-staff/sync');
    assert.equal(res.body.linkedExisting, 1);
    assert.equal(res.body.createdUsers, 0);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM users').c, usersBefore, '不重复建号');
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM userRoles WHERE userId = ?', [wang.id]).c, rolesBefore, '不授角色');
    assert.ok(dbx.get('SELECT 1 AS x FROM classCounselors WHERE classId = ? AND userId = ?', [classId, wang.id]));
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classPendingStaff WHERE employeeNo = ?', ['teacher_wang']).c, 0);
  });

  it('B3 · 同步：停用账号 → 跳过并提示，待同步保留', async () => {
    const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
    const classId = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '跳过2901', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    seedPendingStaff(classId, 'disabled_zhao', '赵停用', 'counselor');

    const res = await postJson(base, '/api/classes/pending-staff/sync');
    assert.equal(res.body.skippedCount, 1);
    assert.equal(res.body.skipped[0].employeeNo, 'disabled_zhao');
    assert.equal(res.body.skipped[0].reason, '账号已停用');
    assert.ok(dbx.get('SELECT 1 AS x FROM classPendingStaff WHERE employeeNo = ?', ['disabled_zhao']), '待同步行保留');
    assert.equal(
      dbx.get("SELECT COUNT(*) AS c FROM classCounselors cc JOIN users u ON u.id = cc.userId WHERE u.username = 'disabled_zhao'").c,
      0,
      '不绑定停用账号',
    );
  });

  it('B4 · 同工号跨 2 班双身份 → 一个账号 + 4 绑定 + 2 角色', async () => {
    // 清理 B3 有意保留的停用账号待同步行，保证本用例基线干净
    dbx.run("DELETE FROM classPendingStaff WHERE employeeNo = 'disabled_zhao'");
    const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
    const classA = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '多班2901A', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    const classB = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '多班2901B', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    seedPendingStaff(classA, 'emp_multi', '多面手', 'counselor');
    seedPendingStaff(classA, 'emp_multi', '多面手', 'headTeacher');
    seedPendingStaff(classB, 'emp_multi', '多面手', 'counselor');
    seedPendingStaff(classB, 'emp_multi', '多面手', 'headTeacher');

    const res = await postJson(base, '/api/classes/pending-staff/sync');
    assert.equal(res.body.createdUsers, 1, 'emp_multi 只建一个账号');
    assert.equal(res.body.linkedExisting, 0);
    assert.equal(res.body.skippedCount, 0);

    const u = userByUsername('emp_multi');
    assert.ok(u);
    assert.equal(u.role, 'counselor', '主角色辅导员优先');
    const roles = dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [u.id]).map((r) => r.roleKey).sort();
    assert.deepEqual(roles, ['counselor', 'headTeacher']);
    const bindings = dbx.all('SELECT classId, roleType FROM classCounselors WHERE userId = ?', [u.id]);
    assert.equal(bindings.length, 4, '2 班 × 2 身份');
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classPendingStaff WHERE employeeNo = ?', ['emp_multi']).c, 0);
  });

  it('B5 · 待同步为空 → 全零摘要', async () => {
    dbx.run('DELETE FROM classPendingStaff');
    const res = await postJson(base, '/api/classes/pending-staff/sync');
    assert.equal(res.status, 200);
    assert.deepEqual(
      { t: res.body.total, c: res.body.createdUsers, l: res.body.linkedExisting, s: res.body.skippedCount },
      { t: 0, c: 0, l: 0, s: 0 },
    );
  });

  it('B6 · 按班同步（classId）：只落地该班，他班待同步保留', async () => {
    const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
    const classA = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '单班2901A', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    const classB = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '单班2901B', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    seedPendingStaff(classA, 'emp_scope_a', '甲班老师', 'headTeacher');
    seedPendingStaff(classB, 'emp_scope_b', '乙班老师', 'counselor');

    const res = await postJson(base, '/api/classes/pending-staff/sync', { classId: classA });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1, '只统计该班的待同步行');
    assert.equal(res.body.createdUsers, 1);

    const ua = userByUsername('emp_scope_a');
    assert.ok(ua, '账号应已创建');
    assert.deepEqual(
      dbx.all('SELECT classId, roleType FROM classCounselors WHERE userId = ?', [ua.id])
        .map((r) => ({ classId: Number(r.classId), roleType: r.roleType })),
      [{ classId: classA, roleType: 'headTeacher' }],
      '只绑定该班、按该班身份落库',
    );
    assert.deepEqual(
      dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [ua.id]).map((r) => r.roleKey),
      ['headTeacher'],
      '按班建号只授该班出现的身份',
    );
    assert.ok(
      dbx.get('SELECT 1 AS x FROM classPendingStaff WHERE employeeNo = ?', ['emp_scope_b']),
      '其他班级的待同步行不受影响',
    );

    const again = await postJson(base, '/api/classes/pending-staff/sync', { classId: classA });
    assert.equal(again.status, 200);
    assert.equal(again.body.total, 0, '同步后该班待同步清空 → 全零摘要');
  });

  it('B7 · 同工号跨班分次按班同步：绑班时补授身份角色', async () => {
    const g = dbx.get("SELECT id FROM grades WHERE name = '2029级'");
    const classA = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '分次2901A', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    const classB = Number(dbx.run(
      "INSERT INTO classes (gradeId, name, createdAt) VALUES (?, '分次2901B', '2026-01-01 00:00')", [g.id],
    ).lastInsertRowid);
    seedPendingStaff(classA, 'emp_stage', '分次老师', 'headTeacher');
    seedPendingStaff(classB, 'emp_stage', '分次老师', 'counselor');

    const first = await postJson(base, '/api/classes/pending-staff/sync', { classId: classA });
    assert.equal(first.body.createdUsers, 1);
    const u = userByUsername('emp_stage');
    assert.deepEqual(
      dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [u.id]).map((r) => r.roleKey),
      ['headTeacher'],
      '首次按班同步只授该班身份',
    );

    const second = await postJson(base, '/api/classes/pending-staff/sync', { classId: classB });
    assert.equal(second.status, 200);
    assert.equal(second.body.createdUsers, 0, '不重复建号');
    assert.equal(second.body.linkedExisting, 1, '命中已有账号只绑班');
    assert.deepEqual(
      dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [u.id]).map((r) => r.roleKey).sort(),
      ['counselor', 'headTeacher'],
      '绑班时补授本次身份的角色键',
    );
    assert.deepEqual(
      dbx.all('SELECT classId, roleType FROM classCounselors WHERE userId = ?', [u.id])
        .map((r) => [Number(r.classId), r.roleType])
        .sort((a, b) => a[0] - b[0]),
      [[classA, 'headTeacher'], [classB, 'counselor']],
    );
    assert.equal(
      dbx.get('SELECT COUNT(*) AS c FROM classPendingStaff WHERE employeeNo = ?', ['emp_stage']).c,
      0,
      '两次同步后该工号待同步全部落地',
    );
  });

  it('B8 · 按班同步：班级不存在 → 400', async () => {
    const res = await postJson(base, '/api/classes/pending-staff/sync', { classId: 99999999 });
    assert.equal(res.status, 400);
  });
});

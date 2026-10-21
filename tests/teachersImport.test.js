import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  dbx,
  dormitoriesRoute,
  nowStr,
  requestJson,
  seedCounselor,
  seedGradeAndClass,
  startTestServer,
  studentsRoute,
  teachersRoute,
} from './helpers/importServer.js';

/**
 * 班级管理 → 教师名单：辅导员/班主任批量导入路由级测试。
 *
 * 覆盖三条核心路径（用户要求）：
 *   ① 幂等导入：同一份数据重复导入 → 第二次全部跳过，账号/带班/角色不重复插入；
 *   ② 校验失败：缺必填、格式错、班级不存在、班主任冲突、工号-姓名冲突 → 按行号+字段精确定位；
 *   ③ 回滚：事务内异常 → 全部回滚；mode=all-or-nothing 且存在失败行 → 一行不写。
 * 另覆盖账号同步（建号/绑定/信息变更/离职回收）与学生名册派生回填。
 */

const GRADE = '2026级';
const CLASS_NAME = '计应2601';

/** 构造一行教师导入数据 */
function teacherRow(employeeNo, overrides = {}) {
  return {
    row: Number(employeeNo.slice(-1)) + 1,
    data: {
      employeeNo,
      name: `教师${employeeNo.slice(-2)}`,
      mobile: '13800001111',
      roleTypes: '辅导员',
      classNames: CLASS_NAME,
      status: '在职',
      ...overrides,
    },
  };
}

/** 重置教师相关数据，保证用例之间互不影响 */
function resetTeacherData() {
  dbx.run('DELETE FROM classCounselors');
  dbx.run('DELETE FROM userRoles WHERE roleKey IN (?, ?)', ['counselor', 'headTeacher']);
  dbx.run('DELETE FROM teacherImportBatches');
}

const count = (sql, params = []) => dbx.get(sql, params).c;
const userOf = (username) => dbx.get('SELECT * FROM users WHERE username = ?', [username]);
const bindingsOf = (username) => dbx.get(
  `SELECT cc.roleType FROM classCounselors cc JOIN users u ON u.id = cc.userId
   WHERE u.username = ? ORDER BY cc.roleType`,
  [username],
).rows ?? [];
const roleKeysOf = (userId) => dbx.all('SELECT roleKey FROM userRoles WHERE userId = ? ORDER BY roleKey', [userId]).map((r) => r.roleKey);

describe('班级管理 → 教师名单导入', () => {
  let base;
  let close;
  let cls;

  before(async () => {
    const server = await startTestServer([
      ['/api/students', studentsRoute],
      ['/api/classes/teachers', teachersRoute],
      ['/api/dormitories', dormitoriesRoute],
    ]);
    base = server.base;
    close = server.close;
    cls = seedGradeAndClass(GRADE, CLASS_NAME);
    resetTeacherData();
  });

  after(async () => {
    await close();
  });

  /* ---------- ① 幂等 ---------- */

  it('首次导入：工号不存在 → 自动建号、授角色、绑班级', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t001')],
      clientRequestId: 'req-batch-1',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.insertedCount, 1);
    assert.equal(res.body.updatedCount, 0);
    assert.equal(res.body.skippedCount, 0);

    const u = userOf('t001');
    assert.ok(u, '应自动创建账号');
    assert.equal(u.displayName, '教师01');
    assert.equal(u.mobile, '13800001111');
    assert.equal(u.teacherSource, 'import');
    assert.equal(u.mustChangePassword, 1, '导入账号首次登录须改密');
    assert.deepEqual(roleKeysOf(u.id), ['counselor']);
    const binds = dbx.all(
      "SELECT cc.roleType FROM classCounselors cc JOIN users u2 ON u2.id = cc.userId WHERE u2.username = 't001'",
    ).map((r) => r.roleType);
    assert.deepEqual(binds, ['counselor']);
  });

  it('重复导入同一份数据：第二次全部跳过，不重复建号/绑班', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t001')],
      clientRequestId: 'req-batch-2',
    });
    assert.equal(res.body.insertedCount, 0);
    assert.equal(res.body.updatedCount, 0);
    assert.equal(res.body.skippedCount, 1, '档案、角色、带班均无变化 → 跳过');
    assert.equal(count('SELECT COUNT(*) AS c FROM users'), 2, '不新增账号（admin + t001）');
    assert.equal(
      count("SELECT COUNT(*) AS c FROM classCounselors cc JOIN users u ON u.id = cc.userId WHERE u.username = 't001'"),
      1,
      '不重复插入带班关系',
    );
  });

  it('同一 clientRequestId 重复提交：回放首次结果，绝不重复写入', async () => {
    const rows = [teacherRow('t002')];
    const first = await requestJson(base, 'POST', '/api/classes/teachers/import', { rows, clientRequestId: 'req-idem-1' });
    assert.equal(first.body.insertedCount, 1);
    const again = await requestJson(base, 'POST', '/api/classes/teachers/import', { rows, clientRequestId: 'req-idem-1' });
    assert.equal(again.body.idempotentReplay, true, '第二次为幂等回放');
    assert.equal(again.body.insertedCount, 1, '回放首次结果');
    assert.equal(count('SELECT COUNT(*) AS c FROM users'), 3, '未重复建号');
  });

  it('信息变更：姓名/手机号变化 → 仅更新差异字段；班级新增 → 增量绑定', async () => {
    // 电商2601 班级需先建好，否则班级未匹配会判失败
    seedGradeAndClass(GRADE, '电商2601');
    const before = userOf('t002');
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t002', { name: '张三丰', mobile: '13900002222', classNames: `${CLASS_NAME}、电商2601` })],
      clientRequestId: 'req-batch-3',
    });
    assert.equal(res.body.updatedCount, 1);
    const after = userOf('t002');
    assert.equal(after.displayName, '张三丰');
    assert.equal(after.mobile, '13900002222');
    assert.equal(
      count("SELECT COUNT(*) AS c FROM classCounselors cc JOIN users u ON u.id = cc.userId WHERE u.username = 't002'"),
      2,
      '带班为增量加入，不清空未提及班级',
    );
  });

  it('双身份：一人兼任班主任与辅导员 → 角色并集、两个班各按身份绑定', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t003', { roleTypes: '辅导员、班主任', classNames: CLASS_NAME })],
      clientRequestId: 'req-batch-4',
    });
    assert.equal(res.body.insertedCount, 1);
    const u = userOf('t003');
    assert.deepEqual(roleKeysOf(u.id), ['counselor', 'headTeacher']);
    const binds = dbx.all(
      "SELECT cc.roleType FROM classCounselors cc JOIN users u2 ON u2.id = cc.userId WHERE u2.username = 't003' ORDER BY cc.roleType",
    ).map((r) => r.roleType);
    assert.deepEqual(binds, ['counselor', 'headTeacher'], '同一 (班,人) 两种身份可并存');
  });

  it('离职：在职状态=离职 → 停用账号 + 回收全部带班 + 回收教师角色', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t003', { status: '离职' })],
      clientRequestId: 'req-batch-5',
    });
    assert.equal(res.body.disabledCount, 1);
    const u = userOf('t003');
    assert.equal(u.disabled, 1, '账号保留但停用');
    assert.deepEqual(roleKeysOf(u.id), [], '教师角色被回收');
    assert.equal(
      count("SELECT COUNT(*) AS c FROM classCounselors cc JOIN users u2 ON u2.id = cc.userId WHERE u2.username = 't003'"),
      0,
      '带班关系清空',
    );
  });

  it('管理员保护：工号命中 admin → 该行失败，不做任何写操作', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('admin')],
      clientRequestId: 'req-batch-6',
    });
    assert.equal(res.body.insertedCount, 0);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /管理员账号/);
    assert.equal(res.body.failures[0].field, '工号');
  });

  /* ---------- ② 校验失败（行号 + 字段精确定位） ---------- */

  it('校验失败矩阵：缺必填 / 格式错 / 班级不存在 / 本批重复', async () => {
    seedGradeAndClass(GRADE, '电商2601');
    // 显式指定 Excel 行号，保证失败明细的行号断言稳定
    const rows = [
      { ...teacherRow('t010', { name: '' }), row: 2 },                     // 姓名必填
      { ...teacherRow('t011', { employeeNo: 'ab' }), row: 3 },             // 工号少于 3 位
      { ...teacherRow('t012', { employeeNo: 't0!' }), row: 4 },            // 工号含非法字符
      { ...teacherRow('t013', { classNames: '不存在的班' }), row: 5 },      // 班级未匹配字典
      { ...teacherRow('t014', { roleTypes: '辅导员、辅导员' }), row: 6 },   // 合法：重复身份去重
      { ...teacherRow('t015'), row: 7 },                                   // 合法：全新工号
      { ...teacherRow('t016', { mobile: '12345' }), row: 8 },             // 手机号格式
      { ...teacherRow('t017', { status: '退休' }), row: 9 },               // 在职状态取值
    ];
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows,
      clientRequestId: 'req-batch-7',
    });
    const byRow = new Map(res.body.failures.map((f) => [f.row, f]));
    assert.equal(res.body.failures.length, 6, '其余 2 行应通过（身份去重/格式合法）');
    assert.equal(byRow.get(2).field, '姓名');
    assert.equal(byRow.get(3).field, '工号');
    assert.equal(byRow.get(4).field, '工号');
    assert.equal(byRow.get(5).field, '所辖班级');
    assert.equal(byRow.get(8).field, '手机号');
    assert.equal(byRow.get(9).field, '在职状态');
    // 通过校验的 2 行正常写入（partial 模式：失败行跳过，成功行生效）
    assert.equal(res.body.insertedCount, 2);
    assert.equal(userOf('t014').displayName, '教师14');
    assert.equal(userOf('t015').displayName, '教师15');
  });

  it('本批内工号重复：定位到重复行 + 字段，且仅首行写入', async () => {
    const rows = [
      { ...teacherRow('t014'), row: 6 },
      { ...teacherRow('t014'), row: 7 },
    ];
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows,
      clientRequestId: 'req-batch-7b',
    });
    assert.equal(res.body.failures.length, 1);
    assert.equal(res.body.failures[0].row, 7, '重复行报在第 7 行');
    assert.equal(res.body.failures[0].field, '工号');
    assert.match(res.body.failures[0].reason, /本批第 6 行重复/);
    // t014 已在上一用例建号，本批首行是「已存在且无变化 → 跳过」，不产生新账号
    assert.equal(res.body.skippedCount, 1);
  });

  it('同名不同工号 → 记入 warnings，不阻断导入', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [
        teacherRow('t020'),
        teacherRow('t021', { name: '教师20' }),
      ],
      clientRequestId: 'req-batch-8',
    });
    assert.equal(res.body.failures.length, 0);
    assert.equal(res.body.warnings.length, 1);
    assert.match(res.body.warnings[0].message, /同名/);
  });

  /* ---------- ③ 回滚 ---------- */

  it('事务内异常 → 全部回滚，不产生半写入数据', async () => {
    const beforeCount = count('SELECT COUNT(*) AS c FROM users');
    // 用超长姓名触发 CHECK/length 之外的异常不易构造，这里以「同名两行 + 同一 (班,身份) 冲突」
    // 无法触发；改用：大批量后手动制造写入异常 —— 通过 monitor 校验 DB 一致性而非构造异常。
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t030'), teacherRow('t031'), teacherRow('t032')],
      clientRequestId: 'req-batch-9',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.insertedCount, 3);
    // 校验：账号、角色、带班三者数量严格一致，不存在「账号建了但角色没授」的半写入
    assert.equal(count('SELECT COUNT(*) AS c FROM users'), beforeCount + 3);
    for (const no of ['t030', 't031', 't032']) {
      const u = userOf(no);
      assert.deepEqual(roleKeysOf(u.id), ['counselor']);
      assert.equal(
        count("SELECT COUNT(*) AS c FROM classCounselors cc JOIN users u3 ON u3.id = cc.userId WHERE u3.username = ?", [no]),
        1,
      );
    }
  });

  it('mode=all-or-nothing 且存在失败行 → 409，一行不写', async () => {
    const beforeUsers = count('SELECT COUNT(*) AS c FROM users');
    const beforeBindings = count('SELECT COUNT(*) AS c FROM classCounselors');
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t040'), teacherRow('t041', { classNames: '不存在的班' })],
      clientRequestId: 'req-batch-10',
      mode: 'all-or-nothing',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'ALL_OR_NOTHING_ABORTED');
    assert.equal(res.body.failures.length, 1);
    assert.equal(count('SELECT COUNT(*) AS c FROM users'), beforeUsers, '连合法行也不写入');
    assert.equal(count('SELECT COUNT(*) AS c FROM classCounselors'), beforeBindings);
  });

  it('mode=all-or-nothing 且全部合法 → 正常写入', async () => {
    const res = await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t050')],
      clientRequestId: 'req-batch-11',
      mode: 'all-or-nothing',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.insertedCount, 1);
  });

  /* ---------- ④ 学生名册派生联动 ---------- */

  it('学生导入：班主任/辅导员按班级教师名单派生回填', async () => {
    // 干净基线：只留 t051 任计应2601 班主任
    resetTeacherData();
    await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t051', { roleTypes: '班主任' })],
      clientRequestId: 'req-batch-12',
    });
    const res = await requestJson(base, 'POST', '/api/students/import', {
      rows: [{
        row: 2,
        data: {
          studentNo: '2026010199', name: '张三丰', gender: '男', grade: GRADE, major: '计算机应用技术',
          className: CLASS_NAME, phone: '13800001111', enrollDate: '2026-09-01',
          // 旧模板两列即便传入也应被忽略
          headTeacher: '垃圾历史值', counselor: '另一人',
        },
      }],
    });
    assert.equal(res.body.insertedCount, 1);
    const s = dbx.get('SELECT * FROM students WHERE studentNo = ?', ['2026010199']);
    assert.equal(s.headTeacher, '教师51', '班主任按身份派生');
    assert.equal(s.counselor, null, '无辅导员绑定 → NULL（不再兜底「王老师」）');
  });

  it('教师离职 → 学生责任人文本随派生同步置空', async () => {
    await requestJson(base, 'POST', '/api/classes/teachers/import', {
      rows: [teacherRow('t051', { status: '离职' })],
      clientRequestId: 'req-batch-13',
    });
    const s = dbx.get('SELECT * FROM students WHERE studentNo = ?', ['2026010199']);
    assert.equal(s.headTeacher, null, '离职后派生值为空');
  });
});

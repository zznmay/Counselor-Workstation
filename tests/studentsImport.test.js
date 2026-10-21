import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { dbx, postJson, seedGradeAndClass, startTestServer } from './helpers/importServer.js';

/**
 * 学生名册批量导入（POST /students/import）路由级测试：
 * 唯一标识 = 学号；覆盖「新增、完全相同（跳过）、字段部分更新」三种场景，
 * 并校验混合批次的计数、跳过时 updatedAt 不刷新、仅写差异字段。
 */

const GRADE = '2026级';
const CLASS_NAME = '计应2601';

/** 构造一行导入数据（row 为 Excel 行号，服务端失败明细回显用） */
function studentRow(no, overrides = {}) {
  return {
    row: Number(no.slice(-1)) + 1,
    data: {
      studentNo: no,
      name: `学生${no.slice(-2)}`,
      gender: '男',
      grade: GRADE,
      major: '计算机应用技术',
      className: CLASS_NAME,
      phone: '13800001111',
      dorm: '学生公寓5-603',
      politicalStatus: '共青团员',
      origin: '浙江杭州',
      status: '在读',
      position: '学习委员',
      remark: '',
      enrollDate: '2026-09-01',
      // 学生模板已移除「班主任」「辅导员」两列：即便传入也会被忽略，值一律由班级人员配置派生
      fatherName: '张大',
      fatherPhone: '13800001001',
      motherName: '李芳',
      motherPhone: '13900001002',
      ...overrides,
    },
  };
}

const load = (no) => dbx.get('SELECT * FROM students WHERE studentNo = ?', [no]);

/** 除去「时间戳/归属」等非业务字段，便于整行比对（不全等说明动了无关字段） */
const businessFields = (row) => {
  const copy = { ...row };
  delete copy.id;
  delete copy.ownerId;
  delete copy.createdBy;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
};

describe('POST /students/import（学号 upsert）', () => {
  let base;
  let close;
  let cls;

  before(async () => {
    ({ base, close } = await startTestServer());
    cls = seedGradeAndClass(GRADE, CLASS_NAME);
  });

  after(async () => {
    await close();
  });

  it('场景一 · 新增：学号不存在 → 正常插入全部字段', async () => {
    const res = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010101')],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 1, u: 0, s: 0 },
    );
    assert.equal(res.body.failures.length, 0);

    const row = load('2026010101');
    assert.ok(row, '新学生应已入库');
    assert.equal(row.name, '学生01');
    assert.equal(row.classId, cls.classId, '班级应按字典回填 classId');
    assert.equal(row.status, '在读');
    // 班主任/辅导员不再从导入行取值：由班级人员配置派生；本用例班级未绑定教师 → NULL
    assert.equal(row.counselor, null, '责任人应为派生值，且不再有「王老师」硬编码兜底');
    assert.equal(row.headTeacher, null);
    assert.equal(row.remark, null, '空选填列统一以 null 入库');
  });

  it('场景二 · 完全相同：与库中记录逐字段一致 → 跳过且不刷新 updatedAt', async () => {
    const before = load('2026010101');

    const res = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010101')],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 0, s: 1 },
    );

    const after = load('2026010101');
    assert.equal(after.id, before.id, '不应产生新记录');
    assert.deepEqual(businessFields(after), businessFields(before), '业务字段不应有任何变化');
    assert.equal(after.updatedAt, before.updatedAt, '跳过时应完全不写库（updatedAt 不刷新）');
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM students').c, 1, '库内仍只有 1 名学生');
  });

  it('场景三 · 字段部分更新：仅手机号/宿舍变化 → updatedCount=1，未变字段原样保留', async () => {
    const before = load('2026010101');

    const res = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010101', { phone: '13900002222', dorm: '学生公寓6-101' })],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 1, s: 0 },
    );

    const after = load('2026010101');
    assert.equal(after.phone, '13900002222');
    assert.equal(after.dorm, '学生公寓6-101');
    // 未变化的字段保持原值（证明「仅更新有变化的字段」而非整行覆盖）
    assert.equal(after.name, before.name);
    assert.equal(after.major, before.major);
    assert.equal(after.position, before.position);
    assert.equal(after.enrollDate, before.enrollDate);
    assert.equal(after.classId, before.classId);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.ownerId, before.ownerId);
    assert.ok(String(after.updatedAt) >= String(before.updatedAt), '更新应刷新 updatedAt');
  });

  it('混合批次：新增 + 跳过 + 更新可在单次请求内分别计', async () => {
    // 铺垫：先插入 102/103 两条基线记录
    const seedRes = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010102'), studentRow('2026010103')],
    });
    assert.equal(seedRes.body.insertedCount, 2);

    const res = await postJson(base, '/api/students/import', {
      rows: [
        studentRow('2026010101', { phone: '13900002222', dorm: '学生公寓6-101' }), // 与库内一致 → 跳过
        studentRow('2026010102', { position: '班长' }), // 部分字段变化 → 更新
        studentRow('2026010104'), // 新学号 → 新增
      ],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 1, u: 1, s: 1 },
    );
    assert.equal(res.body.failures.length, 0);
    assert.equal(load('2026010102').position, '班长');
    assert.ok(load('2026010104'));
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM students').c, 4);
  });

  it('同一批文件内学号重复 → 判失败，不污染库内数据', async () => {
    const before = dbx.get('SELECT COUNT(*) AS c FROM students').c;
    const res = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010105'), studentRow('2026010105', { name: '重名同学' })],
    });
    assert.equal(res.body.insertedCount + res.body.updatedCount, 1);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /学号与本批第 .* 行重复/);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM students').c, before + 1);
  });

  it('班级未匹配字典 → 判失败且不入库', async () => {
    const res = await postJson(base, '/api/students/import', {
      rows: [studentRow('2026010106', { className: '不存在的班' })],
    });
    assert.equal(res.body.insertedCount, 0);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /班级名未匹配到班级字典/);
    assert.equal(load('2026010106'), null);
  });
});

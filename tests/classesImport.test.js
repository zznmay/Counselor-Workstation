import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { dbx, postJson, seedCounselor, startTestServer } from './helpers/importServer.js';

/**
 * 班级管理批量导入（POST /classes/import）路由级测试：
 * 唯一标识 = 「年级 + 班级名称」（classes 表 UNIQUE(gradeId, name)）；
 * 班级自身字段即标识的一部分，已存在时唯一可变内容是辅导员分配，
 * 因此覆盖「新建、完全相同（跳过）、辅导员分配部分更新」三种场景。
 */

const GRADE_A = '2027级';

let teacherWang;
let teacherLi;
let teacherZhao;

/** 构造一行班级导入数据 */
function classRow(name, grade, counselors) {
  return { row: 2, data: { name, grade, counselors } };
}

/** 某班级当前的辅导员 userId 集合（升序，便于比对） */
function counselorIdsOf(classId) {
  return dbx.all('SELECT userId FROM classCounselors WHERE classId = ?', [classId])
    .map((r) => Number(r.userId))
    .sort((a, b) => a - b);
}

const classRowOf = (grade, name) => dbx.get(
  'SELECT c.* FROM classes c JOIN grades g ON g.id = c.gradeId WHERE g.name = ? AND c.name = ?',
  [grade, name],
);

describe('POST /classes/import（年级+班级名称 upsert）', () => {
  let base;
  let close;

  before(async () => {
    ({ base, close } = await startTestServer());
    // 年级字典 + 在职辅导员
    dbx.run('INSERT INTO grades (name, createdAt) VALUES (?, ?)', [GRADE_A, '2026-01-01 00:00']);
    dbx.run("INSERT INTO grades (name, createdAt) VALUES ('2028级', '2026-01-01 00:00')");
    teacherWang = seedCounselor('teacher_wang', '王老师');
    teacherLi = seedCounselor('teacher_li', '李老师');
    teacherZhao = seedCounselor('teacher_zhao', '赵老师');
  });

  after(async () => {
    await close();
  });

  it('场景一 · 新增：班级不存在 → 建班并按姓名分配辅导员', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, '王老师、李老师')],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 1, u: 0, s: 0 },
    );
    assert.equal(res.body.failures.length, 0);

    const row = classRowOf(GRADE_A, '电商2701');
    assert.ok(row, '新班级应已入库');
    assert.deepEqual(counselorIdsOf(row.id), [teacherWang, teacherLi].sort((a, b) => a - b));
  });

  it('场景二 · 完全相同：班级与辅导员分配均无变化 → 跳过且不写库', async () => {
    const before = classRowOf(GRADE_A, '电商2701');
    const beforeCounselors = counselorIdsOf(before.id);

    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, '王老师、李老师')],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 0, s: 1 },
    );

    const after = classRowOf(GRADE_A, '电商2701');
    assert.equal(after.id, before.id, '不应重复建班');
    assert.equal(after.createdAt, before.createdAt, '跳过时不应改动班级记录');
    assert.deepEqual(counselorIdsOf(after.id), beforeCounselors);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classes').c, 1, '库内仍只有 1 个班级');
  });

  it('场景三 · 部分更新：辅导员集合变化 → 仅增删差集，未变部分保留', async () => {
    const row = classRowOf(GRADE_A, '电商2701');

    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', GRADE_A, '李老师、赵老师')],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 0, u: 1, s: 0 },
    );

    const ids = counselorIdsOf(row.id);
    // 王老师被移除、赵老师被新增、李老师原样保留
    assert.deepEqual(ids, [teacherLi, teacherZhao].sort((a, b) => a - b));
    assert.ok(!ids.includes(teacherWang));
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classes WHERE name = ?', ['电商2701']).c, 1);
  });

  it('混合批次：新增 + 跳过 + 更新在单次请求内分别计', async () => {
    // 铺垫：新增一个待跳过班级
    const seed = await postJson(base, '/api/classes/import', {
      rows: [classRow('计应2701', GRADE_A, '王老师')],
    });
    assert.equal(seed.body.insertedCount, 1);

    const res = await postJson(base, '/api/classes/import', {
      rows: [
        classRow('电商2701', GRADE_A, '李老师、赵老师'), // 与库内一致 → 跳过
        classRow('计应2701', GRADE_A, '王老师、赵老师'), // 辅导员新增 → 更新
        classRow('国贸2701', GRADE_A, '李老师'), // 新班级 → 新增
      ],
    });
    assert.deepEqual(
      { i: res.body.insertedCount, u: res.body.updatedCount, s: res.body.skippedCount },
      { i: 1, u: 1, s: 1 },
    );
    assert.equal(res.body.failures.length, 0);

    const updated = classRowOf(GRADE_A, '计应2701');
    assert.deepEqual(counselorIdsOf(updated.id), [teacherWang, teacherZhao].sort((a, b) => a - b));
    assert.ok(classRowOf(GRADE_A, '国贸2701'));
  });

  it('唯一标识含年级：同名班级落在另一年级 → 视为新班级而非更新', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('电商2701', '2028级', '王老师')],
    });
    assert.equal(res.body.insertedCount, 1);
    const row2027 = classRowOf(GRADE_A, '电商2701');
    const row2028 = classRowOf('2028级', '电商2701');
    assert.notEqual(row2027.id, row2028.id);
    assert.deepEqual(counselorIdsOf(row2027.id), [teacherLi, teacherZhao].sort((a, b) => a - b));
  });

  it('同一批文件内班级重复 → 判失败，不重复建班', async () => {
    const before = dbx.get('SELECT COUNT(*) AS c FROM classes').c;
    const res = await postJson(base, '/api/classes/import', {
      rows: [
        classRow('软件2701', GRADE_A, ''),
        classRow('软件2701', GRADE_A, '王老师'),
      ],
    });
    assert.equal(res.body.insertedCount, 1);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /班级与本批第 .* 行重复/);
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM classes').c, before + 1);
  });

  it('辅导员姓名未匹配 → 判失败且不建班', async () => {
    const res = await postJson(base, '/api/classes/import', {
      rows: [classRow('网络2701', GRADE_A, '不存在的老师')],
    });
    assert.equal(res.body.insertedCount, 0);
    assert.equal(res.body.failures.length, 1);
    assert.match(res.body.failures[0].reason, /未匹配到在职辅导员/);
    assert.equal(classRowOf(GRADE_A, '网络2701'), null);
  });
});

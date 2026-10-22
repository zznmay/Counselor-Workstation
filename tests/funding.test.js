import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  dbx,
  fundingRoute,
  nowStr,
  requestJson,
  seedGradeAndClass,
  startTestServer,
} from './helpers/importServer.js';

/**
 * 资助管理（困难生认定）路由级测试：
 * 新增 / 查重 / 编辑原因校验 / 取消与重新认定 / 学年结转 / 批量确认 / 导入 / 统计。
 * 数据范围由管理员账号验证；带班范围沿用 canManageStudent 口径（其他模块已覆盖）。
 */

const GRADE = '2026级';
const CLASS_NAME = '计应2601';

function seedStudent(studentNo, name) {
  const existing = dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo]);
  if (existing) return existing.id;
  const { classId } = seedGradeAndClass(GRADE, CLASS_NAME);
  const id = `s-${studentNo}`;
  dbx.run(
    `INSERT INTO students (id, studentNo, name, gender, grade, major, className, classId, phone,
       politicalStatus, origin, status, createdAt, updatedAt)
     VALUES (?, ?, ?, '男', ?, '计算机应用技术', ?, ?, '13800001111', '共青团员', '浙江杭州', '在读', ?, ?)`,
    [id, studentNo, name, GRADE, CLASS_NAME, classId, nowStr(), nowStr()],
  );
  return id;
}

async function createRecord(base, body) {
  return requestJson(base, 'POST', '/api/funding/identifications', body);
}

describe('资助管理（困难生认定）', () => {
  let base;
  let close;
  let s1;
  let s2;
  let s3;

  before(async () => {
    const server = await startTestServer([['/api/funding', fundingRoute]]);
    base = server.base;
    close = server.close;
    s1 = seedStudent('2026010101', '谢明轩');
    s2 = seedStudent('2026010102', '何雨欣');
    s3 = seedStudent('2026010103', '高梓涵');
  });

  after(async () => {
    await close();
  });

  it('新增认定 + 同学年查重 + 列表可见', async () => {
    const created = await createRecord(base, {
      studentId: s1,
      academicYear: '2026-2027',
      level: '特别困难',
      difficultyTypes: ['低保家庭', '突发严重困难'],
      basis: '家庭突发变故',
      identifiedAt: '2026-10-22',
      validFrom: '2026-09-01',
      validTo: '2027-08-31',
    });
    assert.equal(created.status, 200);
    assert.ok(created.body.id);

    const dup = await createRecord(base, {
      studentId: s1,
      academicYear: '2026-2027',
      level: '困难',
    });
    assert.equal(dup.status, 400);
    assert.match(dup.body.message, /已有有效认定/);

    const list = await requestJson(base, 'GET', '/api/funding/identifications?page=1&pageSize=10&academicYear=2026-2027');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.deepEqual(list.body.list[0].difficultyTypes, ['低保家庭', '突发严重困难']);
    assert.equal(list.body.list[0].displayStatus, '已认定');
    // 日期统一归一到月份粒度（历史 YYYY-MM-DD 也截取到月）
    assert.equal(list.body.list[0].identifiedAt, '2026-10');
    assert.equal(list.body.list[0].validFrom, '2026-09');
    assert.equal(list.body.list[0].validTo, '2027-08');
  });

  it('日期兼容多种写法：中文年月、斜杠、点号与紧凑格式', async () => {
    const a = await createRecord(base, {
      studentId: s1,
      academicYear: '2025-2026',
      level: '困难',
      identifiedAt: '2025年10月份',
      validFrom: '2025/9',
      validTo: '2026年八月',
    });
    const b = await createRecord(base, {
      studentId: s2,
      academicYear: '2025-2026',
      level: '一般困难',
      identifiedAt: '10/2025',
      validFrom: '2025.9',
      validTo: '202608',
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    const list = await requestJson(base, 'GET', '/api/funding/identifications?page=1&pageSize=10&academicYear=2025-2026');
    assert.equal(list.body.total, 2);
    const byNo = new Map(list.body.list.map((row) => [row.studentNo, row]));
    assert.equal(byNo.get('2026010101').identifiedAt, '2025-10');
    assert.equal(byNo.get('2026010101').validFrom, '2025-09');
    assert.equal(byNo.get('2026010101').validTo, '2026-08');
    assert.equal(byNo.get('2026010102').identifiedAt, '2025-10');
    assert.equal(byNo.get('2026010102').validFrom, '2025-09');
    assert.equal(byNo.get('2026010102').validTo, '2026-08');
  });

  it('编辑：调级必须填写原因，成功后写入变更时间线', async () => {
    const record = dbx.get('SELECT * FROM fundingIdentifications WHERE studentId = ?', [s1]);
    const noReason = await requestJson(base, 'PUT', `/api/funding/identifications/${record.id}`, {
      level: '困难',
    });
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.message, /必须填写原因/);

    const ok = await requestJson(base, 'PUT', `/api/funding/identifications/${record.id}`, {
      level: '困难',
      reason: '复核后调整等级',
    });
    assert.equal(ok.status, 200);

    const detail = await requestJson(base, 'GET', `/api/funding/identifications/${record.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.level, '困难');
    assert.equal(detail.body.logs.length, 2);
    assert.equal(detail.body.logs[0].action, 'level_change');
    assert.equal(detail.body.logs[0].fromLevel, '特别困难');
    assert.equal(detail.body.logs[0].toLevel, '困难');
  });

  it('取消必须填写原因；已取消记录可重新认定并关联原记录', async () => {
    const created = await createRecord(base, {
      studentId: s2,
      academicYear: '2026-2027',
      level: '一般困难',
      difficultyTypes: ['脱贫家庭'],
    });
    const id = created.body.id;

    const noReason = await requestJson(base, 'POST', `/api/funding/identifications/${id}/status`, {
      action: 'cancel',
    });
    assert.equal(noReason.status, 400);

    const cancelled = await requestJson(base, 'POST', `/api/funding/identifications/${id}/status`, {
      action: 'cancel',
      reason: '家庭情况改善',
    });
    assert.equal(cancelled.status, 200);
    const oldRow = dbx.get('SELECT * FROM fundingIdentifications WHERE id = ?', [id]);
    assert.equal(oldRow.status, '已取消');

    const reidentified = await createRecord(base, {
      studentId: s2,
      academicYear: '2026-2027',
      level: '困难',
      difficultyTypes: ['脱贫家庭'],
      previousId: id,
      reason: '补充材料后重新认定',
    });
    assert.equal(reidentified.status, 200);
    const newRow = dbx.get('SELECT * FROM fundingIdentifications WHERE id = ?', [reidentified.body.id]);
    assert.equal(newRow.status, '已认定');
    assert.equal(newRow.previousId, id);
  });

  it('学年结转：生成目标学年待复核，重复执行跳过', async () => {
    const preview = await requestJson(base, 'GET', '/api/funding/rollover/preview?fromYear=2026-2027&toYear=2027-2028');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.total, 2);
    assert.equal(preview.body.skippedCount, 0);

    const rolled = await requestJson(base, 'POST', '/api/funding/rollover', {
      fromYear: '2026-2027',
      toYear: '2027-2028',
    });
    assert.equal(rolled.status, 200);
    assert.equal(rolled.body.created, 2);
    assert.equal(rolled.body.skipped, 0);

    const again = await requestJson(base, 'POST', '/api/funding/rollover', {
      fromYear: '2026-2027',
      toYear: '2027-2028',
    });
    assert.equal(again.body.created, 0);
    assert.equal(again.body.skipped, 2);

    const list = await requestJson(base, 'GET', '/api/funding/identifications?page=1&pageSize=10&academicYear=2027-2028');
    assert.equal(list.body.total, 2);
    assert.ok(list.body.list.every((row) => row.status === '待复核' && row.source === 'rollover'));
  });

  it('批量确认复核：目标学年记录转为已认定', async () => {
    const list = await requestJson(base, 'GET', '/api/funding/identifications?page=1&pageSize=10&academicYear=2027-2028');
    const ids = list.body.list.map((row) => row.id);
    const result = await requestJson(base, 'POST', '/api/funding/identifications/batch', {
      ids,
      action: 'confirm',
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.successCount, 2);
    assert.equal(result.body.failureCount, 0);

    const after = await requestJson(base, 'GET', '/api/funding/identifications?page=1&pageSize=10&academicYear=2027-2028');
    assert.ok(after.body.list.every((row) => row.status === '已认定'));
  });

  it('导入预览：按学号从学生名册回填姓名、班级与年级', async () => {
    const res = await requestJson(base, 'POST', '/api/funding/identifications/import/preview', {
      studentNos: ['2026010101', '9999999999'],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.students.length, 1);
    assert.equal(res.body.students[0].name, '谢明轩');
    assert.equal(res.body.students[0].className, CLASS_NAME);
    assert.equal(res.body.students[0].grade, GRADE);
    assert.equal(res.body.students[0].manageable, true);
    assert.deepEqual(res.body.notFound, ['9999999999']);
  });

  it('Excel 导入：有效行入库，无效学号返回失败明细', async () => {
    const result = await requestJson(base, 'POST', '/api/funding/identifications/import', {
      rows: [
        {
          row: 2,
          studentNo: '2026010103',
          name: '高梓涵',
          academicYear: '2026-2027',
          level: '特别困难',
          difficultyTypes: ['孤儿'],
          validFrom: '2026-09-01',
          validTo: '2027-08-31',
        },
        {
          row: 3,
          studentNo: '9999999999',
          name: '不存在',
          academicYear: '2026-2027',
          level: '困难',
        },
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.created, 1);
    assert.equal(result.body.failureCount, 1);
    assert.match(result.body.failures[0].reason, /未匹配到学生名册/);
    const row = dbx.get('SELECT * FROM fundingIdentifications WHERE studentId = ?', [s3]);
    assert.equal(row.level, '特别困难');
    assert.equal(row.source, 'import');
    assert.equal(row.validFrom, '2026-09');
    assert.equal(row.validTo, '2027-08');
  });

  it('统计口径：按等级/班级/类型汇总，并计算认定覆盖率', async () => {
    const stats = await requestJson(base, 'GET', '/api/funding/stats?academicYear=2026-2027');
    assert.equal(stats.status, 200);
    assert.equal(stats.body.summary.identifiedCount, 3);
    assert.equal(stats.body.summary.cancelledCount, 1);
    assert.equal(stats.body.summary.studentCount, 3);
    assert.equal(stats.body.summary.coverage, 100);
    assert.equal(stats.body.byLevel.find((item) => item.label === '困难').count, 2);
    assert.equal(stats.body.byLevel.find((item) => item.label === '特别困难').count, 1);
    assert.equal(stats.body.byLevel.find((item) => item.label === '一般困难').count, 0);
    assert.equal(stats.body.byClass[0].label, CLASS_NAME);
    assert.equal(stats.body.byClass[0].count, 3);
    assert.ok(stats.body.byType.some((item) => item.label === '孤儿'));
  });
});

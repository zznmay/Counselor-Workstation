import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  dbx,
  headersOf,
  nowStr,
  requestAs,
  seedGradeAndClass,
  seedHeadTeacher,
  startTestServer,
  studentsRoute,
} from './helpers/importServer.js';

/**
 * 学生名册「关注等级 / 困难等级」标签的数据层权限测试：
 * - 带班用户（classCounselors）仅本班学生的响应含 mentalLevel / fundingLevel；
 * - 非本班学生（即使可见）不回传这两个字段；
 * - 无带班的辅导员角色（可见全员）同样不回传任何等级字段；
 * - 管理员全量可见。
 * 困难等级口径：最近学年（同年按认定月份）的「已认定」记录，已取消不计。
 */

const GRADE = '2026级';
const CLASS_A = '计应2601';
const CLASS_B = '电商2601';

function seedStudent(studentNo, name, classId) {
  const exist = dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo]);
  if (exist) return exist.id;
  const id = `s-${studentNo}`;
  dbx.run(
    `INSERT INTO students (id, studentNo, name, gender, grade, major, className, classId, phone, dorm,
       politicalStatus, origin, status, headTeacher, counselor, fatherName, fatherPhone, motherName,
       motherPhone, position, remark, enrollDate, ownerId, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, '男', ?, '测试专业', '测试班', ?, '13800000000', NULL, '共青团员', '浙江杭州', '在读',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-01', NULL, NULL, ?, ?)`,
    [id, studentNo, name, GRADE, classId, nowStr(), nowStr()],
  );
  return id;
}

function seedMental(studentId, level) {
  dbx.run(
    'INSERT OR REPLACE INTO mentalHealth (studentId, level, note, updatedBy, updatedAt) VALUES (?, ?, NULL, ?, ?)',
    [studentId, level, '测试', nowStr()],
  );
}

function seedFunding(id, studentId, academicYear, level, status = '已认定') {
  dbx.run(
    `INSERT OR REPLACE INTO fundingIdentifications
       (id, studentId, academicYear, level, status, identifiedAt, source, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, '2025-09', 'manual', 1, ?, ?)`,
    [id, studentId, academicYear, level, status, nowStr(), nowStr()],
  );
}

describe('学生名册等级标签权限（students 列表 mentalLevel / fundingLevel）', () => {
  let base;
  let close;

  before(async () => {
    const server = await startTestServer([['/api/students', studentsRoute]]);
    base = server.base;
    close = server.close;

    const { classId: classA } = seedGradeAndClass(GRADE, CLASS_A);
    const { classId: classB } = seedGradeAndClass(GRADE, CLASS_B);

    // 班主任仅带 A 班；另造一名不带班的辅导员角色用户
    const ht = seedHeadTeacher('tag_ht', '标签班主任');
    dbx.run(
      "INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, 'headTeacher', ?)",
      [classA, ht, nowStr()],
    );
    dbx.run(
      `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
       VALUES ('tag_counselor', '无带班辅导员', 'counselor', 'x', 0, 0, ?)`,
      [nowStr()],
    );
    dbx.run("INSERT OR IGNORE INTO userRoles (userId, roleKey) SELECT id, 'counselor' FROM users WHERE username = 'tag_counselor'");

    const sa1 = seedStudent('2026011101', '标签甲', classA);
    const sa2 = seedStudent('2026011102', '标签乙', classA);
    const sb1 = seedStudent('2026012201', '标签丙', classB);

    seedMental(sa1, '密切关注');
    seedMental(sb1, '重点关注');
    // 甲：两个学年都有认定 → 应取最近学年（2025-2026 特别困难）
    seedFunding('f-a1-old', sa1, '2024-2025', '困难');
    seedFunding('f-a1-new', sa1, '2025-2026', '特别困难');
    // 乙：已取消的更新记录不计，应取已认定的「困难」
    seedFunding('f-a2-ok', sa2, '2025-2026', '困难');
    seedFunding('f-a2-cancelled', sa2, '2025-2026', '特别困难', '已取消');
    seedFunding('f-b1', sb1, '2025-2026', '一般困难');
  });

  after(async () => {
    await close();
  });

  const listAs = async (username) => {
    const { body } = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, username);
    const byNo = {};
    for (const row of body.list) byNo[row.studentNo] = row;
    return byNo;
  };

  it('带班班主任：本班学生回传等级字段，可见范围仅本班', async () => {
    const byNo = await listAs('tag_ht');
    const sa1 = byNo['2026011101'];
    const sa2 = byNo['2026011102'];

    assert.equal(byNo['2026012201'], undefined, '非本班学生不在可见范围内');

    assert.equal(sa1.mentalLevel, '密切关注');
    assert.equal(sa1.fundingLevel, '特别困难'); // 最近学年优先于旧学年
    assert.equal(sa2.fundingLevel, '困难'); // 已取消的「特别困难」不计
    assert.equal(sa2.mentalLevel, undefined);
  });

  it('无带班的辅导员角色：可见全员但任何学生均不回传等级字段', async () => {
    const { body } = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, 'tag_counselor');
    assert.ok(body.total >= 3, '辅导员角色应可见全部学生');
    for (const row of body.list) {
      assert.ok(!('mentalLevel' in row), `无带班不应携带关注等级：${row.studentNo}`);
      assert.ok(!('fundingLevel' in row), `无带班不应携带困难等级：${row.studentNo}`);
    }
  });

  it('管理员：全量回传等级字段', async () => {
    const byNo = await listAs('admin');
    assert.equal(byNo['2026011101'].mentalLevel, '密切关注');
    assert.equal(byNo['2026011101'].fundingLevel, '特别困难');
    assert.equal(byNo['2026011102'].fundingLevel, '困难');
    assert.equal(byNo['2026012201'].mentalLevel, '重点关注');
    assert.equal(byNo['2026012201'].fundingLevel, '一般困难');
  });
});

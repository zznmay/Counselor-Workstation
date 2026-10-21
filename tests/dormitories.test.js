import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  dbx,
  dormitoriesRoute,
  nowStr,
  requestJson,
  seedGradeAndClass,
  startTestServer,
  studentsRoute,
} from './helpers/importServer.js';

/**
 * 寝室管理路由级测试：新增 / 编辑 / 删除 / 列表筛选 / 批量导入。
 * 覆盖两条核心口径：
 *   ① 名册「宿舍」= 寝室管理的 宿舍楼 + 房间号 直接拼接；
 *   ② 任何寝室写入都同步 students.dorm 镜像（删除则清空）。
 */

const GRADE = '2026级';
const CLASS_NAME = '计应2601';

/** 直接造一名学生（寝室数据必须挂在真实学号上） */
function seedStudent(studentNo, name, overrides = {}) {
  const { classId } = seedGradeAndClass(GRADE, CLASS_NAME);
  const exist = dbx.get('SELECT id FROM students WHERE studentNo = ?', [studentNo]);
  if (exist) return exist.id;
  dbx.run(
    `INSERT INTO students (id, studentNo, name, gender, grade, major, className, classId, phone, dorm,
       politicalStatus, origin, status, headTeacher, counselor, fatherName, fatherPhone, motherName,
       motherPhone, position, remark, enrollDate, ownerId, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '共青团员', '浙江杭州', '在读', '罗海燕', '王老师',
       '张大', '13800001001', '李芳', '13900001002', NULL, NULL, '2026-09-01', NULL, NULL, ?, ?)`,
    [`s-${studentNo}`, studentNo, name, overrides.gender ?? '男', GRADE, '计算机应用技术', CLASS_NAME,
      classId, '13800001111', nowStr(), nowStr()],
  );
  return `s-${studentNo}`;
}

const dormOf = (studentNo) =>
  dbx.get('SELECT * FROM dormitories WHERE studentNo = ?', [studentNo]);
const studentRow = (studentNo) =>
  dbx.get('SELECT s.dorm, d.building AS dormBuilding, d.room AS dormRoom FROM students s LEFT JOIN dormitories d ON d.studentNo = s.studentNo WHERE s.studentNo = ?', [studentNo]);

describe('寝室管理（dormitories）', () => {
  let base;
  let close;

  before(async () => {
    const server = await startTestServer([
      ['/api/students', studentsRoute],
      ['/api/dormitories', dormitoriesRoute],
    ]);
    base = server.base;
    close = server.close;
    seedStudent('2026010101', '谢明轩');
    seedStudent('2026010102', '何雨欣', { gender: '女' });
    seedStudent('2026010103', '高梓涵');
  });

  after(async () => {
    await close();
  });

  it('新增分配：写入寝室表并同步名册镜像（宿舍 = 宿舍楼+房间号）', async () => {
    const res = await requestJson(base, 'POST', '/api/dormitories', {
      studentNo: '2026010101', building: '荷园B', room: '512',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.building, '荷园B');
    assert.equal(res.body.room, '512');
    assert.equal(res.body.name, '谢明轩'); // 身份字段来自名册
    const row = studentRow('2026010101');
    assert.equal(row.dormBuilding, '荷园B');
    assert.equal(row.dormRoom, '512');
    assert.equal(row.dorm, '荷园B512');

    // 同一学号重复新增应被拒（一名学生仅一条分配）
    const dup = await requestJson(base, 'POST', '/api/dormitories', {
      studentNo: '2026010101', building: '荷园C', room: '101',
    });
    assert.equal(dup.status, 400);
  });

  it('学号不在名册 / 宿舍楼或房间号为空 → 400', async () => {
    const missing = await requestJson(base, 'POST', '/api/dormitories', {
      studentNo: '9999999999', building: '荷园B', room: '512',
    });
    assert.equal(missing.status, 400);
    const noRoom = await requestJson(base, 'POST', '/api/dormitories', {
      studentNo: '2026010102', building: '荷园B', room: '',
    });
    assert.equal(noRoom.status, 400);
  });

  it('列表支持学号 / 姓名 / 班级 / 宿舍楼 / 房间号 模糊查询与分页', async () => {
    await requestJson(base, 'POST', '/api/dormitories', {
      studentNo: '2026010102', building: '梅园A', room: '101',
    });
    const all = await requestJson(base, 'GET', '/api/dormitories?page=1&pageSize=10');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 2);

    const byBuilding = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&building=${encodeURIComponent('荷园')}`);
    assert.equal(byBuilding.body.total, 1);
    assert.equal(byBuilding.body.list[0].studentNo, '2026010101');

    const byName = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&name=${encodeURIComponent('何雨欣')}`);
    assert.equal(byName.body.total, 1);

    const byClass = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&className=${encodeURIComponent(CLASS_NAME)}`);
    assert.equal(byClass.body.total, 2);

    // 年级精确筛选 + 多班级（字典 ID，逗号分隔）筛选
    const classId = dbx.get(
      'SELECT c.id FROM classes c JOIN grades g ON g.id = c.gradeId WHERE c.name = ? AND g.name = ?',
      [CLASS_NAME, GRADE],
    ).id;
    const byGrade = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&grade=${encodeURIComponent(GRADE)}`);
    assert.equal(byGrade.body.total, 2);
    const byOtherGrade = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&grade=${encodeURIComponent('2025级')}`);
    assert.equal(byOtherGrade.body.total, 0);
    const byClassIds = await requestJson(base, 'GET', `/api/dormitories?page=1&pageSize=10&classIds=${classId},999999`);
    assert.equal(byClassIds.body.total, 2);
    const byUnknownClassIds = await requestJson(base, 'GET', '/api/dormitories?page=1&pageSize=10&classIds=999999');
    assert.equal(byUnknownClassIds.body.total, 0);

    const byRoom = await requestJson(base, 'GET', '/api/dormitories?page=1&pageSize=10&room=101');
    assert.equal(byRoom.body.total, 1);

    const paged = await requestJson(base, 'GET', '/api/dormitories?page=1&pageSize=1');
    assert.equal(paged.body.list.length, 1);
    assert.equal(paged.body.total, 2);
  });

  it('编辑：仅调整宿舍楼/房间号，镜像随之更新', async () => {
    const target = dormOf('2026010101');
    const res = await requestJson(base, 'PUT', `/api/dormitories/${target.id}`, {
      building: '荷园B', room: '513',
    });
    assert.equal(res.status, 200);
    const row = studentRow('2026010101');
    assert.equal(row.dormRoom, '513');
    assert.equal(row.dorm, '荷园B513');
  });

  it('批量导入：新增 / 跳过 / 三类失败，且写入事务原子生效', async () => {
    const res = await requestJson(base, 'POST', '/api/dormitories/import', {
      rows: [
        // ① 新增：学号在名册且身份字段一致
        { row: 2, data: { studentNo: '2026010103', name: '高梓涵', className: CLASS_NAME, grade: GRADE, gender: '男', building: '竹园A', room: '205' } },
        // ② 跳过：与系统记录完全一致
        { row: 3, data: { studentNo: '2026010101', building: '荷园B', room: '513' } },
        // ③ 失败：学号不在名册
        { row: 4, data: { studentNo: '9999999999', building: '竹园A', room: '999' } },
        // ④ 失败：姓名与名册不一致
        { row: 5, data: { studentNo: '2026010102', name: '姓名写错了', building: '竹园A', room: '206' } },
        // ⑤ 失败：本批内学号重复
        { row: 6, data: { studentNo: '2026010103', building: '竹园B', room: '777' } },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.insertedCount, 1);
    assert.equal(res.body.updatedCount, 0);
    assert.equal(res.body.skippedCount, 1);
    assert.equal(res.body.failures.length, 3);
    assert.equal(res.body.failures[0].row, 4);
    assert.equal(res.body.failures[1].row, 5);
    assert.equal(res.body.failures[2].row, 6);

    const added = studentRow('2026010103');
    assert.equal(added.dormBuilding, '竹园A');
    assert.equal(added.dorm, '竹园A205');
    // 被判失败的第 ⑤ 行未写入
    assert.equal(dormOf('2026010103').building, '竹园A');
  });

  it('删除：寝室记录清除且名册镜像置空', async () => {
    const target = dormOf('2026010101');
    const res = await requestJson(base, 'DELETE', `/api/dormitories/${target.id}`);
    assert.equal(res.status, 200);
    assert.equal(dormOf('2026010101'), null);
    const row = studentRow('2026010101');
    assert.equal(row.dormBuilding, null);
    assert.equal(row.dorm, null);
  });

  it('批量删除：一次清除多条并同步名册镜像，重复/空选择分别返回 409/400', async () => {
    const targets = ['2026010102', '2026010103'].map((no) => dormOf(no));
    assert.equal(targets.length, 2);
    const res = await requestJson(base, 'POST', '/api/dormitories/batch-delete', {
      ids: targets.map((t) => t.id),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.deletedCount, 2);
    for (const no of ['2026010102', '2026010103']) {
      assert.equal(dormOf(no), null);
      assert.equal(studentRow(no).dorm, null);
    }

    // 已删除的记录再次提交 → 409（提示刷新后重选）
    const again = await requestJson(base, 'POST', '/api/dormitories/batch-delete', {
      ids: targets.map((t) => t.id),
    });
    assert.equal(again.status, 409);

    const empty = await requestJson(base, 'POST', '/api/dormitories/batch-delete', { ids: [] });
    assert.equal(empty.status, 400);
  });
});

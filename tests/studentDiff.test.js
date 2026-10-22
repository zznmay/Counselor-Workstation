import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { diffStudentFields, normalizeTarget } from '../server/lib/studentDiff.js';

/**
 * 学生导入 upsert 字段比对单测：
 * 覆盖「新增、完全相同（跳过）、字段部分更新」三种核心场景，
 * 以及 null/'' 等价、默认值不产生假差异等比对口径细节。
 *
 * 2026-10-21 教师唯一来源改造后：「班主任 / 辅导员」不再从导入行取值
 * （学生模板已移除两列），值由 routes/students.js 在拿到 classId 后按
 * 班级人员配置派生注入 target，故 normalizeTarget 不再产出这两个字段。
 */

const clsRow = { id: 12, name: '计应2601' };

/** 一条完整规范化的导入行（与前端校验通过后提交的 data 一致） */
function importData(overrides = {}) {
  return {
    studentNo: '2026010101',
    name: '张三',
    gender: '男',
    grade: '2026级',
    major: '计算机应用技术',
    className: '计应2601',
    phone: '13800001111',
    dorm: '学生公寓5-603',
    politicalStatus: '共青团员',
    origin: '浙江杭州',
    status: '在读',
    position: '学习委员',
    remark: '',
    enrollDate: '2026-09-01',
    fatherName: '张大山',
    fatherPhone: '13800001001',
    motherName: '李秀芳',
    motherPhone: '13900001002',
    ...overrides,
  };
}

describe('normalizeTarget（新增场景：导入行 → 规范化目标值）', () => {
  it('完整行生成与各字段一致的规范化目标值', () => {
    const target = normalizeTarget(importData(), clsRow);
    assert.strictEqual(target.name, '张三');
    assert.strictEqual(target.gender, '男');
    assert.strictEqual(target.grade, '2026级');
    assert.strictEqual(target.className, '计应2601');
    assert.strictEqual(target.classId, 12);
    assert.strictEqual(target.phone, '13800001111');
    assert.strictEqual(target.dorm, '学生公寓5-603');
    assert.strictEqual(target.status, '在读');
    assert.strictEqual(target.statusChangedAt, '');
    // 责任人不再从导入行取值：由班级人员配置派生（见 routes/students.js）
    assert.strictEqual(target.counselor, undefined);
    assert.strictEqual(target.headTeacher, undefined);
    assert.strictEqual(target.enrollDate, '2026-09-01');
  });

  it('默认值口径：学籍状态留空=在读、性别缺省=男；责任人不再有「王老师」硬编码兜底', () => {
    const target = normalizeTarget(
      importData({ status: '', counselor: '', headTeacher: '', gender: undefined }),
      clsRow,
    );
    assert.strictEqual(target.status, '在读');
    assert.strictEqual(target.counselor, undefined);
    assert.strictEqual(target.gender, '男');
  });

  it('文本字段统一去首尾空白；空选填字段归一为空串（入库时转 null）', () => {
    const target = normalizeTarget(
      importData({ name: ' 张三 ', dorm: '  ', remark: null }),
      clsRow,
    );
    assert.strictEqual(target.name, '张三');
    assert.strictEqual(target.dorm, '');
    assert.strictEqual(target.remark, '');
  });
});

describe('diffStudentFields（upsert 三场景）', () => {
  it('新增场景：库中无记录（existing 为 null/undefined）时全部字段视为有变化（调用侧据此走 INSERT）', () => {
    const target = normalizeTarget(importData(), clsRow);
    const fromNull = diffStudentFields(target, null);
    assert.ok(fromNull.length > 0);
    assert.ok(fromNull.includes('name'));
    assert.ok(fromNull.includes('phone'));

    const fromUndefined = diffStudentFields(target, undefined);
    // COMPARE_FIELDS 21 项：headTeacher/counselor 未注入、remark/statusChangedAt 为空，
    // 空值与 undefined 等价 → 实际报 17 项变化
    assert.strictEqual(fromUndefined.length, 17);
  });

  it('完全相同场景：与库中记录逐字段一致（含 null 与空串等价）→ 空数组，导入时跳过', () => {
    const target = normalizeTarget(
      importData({
        dorm: '', remark: '', politicalStatus: '', origin: '',
        fatherName: '', fatherPhone: '', motherName: '', motherPhone: '', position: '',
      }),
      clsRow,
    );
    // 模拟库中已有行：选填字段为 null（空值入库口径）、classId 为数字
    const existing = {
      ...target,
      dorm: null, remark: null, politicalStatus: null, origin: null,
      fatherName: null, fatherPhone: null, motherName: null, motherPhone: null, position: null,
      classId: 12,
      studentNo: '2026010101',
    };
    assert.deepStrictEqual(diffStudentFields(target, existing), []);
  });

  it('派生责任人：路由侧注入 teacherSync 派生值后仍参与比对（用于纠正历史自由文本）', () => {
    const target = { ...normalizeTarget(importData(), clsRow), counselor: '王老师', headTeacher: '罗海燕' };
    // 库中旧文本与派生值都不一致 → 报两个变化，导入时才会改写为派生值
    assert.deepStrictEqual(
      diffStudentFields(target, { ...target, counselor: '王老师老师', headTeacher: null }),
      ['headTeacher', 'counselor'],
    );
    // 与派生值一致 → 无变化（重复导入不会反复改写）
    assert.deepStrictEqual(diffStudentFields(target, { ...target, counselor: '王老师', headTeacher: '罗海燕' }), []);
  });

  it('重复导入同一文件：第二次导入与首次入库后的记录完全一致 → 空数组（默认值不产生假差异）', () => {
    // 首次导入入库的行（INSERT 使用 normalizeTarget 的取值分支）
    const stored = normalizeTarget(
      importData({ dorm: '', remark: '' }),
      clsRow,
    );
    // 第二次导入同样数据，比对库中行 → 无变化
    const target = normalizeTarget(
      importData({ dorm: '', remark: '' }),
      clsRow,
    );
    assert.deepStrictEqual(diffStudentFields(target, stored), []);
  });

  it('字段部分更新场景：仅手机号变化 → 只返回 phone', () => {
    const target = normalizeTarget(importData({ phone: '13900002222' }), clsRow);
    const existing = { ...target, phone: '13800001111' };
    assert.deepStrictEqual(diffStudentFields(target, existing), ['phone']);
  });

  it('字段部分更新场景： dorm 与班内职务同时变化，其余不变 → 仅返回变化字段', () => {
    const target = normalizeTarget(
      importData({ dorm: '学生公寓6-101', position: '班长' }),
      clsRow,
    );
    const existing = {
      ...target,
      dorm: '学生公寓5-603',
      position: '学习委员',
    };
    assert.deepStrictEqual(diffStudentFields(target, existing), [
      'dorm',
      'position',
    ]);
  });

  it('班级调整场景：className 与 classId 成对变化 → 同时返回两个字段', () => {
    const target = normalizeTarget(importData({ className: '电商2601' }), { id: 15, name: '电商2601' });
    const existing = { ...target, className: '计应2601', classId: 12 };
    assert.deepStrictEqual(diffStudentFields(target, existing), [
      'className',
      'classId',
    ]);
  });

  it('比对口径：库中 null 与导入空串等价；数字与数字字符串宽化比较', () => {
    const target = normalizeTarget(importData({ dorm: '', origin: '' }), clsRow);
    assert.deepStrictEqual(diffStudentFields(target, { ...target, dorm: null, origin: null }), []);
    assert.deepStrictEqual(diffStudentFields(target, { ...target, classId: '12' }), []);
  });
});

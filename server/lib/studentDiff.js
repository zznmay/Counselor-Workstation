/**
 * 学生/班级批量导入 upsert 的字段比对纯函数（无 DB 依赖，供导入路由与单元测试共用）：
 * - normalizeTarget：把导入行数据规范化为「与 INSERT 完全一致」的目标值，
 *   INSERT 与 UPDATE 共用同一取值分支，避免规范化漂移产生假差异/漏差异。
 * - diffStudentFields：以规范化目标值逐字段比对库中现有行，返回有变化字段名数组
 *   （空数组 = 完全相同，导入时跳过不更新）。
 * - diffCounselorIds：班级导入的辅导员集合比对，返回需新增/移除的用户 id。
 * 比对口径：库中 null 与导入 ''/null 视为相等。
 */

/**
 * 参与比对的学生字段（学号为主键标识不参与；className 与 classId 成对比对）。
 * headTeacher / counselor 保留在比对清单内：其值由班级人员配置派生后注入 target，
 * 参与比对才能把历史遗留的自由文本纠正为派生值。
 */
const COMPARE_FIELDS = [
  'name', 'gender', 'grade', 'major', 'className', 'classId', 'phone', 'dorm',
  'politicalStatus', 'origin', 'status', 'position', 'remark',
  'enrollDate', 'headTeacher', 'counselor',
  'fatherName', 'fatherPhone', 'motherName', 'motherPhone',
];

function text(v) {
  return String(v ?? '').trim();
}

/** 统一比较：数字/字符串宽化 + null 与 '' 等价 */
function sameValue(a, b) {
  return String(a ?? '') === String(b ?? '');
}

/**
 * 导入行数据 → 规范化目标值。
 *
 * 注意：headTeacher / counselor **不再从导入行取值** —— 班级管理（工号录入 + 同步建号）是这两类
 * 数据的唯一来源，学生模板已移除两列，值由 routes/students.js 在解析出 classId 后调用
 * teacherSync.derivedTeachersOfClass() 派生回填（写入前注入 target，故仍参与字段比对，
 * 用于纠正历史脏值）。这里刻意不提供默认值（历史硬编码的「王老师」已删除）。
 *
 * @param data 导入行 data（前端已做电话/日期规范化；默认值口径与模板说明一致：
 *             学籍状态留空=在读、性别缺省=男）
 * @param clsRow 班级字典命中行 { id, name }（未命中时 classId 为 null，由调用侧判失败）
 */
function normalizeTarget(data, clsRow) {
  return {
    name: text(data?.name),
    gender: text(data?.gender) || '男',
    grade: text(data?.grade),
    major: text(data?.major),
    className: text(data?.className),
    classId: clsRow ? clsRow.id : null,
    phone: text(data?.phone),
    dorm: text(data?.dorm),
    politicalStatus: text(data?.politicalStatus),
    origin: text(data?.origin),
    status: text(data?.status) || '在读',
    position: text(data?.position),
    remark: text(data?.remark),
    enrollDate: text(data?.enrollDate),
    fatherName: text(data?.fatherName),
    fatherPhone: text(data?.fatherPhone),
    motherName: text(data?.motherName),
    motherPhone: text(data?.motherPhone),
  };
}

/** 逐字段比对：返回有变化的字段名数组（空数组 = 完全相同） */
function diffStudentFields(target, existing) {
  return COMPARE_FIELDS.filter((f) => !sameValue(target?.[f], existing?.[f]));
}

/**
 * 辅导员集合比对：现有 vs 导入解析出的 userId 集合。
 * @returns {{ toAdd: number[], toRemove: number[] }} 均为空 = 无变化
 */
function diffCounselorIds(existingIds, incomingIds) {
  const existing = new Set((existingIds ?? []).map(Number));
  const incoming = new Set((incomingIds ?? []).map(Number));
  const toAdd = [...incoming].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !incoming.has(id));
  return { toAdd, toRemove };
}

module.exports = { COMPARE_FIELDS, normalizeTarget, diffStudentFields, diffCounselorIds, sameValue };

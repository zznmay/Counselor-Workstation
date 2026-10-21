/**
 * 寝室管理：宿舍文本拆分/合并与学生表镜像同步。
 *
 * 口径约定（与前端 `src/utils/dormitory.ts` 严格一致）：
 * - 寝室管理（dormitories 表）是宿舍数据的唯一来源：building（宿舍楼）+ room（房间号）分列存储；
 * - 学生名册展示的「宿舍」= 宿舍楼 + 房间号 直接拼接（如 荷园B + 512 → 荷园B512）；
 * - students.dorm 降级为只读镜像，仅由本模块写回，供同宿舍学生、名册导出等既有功能复用。
 */
const dbx = require('./db');
const { nowStr } = require('./audit');

/** 宿舍楼 / 房间号最大长度（与建表校验、前端 maxLength 保持一致） */
const MAX_BUILDING = 20;
const MAX_ROOM = 20;

/**
 * 拆分自由文本为「宿舍楼 + 房间号」：首个数字之前为宿舍楼，其后为房间号。
 * 例：荷园B512 → { building: '荷园B', room: '512' }；学生公寓5-412 → { building: '学生公寓', room: '5-412' }。
 * 整串无数字时整串归入宿舍楼、房间号留空（由使用方决定是否补全）。
 */
function splitDormText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { building: '', room: '' };
  const m = raw.match(/^(\D*)(\d.*)$/);
  if (!m) return { building: raw.slice(0, MAX_BUILDING), room: '' };
  return {
    building: m[1].trim().slice(0, MAX_BUILDING),
    room: m[2].trim().slice(0, MAX_ROOM),
  };
}

/** 合并展示：宿舍楼 + 房间号（如 荷园B + 512 → 荷园B512） */
function joinDorm(building, room) {
  return `${String(building ?? '').trim()}${String(room ?? '').trim()}`;
}

/**
 * 把寝室管理的当前分配回写到 students.dorm 镜像（无分配时清空为 NULL）。
 * 任何对 dormitories 的写操作后都必须调用，保证名册/室友/导出读到的镜像不漂移。
 */
function mirrorStudentDorm(studentNo) {
  const no = String(studentNo ?? '').trim();
  if (!no) return;
  const row = dbx.get('SELECT building, room FROM dormitories WHERE studentNo = ?', [no]);
  dbx.run('UPDATE students SET dorm = ?, updatedAt = ? WHERE studentNo = ?', [
    row ? joinDorm(row.building, row.room) : null,
    nowStr(),
    no,
  ]);
}

/**
 * 学生表侧写入宿舍文本时同步到寝室管理（学生新增/编辑/批量导入共用）。
 * - 空文本 → 清除该学生的寝室分配（并清空镜像）；
 * - 非空 → 按拆分规则 upsert 到 dormitories，再回写规范化后的镜像。
 */
function syncDormFromText(studentNo, text) {
  const no = String(studentNo ?? '').trim();
  if (!no) return;
  const raw = String(text ?? '').trim();
  if (!raw) {
    dbx.run('DELETE FROM dormitories WHERE studentNo = ?', [no]);
    dbx.run('UPDATE students SET dorm = NULL, updatedAt = ? WHERE studentNo = ?', [nowStr(), no]);
    return;
  }
  const { building, room } = splitDormText(raw);
  dbx.run(
    `INSERT INTO dormitories (studentNo, building, room, updatedBy, updatedAt, createdAt)
     VALUES (?, ?, ?, '系统', ?, ?)
     ON CONFLICT(studentNo) DO UPDATE SET
       building = excluded.building, room = excluded.room,
       updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
    [no, building, room, nowStr(), nowStr()],
  );
  mirrorStudentDorm(no);
}

/** 学生档案删除时清理其寝室分配（避免留下孤儿记录） */
function removeDormOfStudent(studentNo) {
  const no = String(studentNo ?? '').trim();
  if (!no) return;
  dbx.run('DELETE FROM dormitories WHERE studentNo = ?', [no]);
}

/** 学号变更时同步寝室分配的关联键（学生编辑改学号场景） */
function renameDormStudentNo(oldNo, newNo) {
  const from = String(oldNo ?? '').trim();
  const to = String(newNo ?? '').trim();
  if (!from || !to || from === to) return;
  dbx.run('UPDATE dormitories SET studentNo = ? WHERE studentNo = ?', [to, from]);
}

module.exports = {
  MAX_BUILDING,
  MAX_ROOM,
  splitDormText,
  joinDorm,
  mirrorStudentDorm,
  syncDormFromText,
  removeDormOfStudent,
  renameDormStudentNo,
};

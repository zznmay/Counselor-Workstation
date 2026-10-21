/**
 * 宿舍展示口径（与服务端 lib/dormitory.js joinDorm 严格一致）：
 * 宿舍楼 + 房间号 直接拼接 —— 荷园B + 512 → 「荷园B512」。
 */
export function formatDorm(building?: string | null, room?: string | null): string {
  return `${String(building ?? '').trim()}${String(room ?? '').trim()}`;
}

/** 学生名册展示用：一律读寝室管理下发的 dormBuilding / dormRoom，不读 students.dorm 镜像 */
export function dormOfStudent(
  student?: { dormBuilding?: string | null; dormRoom?: string | null } | null,
): string {
  if (!student) return '';
  return formatDorm(student.dormBuilding, student.dormRoom);
}

/** 宿舍楼 / 房间号最大长度（与服务端 MAX_BUILDING / MAX_ROOM 一致） */
export const MAX_BUILDING = 20;
export const MAX_ROOM = 20;

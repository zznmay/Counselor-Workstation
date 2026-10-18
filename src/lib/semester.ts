/**
 * 学期推导（前端镜像 server/lib/semester.js，Asia/Shanghai）。
 * 第一学期 8/1–次年 1/31；第二学期 2/1–7/31。
 * 仅用于日期控件边界与本地展示；学期权威值以服务端返回为准。
 */

const CN_TZ = 'Asia/Shanghai';

export interface SemesterInfoLite {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  daysLeft: number;
}

/** 服务器时区无关的「今天」（YYYY-MM-DD） */
export function todayCN(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseYmd(value: string): { y: number; mo: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) };
}

/** 由日期推导学期；日期非法返回 null */
export function semesterOf(dateStr: string, today = todayCN()): SemesterInfoLite | null {
  const p = parseYmd(dateStr);
  if (!p) return null;
  const { y, mo } = p;
  const startYear = mo >= 8 ? y : y - 1;
  const term = mo >= 8 || mo === 1 ? 1 : 2;
  const endYear = startYear + 1;
  const startDate = term === 1 ? `${startYear}-08-01` : `${endYear}-02-01`;
  const endDate = term === 1 ? `${endYear}-01-31` : `${endYear}-07-31`;
  const left = Math.max(0, Math.round((Date.parse(endDate) - Date.parse(today)) / 86400000) + 1);
  return {
    key: `${startYear}-${endYear}-${term}`,
    label: `${startYear}-${endYear}学年${term === 1 ? '第一' : '第二'}学期`,
    startDate,
    endDate,
    daysLeft: today <= endDate ? left : 0,
  };
}

export function currentSemester(now = new Date()): SemesterInfoLite {
  return semesterOf(todayCN(now), todayCN(now)) as SemesterInfoLite;
}

/** 上一学期（访谈日期允许补录的最早学期） */
export function previousSemester(sem: SemesterInfoLite): SemesterInfoLite {
  const [startYear, endYear, term] = String(sem.key).split('-');
  const sy = Number(startYear);
  const ey = Number(endYear);
  if (term === '1') {
    return {
      key: `${sy - 1}-${sy}-2`,
      label: `${sy - 1}-${sy}学年第二学期`,
      startDate: `${sy}-02-01`,
      endDate: `${sy}-07-31`,
      daysLeft: 0,
    };
  }
  return {
    key: `${sy}-${ey}-1`,
    label: `${sy}-${ey}学年第一学期`,
    startDate: `${sy}-08-01`,
    endDate: `${ey}-01-31`,
    daysLeft: 0,
  };
}

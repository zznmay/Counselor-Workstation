/**
 * 学期推导（统一按 Asia/Shanghai，避免服务器跑 UTC 时跨月错位）。
 *
 * 规则：
 * - 第一学期：8/1 – 次年 1/31
 * - 第二学期：2/1 – 7/31
 *
 * 说明：本期不接校历，学期起止为固定规则；如学校实际校历不同，
 * 后续可在本文件集中替换为「系统设置」读取，不影响调用方。
 */

const CN_TZ = 'Asia/Shanghai';

/** 服务器时区无关的「今天」，en-CA 输出 YYYY-MM-DD */
function todayCN(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** 严格校验 YYYY-MM-DD（拒绝 2026-02-30 这类非法日期） */
function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/** 两个 YYYY-MM-DD 之间的整天差（b - a） */
function daysBetween(a, b) {
  const toUtc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/**
 * 由日期推导学期。
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} [today] 参照「今天」，默认取 Asia/Shanghai 当天
 * @returns {{key:string,label:string,startDate:string,endDate:string,daysLeft:number}|null}
 */
function semesterOf(dateStr, today = todayCN()) {
  const p = parseYmd(dateStr);
  if (!p) return null;
  const { y, mo } = p;
  // 1–7 月都归上一个 8 月开学的学年
  const startYear = mo >= 8 ? y : y - 1;
  const term = mo >= 8 || mo === 1 ? 1 : 2;
  const endYear = startYear + 1;
  const startDate = term === 1 ? `${startYear}-08-01` : `${endYear}-02-01`;
  const endDate = term === 1 ? `${endYear}-01-31` : `${endYear}-07-31`;
  const left = Math.max(0, daysBetween(today, endDate) + 1); // 含今天
  return {
    key: `${startYear}-${endYear}-${term}`,
    label: `${startYear}-${endYear}学年${term === 1 ? '第一' : '第二'}学期`,
    startDate,
    endDate,
    daysLeft: today <= endDate ? left : 0,
  };
}

/** 当前学期（含距结束天数） */
function currentSemester(now = new Date()) {
  return semesterOf(todayCN(now), todayCN(now));
}

/** 上一学期（用于假期补录的准入判断） */
function previousSemester(sem) {
  if (!sem) return null;
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

/** 日期是否落在学期区间内（零填充字符串直接比较） */
function inSemester(dateStr, sem) {
  return !!parseYmd(dateStr) && !!sem && dateStr >= sem.startDate && dateStr <= sem.endDate;
}

module.exports = {
  CN_TZ,
  todayCN,
  parseYmd,
  semesterOf,
  currentSemester,
  previousSemester,
  inSemester,
};

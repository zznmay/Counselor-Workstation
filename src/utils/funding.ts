/** 资助管理通用工具：学年计算与展示格式化 */
import dayjs from 'dayjs';

import type { FundingDifficultyType, FundingProfile } from '@/types';

/** 当前学年：9 月至次年 8 月（如 2026-2027） */
export function currentAcademicYear(date = dayjs()): string {
  const year = date.year();
  return date.month() + 1 >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function nextAcademicYear(year: string): string {
  const start = Number(String(year).slice(0, 4));
  return `${start + 1}-${start + 2}`;
}

export function prevAcademicYear(year: string): string {
  const start = Number(String(year).slice(0, 4));
  return `${start - 1}-${start}`;
}

/** 学年下拉：默认当前学年前后各若干年，倒序展示 */
export function buildAcademicYearOptions(back = 3, forward = 1): { value: string; label: string }[] {
  const current = currentAcademicYear();
  const list: string[] = [];
  let cursor = current;
  for (let i = 0; i < forward; i += 1) cursor = nextAcademicYear(cursor);
  for (let i = -forward; i <= back; i += 1) {
    const start = Number(current.slice(0, 4)) + i;
    list.push(`${start}-${start + 1}`);
  }
  return list.reverse().map((value) => ({ value, label: value }));
}

/** 学年默认有效期（月份粒度）：当年 9 月至次年 8 月 */
export function academicYearRange(year: string): { validFrom: string; validTo: string } {
  const start = Number(String(year).slice(0, 4));
  return { validFrom: `${start}-09`, validTo: `${start + 1}-08` };
}

export function formatFundingTypes(types?: FundingDifficultyType[] | null): string {
  return (types ?? []).join('、');
}

export function formatFundingStudent(profile: Pick<FundingProfile, 'studentName' | 'className'>): string {
  return `${profile.studentName}（${profile.className}）`;
}

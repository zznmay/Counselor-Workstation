/** 困难生认定导出：当前筛选全量拉取 → 名册 / 班级汇总与困难类型统计 */
import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import { getFundingProfiles } from '@/api/funding';
import { FUNDING_DIFFICULTY_TYPES, FUNDING_LEVELS } from '@/constants';
import type { FundingProfile, FundingQuery } from '@/types';

import { formatFundingTypes } from './funding';
import { sanitizeCellValue } from './studentExport';
import { loadXLSX } from './xlsx';

const FETCH_PAGE_SIZE = 100;

export async function fetchAllFundingProfiles(
  filter: Omit<FundingQuery, 'page' | 'pageSize'>,
): Promise<FundingProfile[]> {
  const rows: FundingProfile[] = [];
  for (let page = 1; ; page += 1) {
    const res = await getFundingProfiles({ ...filter, page, pageSize: FETCH_PAGE_SIZE });
    rows.push(...res.list);
    if (res.list.length === 0 || rows.length >= res.total) return rows;
  }
}

function safeName(displayName?: string): string {
  return (displayName ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || '辅导员';
}

function fileSuffix(year: string): string {
  return `${year}_${dayjs().format('YYYY-MM-DD')}`;
}

export async function exportFundingRoster(
  rows: FundingProfile[],
  year: string,
  displayName?: string,
): Promise<void> {
  const XLSX = await loadXLSX();
  const columns: { label: string; wch: number; value: (r: FundingProfile) => unknown }[] = [
    { label: '学号', wch: 14, value: (r) => r.studentNo },
    { label: '姓名', wch: 10, value: (r) => r.studentName },
    { label: '性别', wch: 6, value: (r) => r.gender ?? '' },
    { label: '年级', wch: 9, value: (r) => r.grade },
    { label: '班级', wch: 12, value: (r) => r.className },
    { label: '认定学年', wch: 12, value: (r) => r.academicYear },
    { label: '困难等级', wch: 10, value: (r) => r.level },
    { label: '困难类型', wch: 22, value: (r) => formatFundingTypes(r.difficultyTypes) },
    { label: '认定日期', wch: 12, value: (r) => r.identifiedAt },
    { label: '有效期起', wch: 12, value: (r) => r.validFrom },
    { label: '有效期止', wch: 12, value: (r) => r.validTo },
    { label: '状态', wch: 9, value: (r) => r.displayStatus },
    { label: '认定依据', wch: 28, value: (r) => r.basis ?? '' },
    { label: '备注', wch: 24, value: (r) => r.remark ?? '' },
  ];
  const header = columns.map((c) => c.label);
  const body = rows.map((row) => columns.map((c) => sanitizeCellValue(c.value(row))));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = columns.map((c) => ({ wch: c.wch }));
  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: columns.length - 1 },
      }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '困难生认定名册');
  XLSX.writeFile(wb, `${safeName(displayName)}_困难生认定名册_${fileSuffix(year)}.xlsx`, { bookSST: true });
}

export async function exportFundingSummary(
  rows: FundingProfile[],
  year: string,
  displayName?: string,
): Promise<void> {
  const XLSX = await loadXLSX();
  const identified = rows.filter((r) => r.status === '已认定');

  const classMap = new Map<string, Record<string, number>>();
  for (const row of identified) {
    const key = row.className || '未分班';
    const current = classMap.get(key) ?? Object.fromEntries(FUNDING_LEVELS.map((l) => [l, 0]));
    current[row.level] = (current[row.level] ?? 0) + 1;
    classMap.set(key, current);
  }
  const classRows = [...classMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([className, counts]) => {
      const total = FUNDING_LEVELS.reduce((sum, l) => sum + (counts[l] ?? 0), 0);
      return [className, ...FUNDING_LEVELS.map((l) => counts[l] ?? 0), total];
    });
  const classWs = XLSX.utils.aoa_to_sheet([
    ['班级', ...FUNDING_LEVELS, '合计'],
    ...classRows,
    ['总计', ...FUNDING_LEVELS.map((l) => identified.filter((r) => r.level === l).length), identified.length],
  ]);
  classWs['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }];

  const typeCounts = new Map<string, number>();
  for (const row of identified) {
    const types = row.difficultyTypes.length > 0 ? row.difficultyTypes : ['未填写'];
    for (const type of types) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const typeOrder = [...FUNDING_DIFFICULTY_TYPES, '未填写'];
  const typeRows = [...typeCounts.entries()]
    .sort((a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0]))
    .map(([label, count]) => [label, count]);
  const typeWs = XLSX.utils.aoa_to_sheet([['困难类型', '人数'], ...typeRows]);
  typeWs['!cols'] = [{ wch: 16 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, classWs, '班级汇总');
  XLSX.utils.book_append_sheet(wb, typeWs, '困难类型统计');
  XLSX.writeFile(wb, `${safeName(displayName)}_困难生认定汇总_${fileSuffix(year)}.xlsx`, { bookSST: true });
}

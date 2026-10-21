/** 寝室分配批量导出（纯前端）：按当前筛选条件下拉全量数据 → xlsx 生成与下载 */
import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import { getDormitories } from '@/api/dormitory';
import type { Dormitory, DormitoryQuery } from '@/types';
import { formatDorm } from './dormitory';
import { sanitizeCellValue } from './studentExport';
import { loadXLSX } from './xlsx';

const FETCH_PAGE_SIZE = 100;

interface DormExportColumn {
  label: string;
  wch: number;
  value: (row: Dormitory) => unknown;
}

const COLUMNS: DormExportColumn[] = [
  { label: '学号', wch: 14, value: (r) => r.studentNo },
  { label: '姓名', wch: 10, value: (r) => r.name },
  { label: '性别', wch: 6, value: (r) => r.gender },
  { label: '年级', wch: 9, value: (r) => r.grade },
  { label: '班级', wch: 12, value: (r) => r.className },
  { label: '宿舍楼', wch: 12, value: (r) => r.building },
  { label: '房间号', wch: 9, value: (r) => r.room },
  { label: '宿舍', wch: 16, value: (r) => formatDorm(r.building, r.room) },
  { label: '更新人', wch: 12, value: (r) => r.updatedBy ?? '' },
  { label: '更新时间', wch: 20, value: (r) => r.updatedAt ?? '' },
];

/** 分页拉取当前筛选条件下的全部记录（服务端仍按可见范围收口） */
export async function fetchAllDormitories(
  filter: Omit<DormitoryQuery, 'page' | 'pageSize'>,
): Promise<Dormitory[]> {
  const rows: Dormitory[] = [];
  for (let page = 1; ; page += 1) {
    const res = await getDormitories({ ...filter, page, pageSize: FETCH_PAGE_SIZE });
    rows.push(...res.list);
    if (res.list.length === 0 || rows.length >= res.total) return rows;
  }
}

/** 导出文件名：辅导员姓名_寝室分配_YYYY-MM-DD.xlsx */
export function buildDormExportFileName(displayName?: string, date = dayjs()): string {
  const name = (displayName ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || '辅导员';
  return `${name}_寝室分配_${date.format('YYYY-MM-DD')}.xlsx`;
}

/** 生成并触发浏览器下载；bookSST 避免单元格被当作公式执行 */
export async function exportDormitories(rows: Dormitory[], displayName?: string): Promise<void> {
  const XLSX = await loadXLSX();
  const header = COLUMNS.map((c) => c.label);
  const body = rows.map((row) => COLUMNS.map((c) => sanitizeCellValue(c.value(row))));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = COLUMNS.map((c) => ({ wch: c.wch }));
  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length, c: COLUMNS.length - 1 },
      }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '寝室分配');
  XLSX.writeFile(wb, buildDormExportFileName(displayName), { bookSST: true });
}

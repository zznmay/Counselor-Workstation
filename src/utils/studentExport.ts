/** 学生名册批量导出（纯前端）：字段定义 → 数据取值 → xlsx 生成与下载 */
import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import type { Student, StudentQuery } from '@/types';
import { getStudents } from '@/api/student';
import { loadXLSX } from './xlsx';

/**
 * 可导出字段（顺序 = 「恢复默认」时的列顺序）。
 * 学生数据模型没有「学院」字段，专业（major）承担院系维度，不再单设占位列。
 */
export interface ExportFieldDef {
  /** Student 属性名（同时作为 React key） */
  key: string;
  /** Excel 中文表头 */
  label: string;
  /** 建议列宽（字符宽，中文按 2 计） */
  wch: number;
  /** 取值：null/undefined 导出为空单元格 */
  value: (s: Student) => unknown;
}

export const EXPORT_FIELDS: ExportFieldDef[] = [
  { key: 'studentNo', label: '学号', wch: 14, value: (s) => s.studentNo },
  { key: 'name', label: '姓名', wch: 10, value: (s) => s.name },
  { key: 'gender', label: '性别', wch: 6, value: (s) => s.gender },
  { key: 'grade', label: '年级', wch: 9, value: (s) => s.grade },
  { key: 'major', label: '专业', wch: 18, value: (s) => s.major },
  { key: 'className', label: '班级', wch: 11, value: (s) => s.className },
  { key: 'phone', label: '联系电话', wch: 13, value: (s) => s.phone },
  { key: 'dorm', label: '宿舍', wch: 15, value: (s) => s.dorm },
  { key: 'status', label: '学籍状态', wch: 10, value: (s) => s.status },
  { key: 'enrollDate', label: '入学日期', wch: 12, value: (s) => s.enrollDate },
  { key: 'politicalStatus', label: '政治面貌', wch: 12, value: (s) => s.politicalStatus },
  { key: 'origin', label: '生源地', wch: 12, value: (s) => s.origin },
  { key: 'position', label: '班内职务', wch: 10, value: (s) => s.position },
  { key: 'headTeacher', label: '班主任', wch: 10, value: (s) => s.headTeacher },
  { key: 'counselor', label: '辅导员', wch: 10, value: (s) => s.counselor },
  { key: 'fatherName', label: '父亲姓名', wch: 10, value: (s) => s.fatherName },
  { key: 'fatherPhone', label: '父亲电话', wch: 13, value: (s) => s.fatherPhone },
  { key: 'motherName', label: '母亲姓名', wch: 10, value: (s) => s.motherName },
  { key: 'motherPhone', label: '母亲电话', wch: 13, value: (s) => s.motherPhone },
  { key: 'remark', label: '备注', wch: 30, value: (s) => s.remark },
];

/** 默认勾选字段（学生基本信息 10 列，按上表顺序） */
export const DEFAULT_EXPORT_FIELD_KEYS = [
  'studentNo',
  'name',
  'gender',
  'grade',
  'major',
  'className',
  'phone',
  'dorm',
  'status',
  'enrollDate',
] as const;

/** 字段 key → 定义（弹窗内按勾选顺序取定义用） */
export const EXPORT_FIELD_MAP = new Map(EXPORT_FIELDS.map((f) => [f.key, f]));

/* ---------- 字段选择的会话内记忆（SPA 会话共享，刷新后恢复默认） ---------- */

let savedFieldKeys: string[] | null = null;

/** 读取上次选择（无则默认集）；返回副本防外部修改 */
export function loadExportFieldKeys(): string[] {
  return savedFieldKeys ? [...savedFieldKeys] : [...DEFAULT_EXPORT_FIELD_KEYS];
}

/** 导出成功后记忆本次选择（当前会话内保持） */
export function rememberExportFieldKeys(keys: string[]): void {
  savedFieldKeys = [...keys];
}

/* ---------- 安全校与文件名 ---------- */

/**
 * 值清洗：null/undefined → 空串；以 = + - @ Tab CR 开头的值加单引号前缀，
 * 防止 Excel/WPS 当作公式执行（CSV 公式注入同源风险）。
 * 另外写入时统一走 bookSST（共享字符串表），从文件结构上杜绝公式节点，双保险。
 */
const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (s === '') return '';
  return RISKY_PREFIX.test(s) ? `'${s}` : s;
}

/** 导出文件名：辅导员姓名_学生名册_YYYY-MM-DD.xlsx；剔除文件系统非法字符 */
export function buildExportFileName(displayName: string | undefined, date = dayjs()): string {
  const name = (displayName ?? '').replace(/[\\/:*?"<>|]/g, '').trim() || '辅导员';
  return `${name}_学生名册_${date.format('YYYY-MM-DD')}.xlsx`;
}

/* ---------- 工作簿生成 ---------- */

/** 按所选字段顺序生成工作簿：中文表头 + 数据行 + 列宽 + 表头行自动筛选 */
export async function buildStudentWorkbook(fields: ExportFieldDef[], rows: Student[]): Promise<XLSX.WorkBook> {
  const XLSX = await loadXLSX();
  const header = fields.map((f) => f.label);
  const body = rows.map((row) => fields.map((f) => sanitizeCellValue(f.value(row))));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = fields.map((f) => ({ wch: Math.max(f.wch, f.label.length * 2 + 2) }));
  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: fields.length - 1 } }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生名册');
  return wb;
}

/** 生成并触发浏览器下载；bookSST 让全部值落共享字符串表，杜绝公式注入 */
export async function writeStudentWorkbook(fields: ExportFieldDef[], rows: Student[], fileName: string): Promise<void> {
  const XLSX = await loadXLSX();
  XLSX.writeFile(await buildStudentWorkbook(fields, rows), fileName, { bookSST: true });
}

/* ---------- 数据获取（复用现有列表接口，不新增后端） ---------- */

/** 单次拉取上限保护：后端 pageSize≤100，200 页 = 2 万行封顶 */
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 200;

/**
 * 拉取当前筛选条件下的全部学生（辅导员无全量 briefs 接口，用列表接口分页循环）。
 * 可见范围由服务端 rosterScope 收口，前端只负责翻页拼装。
 */
export async function fetchAllStudentsForExport(
  query: StudentQuery,
  onProgress?: (done: number, total: number) => void,
): Promise<Student[]> {
  const first = await getStudents({ ...query, page: 1, pageSize: EXPORT_PAGE_SIZE });
  const total = first.total;
  const list: Student[] = [...first.list];
  onProgress?.(list.length, total);
  const pages = Math.min(EXPORT_MAX_PAGES, Math.ceil(total / EXPORT_PAGE_SIZE));
  for (let p = 2; p <= pages; p++) {
    const res = await getStudents({ ...query, page: p, pageSize: EXPORT_PAGE_SIZE });
    list.push(...res.list);
    onProgress?.(list.length, total);
  }
  return list;
}

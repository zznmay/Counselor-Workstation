import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import type { ClassImportFailure, ParsedClassRow } from '@/types';

/**
 * 班级名单 Excel 批量导入工具（与 studentImport.ts 同一套 xlsx 模式）：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 逐行校验 → 失败明细导出。
 * 校验规则与服务端 POST /classes/import 保持一致；字典类校验（年级/辅导员/班主任）
 * 由调用侧注入集合，缺省时跳过该项预检、交由服务端兜底。
 * 班级已存在于系统不再判失败：由服务端按 upsert 处理（人员分配有变化则更新，完全相同跳过）。
 * 教师名单（班级管理 → 教师名单）是辅导员/班主任的唯一来源：这里只按姓名引用，
 * 匹配不到在职教师时该行判失败，不会自动建号。
 */

/** 模板列，顺序与班级字段对应 */
export const CLASS_HEADERS = ['班级名称', '年级', '辅导员', '班主任'] as const;

const FIELD_GUIDE: [string, string, string][] = [
  ['班级名称', '必填', '不可超过 30 个字，如 计应2601；同年级下已存在的班级按更新处理（更新人员分配），不可与本表其他行重复'],
  ['年级', '必填', '必须已在「年级管理」中存在，如 2026级；不会自动创建新年级'],
  ['辅导员', '选填', '在职辅导员的姓名，可留空（仅建班不分配）；多人用「、」分隔，如 王老师、李老师'],
  ['班主任', '选填', '在职班主任的姓名；同样支持多人用「、」分隔。未匹配到在职班主任时该行判失败'],
];

const EXAMPLE_ROWS: (string | undefined)[][] = [
  ['计应2701', '2027级', '王老师、李老师', '赵老师'],
  ['电商2701', '2027级', '示例行：班主任可留空，表示仅建班暂不分配；正式导入前请删除本表所有示例行', ''],
];

/** 生成班级名单导入模板工作簿（「班级名单」数据表 + 「填写说明」说明表） */
export function buildClassTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const dataWs = XLSX.utils.aoa_to_sheet([[...CLASS_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '班级名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「班级名单」工作表会被导入'],
    ['说明', '——', '导入为 upsert 方式：班级不存在则新建；已存在则更新人员分配，完全相同自动跳过'],
    ['说明', '——', '本通道以班级为准：文件中某班的辅导员/班主任集合即最终结果（覆盖该班原有分配）'],
  ]);
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

/** 下载班级名单导入模板 */
export function downloadClassTemplate(): void {
  XLSX.writeFile(buildClassTemplateWorkbook(), '班级名单导入模板.xlsx');
}

/** 解析班级名单 Excel：定位「班级名单」工作表，逐行取出 班级名称/年级/辅导员/班主任 */
export async function parseClassExcel(file: File): Promise<ParsedClassRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('班级名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  const missing = ['班级名称', '年级'].filter((colName) => indexOf(colName) < 0);
  if (missing.length > 0) throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);

  const get = (row: unknown[], colName: string) =>
    String(row[indexOf(colName)] ?? '').trim();

  const rows: ParsedClassRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i] as unknown[];
    const name = get(row, '班级名称');
    const grade = get(row, '年级');
    const counselors = get(row, '辅导员');
    const headTeachers = get(row, '班主任');
    // 整行空白跳过
    if (!name && !grade && !counselors && !headTeachers) continue;
    rows.push({ row: i + 1, data: { name, grade, counselors, headTeachers: headTeachers || undefined } });
  }
  return rows;
}

export interface ValidateClassDeps {
  /** 年级字典名称集合，缺省时跳过「年级匹配」预检 */
  gradeNames?: ReadonlySet<string>;
  /** 在职辅导员姓名集合，缺省时跳过「辅导员匹配」预检 */
  counselorNames?: ReadonlySet<string>;
  /** 在职班主任姓名集合，缺省时跳过「班主任匹配」预检 */
  headTeacherNames?: ReadonlySet<string>;
}

const COUNSELOR_SEPARATORS = /[、,，/;；]/;

/** 逐行校验班级数据：必填项、年级字典匹配、本表内重复、辅导员/班主任姓名匹配 */
export function validateClassRows(
  rows: ParsedClassRow[],
  deps: ValidateClassDeps = {},
): { valid: ParsedClassRow[]; failures: ClassImportFailure[] } {
  const { gradeNames, counselorNames, headTeacherNames } = deps;
  const fileSeenRow = new Map<string, number>(); // grade|name → 本表首次出现的行号
  const valid: ParsedClassRow[] = [];
  const failures: ClassImportFailure[] = [];

  rows.forEach(({ row, data: rawData }) => {
    const data = {
      name: (rawData.name ?? '').trim(),
      grade: (rawData.grade ?? '').trim(),
      counselors: (rawData.counselors ?? '').trim(),
      headTeachers: (rawData.headTeachers ?? '').trim(),
    };
    const reasons: string[] = [];

    if (!data.name) reasons.push('班级名称为必填项');
    else if (data.name.length > 30) reasons.push('班级名称不可超过 30 个字');

    if (!data.grade) reasons.push('年级为必填项');
    else if (gradeNames && !gradeNames.has(data.grade)) {
      reasons.push(`年级未匹配到年级字典（${data.grade}），请先在「年级管理」中创建`);
    }

    const key = `${data.grade}|${data.name}`;
    if (data.name && data.grade) {
      // 仅本表内重复判失败（两行数据可能不同，避免互相覆盖）；
      // 与系统已有班级重复交由服务端 upsert 处理（人员分配有变化则更新、完全相同跳过）
      if (fileSeenRow.has(key)) reasons.push(`班级与本表第 ${fileSeenRow.get(key)} 行重复`);
      fileSeenRow.set(key, row);
    }

    if (data.counselors && counselorNames) {
      const names = data.counselors.split(COUNSELOR_SEPARATORS).map((s) => s.trim()).filter(Boolean);
      for (const n of names) {
        if (!counselorNames.has(n)) reasons.push(`辅导员「${n}」未匹配到在职辅导员，请先在「教师名单」导入`);
      }
    }
    if (data.headTeachers && headTeacherNames) {
      const names = data.headTeachers.split(COUNSELOR_SEPARATORS).map((s) => s.trim()).filter(Boolean);
      for (const n of names) {
        if (!headTeacherNames.has(n)) reasons.push(`班主任「${n}」未匹配到在职班主任，请先在「教师名单」导入`);
      }
    }

    if (reasons.length > 0) {
      failures.push({ row, name: data.name || '—', grade: data.grade || '—', reason: reasons.join('；'), data });
    } else {
      valid.push({ row, data });
    }
  });

  return { valid, failures };
}

/** 导出失败明细（模板全部列 + 失败原因列），修正后可直接重新上传 */
export function exportClassImportFailures(failures: ClassImportFailure[]): void {
  const aoa: unknown[][] = [[...CLASS_HEADERS, '失败原因']];
  failures.forEach(({ data, name, grade, reason }) => {
    const d = data ?? { name, grade, counselors: '', headTeachers: '' };
    aoa.push([d.name ?? name, d.grade ?? grade, d.counselors ?? '', d.headTeachers ?? '', reason]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `班级导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

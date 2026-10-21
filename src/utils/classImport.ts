import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import type { ClassImportFailure, ParsedClassRow } from '@/types';

/**
 * 班级名单 Excel 批量导入工具（与 studentImport.ts 同一套 xlsx 模式）：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 逐行校验 → 失败明细导出。
 * 辅导员/班主任填「工号 + 姓名」两列（按顺序一一对应，多人用「、」分隔）：
 * 工号匹配在职用户账号由服务端裁决 —— 命中 → 正式绑定；未命中 → 记「待同步」（不判失败），
 * 可在「班级管理 → 同步用户管理」一键建号。
 * 班级已存在不再判失败：由服务端按 upsert 处理（人员配置有变化则更新，完全相同跳过）。
 */

/** 工号格式：3-20 位字母/数字/下划线（与服务端、用户管理建号规则一致） */
export const EMPLOYEE_NO_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 模板列，顺序与班级字段对应 */
export const CLASS_HEADERS = [
  '班级名称',
  '年级',
  '辅导员工号',
  '辅导员姓名',
  '班主任工号',
  '班主任姓名',
] as const;

const FIELD_GUIDE: [string, string, string][] = [
  ['班级名称', '必填', '不可超过 30 个字，如 计应2601；同年级下已存在的班级按更新处理（更新人员配置），不可与本表其他行重复'],
  ['年级', '必填', '必须已在「年级管理」中存在，如 2027级；不会自动创建新年级'],
  ['辅导员工号', '选填', '辅导员的工号（即登录账号），多人用「、」分隔，如 T2025001、T2025002；工号未匹配到用户账号时照常导入，该人员记为「待同步」'],
  ['辅导员姓名', '选填', '与工号列按顺序一一对应、数量一致；用于给未匹配工号创建账号时登记真实姓名'],
  ['班主任工号', '选填', '同辅导员工号规则；可留空表示暂不指定班主任'],
  ['班主任姓名', '选填', '与班主任工号列按顺序一一对应'],
];

const EXAMPLE_ROWS: (string | undefined)[][] = [
  ['计应2701', '2027级', 'T2025001、T2025002', '王小明、李小红', 'T2026001', '张老师'],
  ['电商2701', '2027级', '示例行：工号列与姓名列按顺序一一对应；工号未匹配时记待同步，可在「同步用户管理」建号；正式导入前请删除本表所有示例行', '', '', ''],
];

/** 生成班级名单导入模板工作簿（「班级名单」数据表 + 「填写说明」说明表） */
export function buildClassTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const dataWs = XLSX.utils.aoa_to_sheet([[...CLASS_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 24 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '班级名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「班级名单」工作表会被导入'],
    ['说明', '——', '导入为 upsert 方式：班级不存在则新建；已存在则更新人员配置，完全相同自动跳过'],
    ['说明', '——', '本通道以班级为准：文件中某班的辅导员/班主任集合即最终结果（覆盖该班原有配置）'],
  ]);
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

/** 下载班级名单导入模板 */
export function downloadClassTemplate(): void {
  XLSX.writeFile(buildClassTemplateWorkbook(), '班级名单导入模板.xlsx');
}

/** 解析班级名单 Excel：定位「班级名单」工作表，逐行取出 6 列字段 */
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
  const missing = [...CLASS_HEADERS].filter((colName) => indexOf(colName) < 0);
  if (missing.length > 0) {
    throw new Error('模板已更新：需包含「辅导员工号/辅导员姓名/班主任工号/班主任姓名」列，请下载最新模板填写');
  }

  const get = (row: unknown[], colName: string) =>
    String(row[indexOf(colName)] ?? '').trim();

  const rows: ParsedClassRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i] as unknown[];
    const name = get(row, '班级名称');
    const grade = get(row, '年级');
    const counselorNos = get(row, '辅导员工号');
    const counselorNames = get(row, '辅导员姓名');
    const headTeacherNos = get(row, '班主任工号');
    const headTeacherNames = get(row, '班主任姓名');
    // 整行空白跳过
    if (!name && !grade && !counselorNos && !counselorNames && !headTeacherNos && !headTeacherNames) continue;
    rows.push({
      row: i + 1,
      data: {
        name,
        grade,
        counselorNos,
        counselorNames,
        headTeacherNos: headTeacherNos || undefined,
        headTeacherNames: headTeacherNames || undefined,
      },
    });
  }
  return rows;
}

export interface ValidateClassDeps {
  /** 年级字典名称集合，缺省时跳过「年级匹配」预检 */
  gradeNames?: ReadonlySet<string>;
}

const STAFF_SEPARATORS = /[、,，/;；]/;

/** 拆分并校验单行的工号/姓名配对；返回错误信息或条目数组 */
function parseStaffPair(
  rawNos: string,
  rawNames: string,
  roleLabel: string,
  row: number,
  staffSeen: Map<string, string>,
  staffSeenRow: Map<string, number>,
): { entries?: { employeeNo: string; displayName: string }[]; error?: string } {
  const nos = rawNos.split(STAFF_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  const names = rawNames.split(STAFF_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  if (nos.length !== names.length) {
    return { error: `${roleLabel}工号与姓名数量不一致（${nos.length} 个工号 / ${names.length} 个姓名），请按顺序一一对应` };
  }
  const entries: { employeeNo: string; displayName: string }[] = [];
  for (let i = 0; i < nos.length; i += 1) {
    const employeeNo = nos[i];
    const displayName = names[i];
    if (!EMPLOYEE_NO_RE.test(employeeNo)) {
      return { error: `${roleLabel}工号「${employeeNo}」格式不合法，需为 3-20 位字母/数字/下划线` };
    }
    const known = staffSeen.get(employeeNo);
    if (known !== undefined) {
      if (known !== displayName) {
        return { error: `${roleLabel}工号「${employeeNo}」与本表第 ${staffSeenRow.get(employeeNo)} 行登记的姓名「${known}」不一致` };
      }
    } else {
      staffSeen.set(employeeNo, displayName);
      staffSeenRow.set(employeeNo, row);
    }
    if (!entries.some((e) => e.employeeNo === employeeNo)) entries.push({ employeeNo, displayName });
  }
  return { entries };
}

/** 逐行校验班级数据：必填项、年级字典、本表内重复、工号格式与工号-姓名配对一致性。
 *  注意：工号是否匹配在职账号由服务端裁决（未匹配记待同步），此处不做匹配预检。 */
export function validateClassRows(
  rows: ParsedClassRow[],
  deps: ValidateClassDeps = {},
): { valid: ParsedClassRow[]; failures: ClassImportFailure[] } {
  const { gradeNames } = deps;
  const fileSeenRow = new Map<string, number>(); // grade|name → 本表首次出现的行号
  const staffSeen = new Map<string, string>(); // employeeNo → 首次登记的姓名
  const staffSeenRow = new Map<string, number>(); // employeeNo → 首次出现的行号
  const valid: ParsedClassRow[] = [];
  const failures: ClassImportFailure[] = [];

  rows.forEach(({ row, data: rawData }) => {
    const data = {
      name: (rawData.name ?? '').trim(),
      grade: (rawData.grade ?? '').trim(),
      counselorNos: (rawData.counselorNos ?? '').trim(),
      counselorNames: (rawData.counselorNames ?? '').trim(),
      headTeacherNos: (rawData.headTeacherNos ?? '').trim(),
      headTeacherNames: (rawData.headTeacherNames ?? '').trim(),
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
      // 与系统已有班级重复交由服务端 upsert 处理（人员配置有变化则更新、完全相同跳过）
      if (fileSeenRow.has(key)) reasons.push(`班级与本表第 ${fileSeenRow.get(key)} 行重复`);
      fileSeenRow.set(key, row);
    }

    // 工号/姓名配对与跨行一致性（与角色无关，同工号在辅导员列与班主任列也必须同姓名）
    for (const [rawNos, rawNames, roleLabel] of [
      [data.counselorNos, data.counselorNames, '辅导员'],
      [data.headTeacherNos, data.headTeacherNames, '班主任'],
    ] as const) {
      if (!rawNos && !rawNames) continue;
      const parsed = parseStaffPair(rawNos, rawNames, roleLabel, row, staffSeen, staffSeenRow);
      if (parsed.error) reasons.push(parsed.error);
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
    const d = data ?? { name, grade, counselorNos: '', counselorNames: '', headTeacherNos: '', headTeacherNames: '' };
    aoa.push([
      d.name ?? name,
      d.grade ?? grade,
      d.counselorNos ?? '',
      d.counselorNames ?? '',
      d.headTeacherNos ?? '',
      d.headTeacherNames ?? '',
      reason,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 20 }, { wch: 24 }, { wch: 20 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `班级导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

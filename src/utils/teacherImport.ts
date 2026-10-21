import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import { TEACHER_HEADERS } from '@/types';
import type { ParsedTeacherRow, TeacherImportFailure } from '@/types';

/**
 * 教师名单 Excel 批量导入工具（与 classImport.ts / dormImport.ts 同一套 xlsx 模式）：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 逐行预检 → 失败明细导出。
 *
 * 教师数据唯一来源：本通道同时负责「账号建档 + 角色授予 + 带班绑定」，
 * 因此预检比学生/班级导入更严格（工号即登录账号，格式与唯一性要求最高）。
 * 服务端（/classes/teachers/import/*）会以同一套规则二次兜底。
 */

const FIELD_GUIDE: [string, string, string][] = [
  ['工号', '必填', '3-20 位字母/数字/下划线；即登录账号，也是初始密码后缀（Hzpt@工号）。同一文件内不可重复'],
  ['姓名', '必填', '教师真实姓名，不可超过 20 个字'],
  ['手机号', '选填', '11 位手机号；填写时须与账号一致才能更新，留空表示不更新'],
  ['人员类型', '必填', '只能填：辅导员、班主任（顿号分隔可双身份，如 辅导员、班主任）'],
  ['所辖班级', '必填', '多个班级用「、」分隔；跨年级同名须写「年级·班级」，如 2026级·计应2601'],
  ['在职状态', '选填', '只能填：在职、离职；留空默认为在职。填「离职」会停用账号并回收带班与角色'],
];

const EXAMPLE_ROWS: (string | undefined)[][] = [
  ['T2026001', '张三', '13800001111', '辅导员', '2026级·计应2601', '在职'],
  ['T2026002', '李四', '', '班主任', '计应2601、电商2601', ''],
  ['', '', '', '', '示例行：正式导入前请删除本表所有示例行', ''],
];

/** 生成教师导入模板工作簿（「教师名单」数据表 + 「填写说明」说明表） */
export function buildTeacherTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const dataWs = XLSX.utils.aoa_to_sheet([[...TEACHER_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 26 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '教师名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「教师名单」工作表会被导入'],
    ['说明', '——', '导入为 upsert：工号不存在则自动建号（初始密码 Hzpt@工号，首次登录须修改）；'],
    ['说明', '——', '工号已存在则绑定该账号，仅更新有变化的字段，完全相同自动跳过'],
    ['说明', '——', '带班为增量加入：不会清空该教师未被提及的其他班级；跨班清空请用单条维护或标记离职'],
  ]);
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

/** 下载教师导入模板 */
export function downloadTeacherTemplate(): void {
  XLSX.writeFile(buildTeacherTemplateWorkbook(), '教师名单导入模板.xlsx');
}

/** 工号规则（与服务端 EMPLOYEE_NO_RE 一致） */
export const EMPLOYEE_NO_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** 合法人员类型取值 */
export const ROLE_TYPE_LABELS = ['辅导员', '班主任'] as const;

/** 解析教师名单 Excel：定位「教师名单」工作表，逐行取出六个字段 */
export async function parseTeacherExcel(file: File): Promise<ParsedTeacherRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('教师名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  const missing = ['工号', '姓名', '人员类型', '所辖班级'].filter((c) => indexOf(c) < 0);
  if (missing.length > 0) throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);

  const get = (row: unknown[], colName: string) => String(row[indexOf(colName)] ?? '').trim();

  const rows: ParsedTeacherRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i] as unknown[];
    const employeeNo = get(row, '工号');
    const name = get(row, '姓名');
    const roleTypes = get(row, '人员类型');
    const classNames = get(row, '所辖班级');
    // 整行空白跳过
    if (!employeeNo && !name && !roleTypes && !classNames) continue;
    rows.push({
      row: i + 1,
      data: {
        employeeNo,
        name,
        mobile: get(row, '手机号'),
        roleTypes,
        classNames,
        status: get(row, '在职状态'),
      },
    });
  }
  return rows;
}

/**
 * 前端预检（与服务端 validateRows 同口径）：
 * 必填项、工号格式、手机号格式、人员类型取值、在职状态取值、本表内工号重复。
 * 字典类（班级是否存在、工号是否已建号、是否命中管理员）由服务端兜底。
 */
export function validateTeacherRows(
  rows: ParsedTeacherRow[],
): { valid: ParsedTeacherRow[]; failures: TeacherImportFailure[] } {
  const seenRow = new Map<string, number>(); // 工号 → 本表首次出现的行号
  const valid: ParsedTeacherRow[] = [];
  const failures: TeacherImportFailure[] = [];

  rows.forEach(({ row, data }) => {
    const employeeNo = data.employeeNo.trim();
    const name = data.name.trim();
    const reasons: { field: string; message: string }[] = [];

    if (!employeeNo) reasons.push({ field: '工号', message: '工号为必填项' });
    else if (!EMPLOYEE_NO_RE.test(employeeNo)) {
      reasons.push({ field: '工号', message: '工号需为 3-20 位字母/数字/下划线' });
    } else if (seenRow.has(employeeNo)) {
      reasons.push({ field: '工号', message: `工号与本表第 ${seenRow.get(employeeNo)} 行重复` });
    }
    if (employeeNo) seenRow.set(employeeNo, row);

    if (!name) reasons.push({ field: '姓名', message: '姓名为必填项' });
    else if (name.length > 20) reasons.push({ field: '姓名', message: '姓名不可超过 20 个字' });

    if (data.mobile.trim() && !/^1[3-9]\d{9}$/.test(data.mobile.trim())) {
      reasons.push({ field: '手机号', message: `手机号格式有误（${data.mobile.trim()}），应为 11 位手机号` });
    }

    if (!data.roleTypes.trim()) reasons.push({ field: '人员类型', message: '人员类型为必填项' });
    else {
      const tokens = data.roleTypes.split(/[、,，/;；]/).map((s) => s.trim()).filter(Boolean);
      const bad = tokens.filter((t) => !(ROLE_TYPE_LABELS as readonly string[]).includes(t));
      if (tokens.length === 0 || bad.length > 0) {
        reasons.push({
          field: '人员类型',
          message: `人员类型只能填：辅导员、班主任（当前值「${data.roleTypes.trim()}」）`,
        });
      }
    }

    if (!data.classNames.trim()) reasons.push({ field: '所辖班级', message: '所辖班级为必填项' });

    if (data.status.trim() && !['在职', '离职'].includes(data.status.trim())) {
      reasons.push({ field: '在职状态', message: '在职状态只能填：在职 或 离职' });
    }

    if (reasons.length > 0) {
      failures.push({
        row,
        field: reasons[0].field,
        employeeNo: employeeNo || '—',
        name: name || '—',
        reason: reasons.map((r) => r.message).join('；'),
        data,
      });
    } else {
      valid.push({ row, data });
    }
  });

  return { valid, failures };
}

/** 导出失败明细（模板全部列 + 字段 + 失败原因列），修正后可直接重新上传 */
export function exportTeacherImportFailures(failures: TeacherImportFailure[]): void {
  const aoa: unknown[][] = [[...TEACHER_HEADERS, '出错字段', '失败原因']];
  failures.forEach(({ data, employeeNo, name, field, reason }) => {
    const d = data ?? { employeeNo, name, mobile: '', roleTypes: '', classNames: '', status: '' };
    aoa.push([
      d.employeeNo ?? employeeNo, d.name ?? name, d.mobile ?? '', d.roleTypes ?? '',
      d.classNames ?? '', d.status ?? '', field, reason,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `教师导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

/** 导出结果（与导入模板同列）→ 下载 Excel，形成「导出 → 修改 → 回导」闭环 */
export function downloadTeacherExport(list: Record<string, string>[]): void {
  const aoa: unknown[][] = [[...TEACHER_HEADERS]];
  list.forEach((item) => aoa.push(TEACHER_HEADERS.map((h) => item[h] ?? '')));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 26 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '教师名单');
  XLSX.writeFile(wb, `教师名单-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

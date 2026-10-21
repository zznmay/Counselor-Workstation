import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import type { ClassOption, ParsedUserRow, RoleOption, UserImportFailure } from '@/types';
import { loadXLSX } from './xlsx';

/**
 * 用户账号 Excel 批量导入工具（与 studentImport/classImport 同一套 xlsx 模式）：
 * 模板生成（含字段说明与示例行）→ 解析 → 逐行校验 → 失败明细导出。
 * 校验规则与服务端 POST /users/import 保持一致；角色/班级/已有用户名等
 * 字典类校验由调用侧注入，缺省时跳过该项预检、交由服务端兜底。
 */

export const USER_HEADERS = ['用户名', '姓名', '角色', '所辖班级'] as const;

/** 批量导入初始密码规则：统一「Hzpt@」拼接用户名（首次登录强制修改），模板不再提供密码列 */
export const IMPORT_PASSWORD_PREFIX = 'Hzpt@';
/** 导入账号的初始密码：如 zhangsan → Hzpt@zhangsan（与服务端规则一致） */
export function importPasswordOf(username: string): string {
  return `${IMPORT_PASSWORD_PREFIX}${username}`;
}
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function fieldGuide(roleNames: string[]): [string, string, string][] {
  return [
    ['用户名', '必填', '3-20 位字母/数字/下划线，全局唯一，如 zhangsan'],
    ['姓名', '必填', '1-20 个字，如 张三'],
    ['角色', '必填', roleNames.length > 0
      ? `填写角色名称或标识，可选：${roleNames.join('、')}`
      : '系统中暂无可用角色，请先在「角色管理」中创建'],
    ['所辖班级', '选填', '仅非管理员角色可分配；多个班级用「、」分隔；同名班级写成「2024级·计应2401」'],
  ];
}

/** 生成用户导入模板（「用户名单」数据表 + 「填写说明」说明表） */
export async function buildUserTemplateWorkbook(roleNames: string[]): Promise<XLSX.WorkBook> {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const exampleRole = roleNames[0] ?? '辅导员';
  const dataWs = XLSX.utils.aoa_to_sheet([
    [...USER_HEADERS],
    ['zhangsan', '张三', exampleRole, ''],
    ['lisi', '李四', exampleRole, '示例行：班级可留空；正式导入前请删除本表所有示例行'],
  ]);
  dataWs['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '用户名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...fieldGuide(roleNames),
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「用户名单」工作表会被导入'],
    ['说明', '——', `账号将按「用户名」查重：已存在的用户名整行跳过；导入采用追加方式，不影响已有账号。初始密码由系统自动生成为「${IMPORT_PASSWORD_PREFIX}用户名」（如 zhangsan → ${importPasswordOf('zhangsan')}），首次登录须修改`],
  ]);
  guideWs['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

/** 下载用户导入模板（角色列表动态写入说明页） */
export async function downloadUserTemplate(roleNames: string[]): Promise<void> {
  const XLSX = await loadXLSX();
  XLSX.writeFile(await buildUserTemplateWorkbook(roleNames), '用户账号导入模板.xlsx');
}

/** 解析用户 Excel：定位「用户名单」工作表，逐行取 用户名/姓名/角色/所辖班级（多余列忽略，兼容旧版模板） */
export async function parseUserExcel(file: File): Promise<ParsedUserRow[]> {
  const XLSX = await loadXLSX();
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('用户名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  const missing = ['用户名', '姓名', '角色'].filter((colName) => indexOf(colName) < 0);
  if (missing.length > 0) throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);

  const get = (row: unknown[], colName: string) =>
    String(row[indexOf(colName)] ?? '').trim();

  const rows: ParsedUserRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i] as unknown[];
    const username = get(row, '用户名');
    const displayName = get(row, '姓名');
    const role = get(row, '角色');
    const classNames = get(row, '所辖班级');
    if (!username && !displayName && !role && !classNames) continue;
    rows.push({ row: i + 1, data: { username, displayName, role, classNames } });
  }
  return rows;
}

export interface ValidateUserDeps {
  /** 已有用户名集合，缺省时跳过「已存在」预检 */
  usernames?: ReadonlySet<string>;
  /** 当前可用角色，缺省时跳过我「角色存在」预检 */
  roles?: ReadonlyArray<RoleOption>;
  /** 班级字典，缺省时跳过「班级匹配」预检 */
  classes?: ReadonlyArray<ClassOption>;
}

const CLASS_SEPARATORS = /[、,，/;；]/;

/** 校验班级文本：返回问题描述列表（空数组表示全部可解析） */
function checkClassText(raw: string, classes: ReadonlyArray<ClassOption>): string[] {
  const issues: string[] = [];
  const byName = new Map<string, ClassOption[]>();
  for (const c of classes) {
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  for (const token of raw.split(CLASS_SEPARATORS).map((s) => s.trim()).filter(Boolean)) {
    const parts = token.split(/[·・]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) {
      const [gradeName, className] = parts;
      if (!classes.some((c) => c.gradeName === gradeName && c.name === className)) {
        issues.push(`班级未匹配到班级字典：${token}`);
      }
      continue;
    }
    const list = byName.get(token) ?? [];
    if (list.length === 0) issues.push(`班级未匹配到班级字典：${token}`);
    else if (list.length > 1) issues.push(`班级名在多个年级重复，请写成「年级·班级」：${token}`);
  }
  return issues;
}

/** 逐行校验用户数据：必填、格式、角色匹配、班级匹配、系统内与本表内用户名重复 */
export function validateUserRows(
  rows: ParsedUserRow[],
  deps: ValidateUserDeps = {},
): { valid: ParsedUserRow[]; failures: UserImportFailure[] } {
  const { usernames, roles, classes } = deps;
  const seenRow = new Map<string, number>();
  const valid: ParsedUserRow[] = [];
  const failures: UserImportFailure[] = [];

  rows.forEach(({ row, data: raw }) => {
    const data = {
      username: (raw.username ?? '').trim(),
      displayName: (raw.displayName ?? '').trim(),
      role: (raw.role ?? '').trim(),
      classNames: (raw.classNames ?? '').trim(),
    };
    const reasons: string[] = [];

    if (!data.username) reasons.push('用户名为必填项');
    else if (!USERNAME_RE.test(data.username)) reasons.push('用户名需为 3-20 位字母/数字/下划线');
    else if (usernames?.has(data.username)) reasons.push('用户名已存在于系统中');
    else if (seenRow.has(data.username)) reasons.push(`用户名与本表第 ${seenRow.get(data.username)} 行重复`);
    if (data.username) seenRow.set(data.username, row);

    if (!data.displayName) reasons.push('姓名为必填项');
    else if (data.displayName.length > 20) reasons.push('姓名不可超过 20 个字');

    if (!data.role) reasons.push('角色为必填项');
    else if (roles && roles.length > 0 && !roles.some((r) => r.key === data.role || r.name === data.role)) {
      reasons.push(`角色「${data.role}」不存在`);
    }

    if (data.classNames && classes && classes.length > 0) {
      reasons.push(...checkClassText(data.classNames, classes));
    }

    if (reasons.length > 0) {
      failures.push({
        row,
        username: data.username || '—',
        displayName: data.displayName || '—',
        reason: [...new Set(reasons)].join('；'),
        data,
      });
    } else {
      valid.push({ row, data });
    }
  });

  return { valid, failures };
}

/** 导出失败明细（模板全部列 + 失败原因列），修正后可直接重新上传 */
export async function exportUserImportFailures(failures: UserImportFailure[]): Promise<void> {
  const XLSX = await loadXLSX();
  const aoa: unknown[][] = [[...USER_HEADERS, '失败原因']];
  failures.forEach(({ data, username, displayName, reason }) => {
    const d = data ?? { username, displayName, role: '', classNames: '' };
    aoa.push([d.username, d.displayName, d.role, d.classNames ?? '', reason]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 36 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `用户导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

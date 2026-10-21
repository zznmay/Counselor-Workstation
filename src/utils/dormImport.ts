import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import { MAX_BUILDING, MAX_ROOM } from './dormitory';
import { loadXLSX } from './xlsx';
import type { DormImportFailure, ParsedDormRow } from '@/types';

/**
 * 寝室分配 Excel 批量导入工具（与 classImport.ts 同一套 xlsx 模式）：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 逐行校验 → 失败明细导出。
 * 校验规则与服务端 POST /dormitories/import 保持一致：必填项、长度、本表内学号重复、
 * 性别取值；「学号是否存在于名册 / 身份字段与名册是否一致」由服务端兜底（数据量大且随时变化）。
 */

/** 模板列，顺序与寝室字段对应 */
export const DORM_HEADERS = ['学号', '姓名', '班级', '年级', '性别', '宿舍楼', '房间号'] as const;

const FIELD_GUIDE: [string, string, string][] = [
  ['学号', '必填', '必须已存在于「学生名册」，寝室数据按学号挂载到学生；同一文件内不可重复'],
  ['姓名', '选填', '填写时须与学生名册一致，不一致判失败（用于拦截学号填错）'],
  ['班级', '选填', '填写时须与学生名册一致，不一致判失败'],
  ['年级', '选填', '填写时须与学生名册一致，不一致判失败'],
  ['性别', '选填', '男 / 女；填写时须与学生名册一致，不一致判失败'],
  ['宿舍楼', '必填', `不可超过 ${MAX_BUILDING} 个字，如 荷园B`],
  ['房间号', '必填', `不可超过 ${MAX_ROOM} 个字，如 512；与宿舍楼拼接后显示为学生名册的「宿舍」`],
];

const EXAMPLE_ROWS: (string | undefined)[][] = [
  ['2026010101', '谢明轩', '计应2601', '2026级', '男', '荷园B', '512'],
  ['2026010102', '', '', '', '', '荷园B', '512'],
  ['', '', '', '', '', '示例行：姓名/班级/年级/性别 可留空，正式导入前请删除本表所有示例行', ''],
];

/** 生成寝室导入模板工作簿（「寝室名单」数据表 + 「填写说明」说明表） */
export async function buildDormTemplateWorkbook(): Promise<XLSX.WorkBook> {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const dataWs = XLSX.utils.aoa_to_sheet([[...DORM_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '寝室名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「寝室名单」工作表会被导入'],
    ['说明', '——', '导入为 upsert 方式：学号无寝室记录则新增；已有记录则更新，完全相同自动跳过'],
  ]);
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

/** 下载寝室导入模板 */
export async function downloadDormTemplate(): Promise<void> {
  const XLSX = await loadXLSX();
  XLSX.writeFile(await buildDormTemplateWorkbook(), '寝室名单导入模板.xlsx');
}

/** 解析寝室 Excel：定位「寝室名单」工作表，逐行取出七个字段 */
export async function parseDormExcel(file: File): Promise<ParsedDormRow[]> {
  const XLSX = await loadXLSX();
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('寝室名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  const missing = ['学号', '宿舍楼', '房间号'].filter((colName) => indexOf(colName) < 0);
  if (missing.length > 0) throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);

  const get = (row: unknown[], colName: string) => String(row[indexOf(colName)] ?? '').trim();

  const rows: ParsedDormRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i] as unknown[];
    const studentNo = get(row, '学号');
    const building = get(row, '宿舍楼');
    const room = get(row, '房间号');
    const name = get(row, '姓名');
    const className = get(row, '班级');
    const grade = get(row, '年级');
    const gender = get(row, '性别');
    // 整行空白跳过
    if (!studentNo && !building && !room && !name && !className && !grade && !gender) continue;
    rows.push({ row: i + 1, data: { studentNo, name, className, grade, gender, building, room } });
  }
  return rows;
}

/** 逐行校验寝室数据：必填项、长度、本表内学号重复、性别取值 */
export function validateDormRows(
  rows: ParsedDormRow[],
): { valid: ParsedDormRow[]; failures: DormImportFailure[] } {
  const fileSeenRow = new Map<string, number>(); // studentNo → 本表首次出现的行号
  const valid: ParsedDormRow[] = [];
  const failures: DormImportFailure[] = [];

  rows.forEach(({ row, data: rawData }) => {
    const data = {
      studentNo: (rawData.studentNo ?? '').trim(),
      name: (rawData.name ?? '').trim(),
      className: (rawData.className ?? '').trim(),
      grade: (rawData.grade ?? '').trim(),
      gender: (rawData.gender ?? '').trim(),
      building: (rawData.building ?? '').trim(),
      room: (rawData.room ?? '').trim(),
    };
    const reasons: string[] = [];

    if (!data.studentNo) reasons.push('学号为必填项');
    if (!data.building) reasons.push('宿舍楼为必填项');
    else if (data.building.length > MAX_BUILDING) reasons.push(`宿舍楼不可超过 ${MAX_BUILDING} 个字`);
    if (!data.room) reasons.push('房间号为必填项');
    else if (data.room.length > MAX_ROOM) reasons.push(`房间号不可超过 ${MAX_ROOM} 个字`);
    if (data.gender && data.gender !== '男' && data.gender !== '女') {
      reasons.push(`性别取值有误（${data.gender}），应为 男 或 女`);
    }

    // 本表内学号重复判失败（两行可能不同，避免互相覆盖）；
    // 与系统已有记录重复交由服务端 upsert 处理（有变化则更新，完全相同跳过）
    if (data.studentNo) {
      if (fileSeenRow.has(data.studentNo)) {
        reasons.push(`学号与本表第 ${fileSeenRow.get(data.studentNo)} 行重复`);
      }
      fileSeenRow.set(data.studentNo, row);
    }

    if (reasons.length > 0) {
      failures.push({
        row,
        studentNo: data.studentNo || '—',
        name: data.name || '—',
        building: data.building || '—',
        room: data.room || '—',
        reason: reasons.join('；'),
        data,
      });
    } else {
      valid.push({ row, data });
    }
  });

  return { valid, failures };
}

/** 导出失败明细（模板全部列 + 失败原因列），修正后可直接重新上传 */
export async function exportDormImportFailures(failures: DormImportFailure[]): Promise<void> {
  const XLSX = await loadXLSX();
  const aoa: unknown[][] = [[...DORM_HEADERS, '失败原因']];
  failures.forEach(({ data, studentNo, name, building, room, reason }) => {
    const d = data ?? { studentNo, name, className: '', grade: '', gender: '', building, room };
    aoa.push([d.studentNo ?? studentNo, d.name ?? name, d.className ?? '', d.grade ?? '',
      d.gender ?? '', d.building ?? building, d.room ?? room, reason]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `寝室导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

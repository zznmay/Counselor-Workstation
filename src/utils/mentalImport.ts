import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import { ATTENTION_LEVELS } from '@/constants/mental';
import type { AttentionLevel, MentalImportRow, MentalImportSkip } from '@/types';

/**
 * 心理关注学生名单批量导入工具：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 跳过明细导出。
 * 名册校验只能由服务端完成（浏览器没有名册数据），因此解析后先调 dryRun 预览。
 */

/** 模板列，顺序与解析逻辑对应 */
export const MENTAL_IMPORT_HEADERS = ['学号', '姓名', '关注等级', '关注备注'] as const;

/** 等级留空时的默认值（与服务端 IMPORT_DEFAULT_LEVEL 一致） */
export const MENTAL_IMPORT_DEFAULT_LEVEL: AttentionLevel = '一般关注';

const FIELD_GUIDE: [string, string, string][] = [
  ['学号', '二选一', '优先按学号核对名册，如 2026010101；与姓名同时填写时必须对应同一名学生'],
  ['姓名', '二选一', '未填学号时按姓名精确匹配名册；名册存在同名学生会跳过，请补填学号'],
  [
    '关注等级',
    '选填',
    `只能填：${ATTENTION_LEVELS.join('、')}；留空默认为「${MENTAL_IMPORT_DEFAULT_LEVEL}」`,
  ],
  ['关注备注', '选填', '记录关注事由与跟进安排，不超过 200 字；已有记录留空时保留原备注'],
];

const EXAMPLE_ROWS: string[][] = [
  ['2026010199', '张三丰', '重点关注', '示例行：近期情绪波动较大，每周谈话跟进'],
  ['', '李四喜', '一般关注', '示例行：演示仅填姓名，系统按姓名核对名册'],
  ['2026010200', '王五', '', '示例行：等级留空默认一般关注；正式导入前请删除全部示例行'],
];

/** 生成导入模板工作簿：「关注学生名单」数据表 + 「填写说明」说明表 */
export function buildMentalImportTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const dataWs = XLSX.utils.aoa_to_sheet([[...MENTAL_IMPORT_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, dataWs, '关注学生名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行列标题、不要增删列；导入只读取「关注学生名单」工作表'],
    ['说明', '——', '系统逐条核对学生名册：名册中已有的学生写入关注标记，已有关注记录则按本表等级更新'],
    ['说明', '——', '不在名册中的学生暂不导入，结果中提示「学生未在学生名册中，确认学生是否在读」'],
    ['说明', '——', '同一学生在本表出现多行时只处理首行，其余行按重复跳过'],
    ['说明', '——', '导入为追加/更新方式，不会删除任何现有学生或关注标记'],
  ]);
  guideWs['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');

  return wb;
}

/** 浏览器端触发下载导入模板 */
export function downloadMentalImportTemplate(): void {
  XLSX.writeFile(buildMentalImportTemplateWorkbook(), '心理关注学生导入模板.xlsx');
}

/** 解析上传的关注名单 Excel（自动定位「关注学生名单」工作表，按列标题取值，跳过空行） */
export async function parseMentalImportExcel(file: File): Promise<MentalImportRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('关注')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  if (indexOf('学号') < 0 && indexOf('姓名') < 0) {
    throw new Error('缺少必需的列：学号 或 姓名，请使用标准模板填写');
  }

  const rows: MentalImportRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const arr = aoa[i] as unknown[];
    const get = (colName: string) => {
      const k = indexOf(colName);
      return k < 0 ? '' : String(arr[k] ?? '').trim();
    };
    const studentNo = get('学号');
    const name = get('姓名');
    if (!studentNo && !name) continue; // 整行空白，跳过

    rows.push({
      row: i + 1,
      studentNo,
      name,
      level: get('关注等级'),
      note: get('关注备注') || undefined,
    });
  }
  if (rows.length === 0) throw new Error('没有解析到学号或姓名，请检查文件内容');
  return rows;
}

/** 导出跳过明细（行号 + 学号 + 姓名 + 原因），修正后可直接重新上传 */
export function exportMentalImportSkips(skipped: MentalImportSkip[]): void {
  const aoa: unknown[][] = [
    ['Excel 行号', '学号', '姓名', '跳过原因'],
    ...skipped.map((s) => [s.row, s.studentNo, s.name, s.reason]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 62 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '跳过明细');
  XLSX.writeFile(wb, `心理关注导入跳过明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

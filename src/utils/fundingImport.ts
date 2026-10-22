/** 困难生认定 Excel 导入：模板、解析、逐行校验与失败明细 */
import dayjs from 'dayjs';
import type * as XLSX from 'xlsx';

import { FUNDING_DIFFICULTY_TYPES, FUNDING_LEVELS } from '@/constants';
import type {
  FundingDifficultyType,
  FundingImportFailure,
  FundingImportRow,
  FundingLevel,
} from '@/types';

import { academicYearRange, currentAcademicYear } from './funding';
import { loadXLSX } from './xlsx';

export const FUNDING_TEMPLATE_HEADERS = [
  '学号',
  '认定学年',
  '困难等级',
  '困难类型',
  '认定日期',
  '有效期起',
  '有效期止',
  '认定依据',
  '备注',
] as const;

const HEADER_GUIDE: [string, string, string][] = [
  ['学号', '必填', '必须存在于学生名册，且在当前教师所带班级范围内；姓名与班级由系统按学号自动带出'],
  ['认定学年', '必填', '格式 YYYY-YYYY，如 2026-2027；同一学生同一学年只能有一条有效认定'],
  ['困难等级', '必填', `只能填：${FUNDING_LEVELS.join('、')}`],
  ['困难类型', '选填', `可多选，用顿号分隔：${FUNDING_DIFFICULTY_TYPES.join('、')}`],
  ['认定日期', '选填', '支持 2026-10、2026/10、2026.10、2026年10月、2026年十月份、202610 等写法；留空默认为导入当月'],
  ['有效期起', '选填', '支持多种月份写法（同认定日期）；留空默认为学年开始月份（9 月）'],
  ['有效期止', '选填', '支持多种月份写法（同认定日期）；留空默认为学年结束月份（次年 8 月）'],
  ['认定依据', '选填', '文字说明，如低保、突发变故等'],
  ['备注', '选填', '其它需要说明的情况'],
];

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\u3000/g, ' ')
    .trim();
}

const CN_DIGITS: Record<string, string> = {
  '〇': '0', '○': '0', '零': '0', '一': '1', '二': '2', '两': '2',
  '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
};

function cnNumber(text: string): number | null {
  if (!text) return null;
  if (text === '十') return 10;
  if (text.startsWith('十')) {
    const rest = CN_DIGITS[text[1]];
    return rest === undefined ? null : 10 + Number(rest);
  }
  const digits = text.split('').map((c) => CN_DIGITS[c]);
  return digits.every((d) => d !== undefined) ? Number(digits.join('')) : null;
}

/**
 * 宽松解析月份：兼容 2026-10、2026/10、2026.10、2026年10月、2026年十月份、
 * 二〇二六年十月、202610、2026-10-01、10/2026 等写法。
 */
function parseMonthText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dayjs(value).format('YYYY-MM');
  }
  let raw = cleanText(value);
  if (!raw) return '';
  raw = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, '/')
    .replace(/[－—–]/g, '-')
    .replace(/[．]/g, '.')
    .replace(/\s+/g, '');
  raw = raw.replace(/([〇○零一二三四五六七八九]{2,4})年/g, (_, year: string) => (
    year.split('').map((c) => CN_DIGITS[c]).join('') + '年'
  ));
  raw = raw.replace(/([一二三四五六七八九十]{1,3})月/g, (_, monthText: string) => {
    const month = cnNumber(monthText);
    return month === null ? `${monthText}月` : `${month}月`;
  });

  const apply = (yearText: string, monthText: string): string => {
    let year = Number(yearText);
    if (yearText.length === 2) year += 2000;
    const month = Number(monthText);
    return year >= 1900 && year <= 2100 && month >= 1 && month <= 12
      ? `${year}-${String(month).padStart(2, '0')}`
      : '';
  };

  // 月在前：10/2026（必须放在年前面之前，避免被 10/20 误匹配）
  let match = raw.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (match) return apply(match[2], match[1]);

  match = raw.match(/^(\d{2,4})(?:[-/.]|年)(\d{1,2})(?:月)?/);
  if (match) return apply(match[1], match[2]);

  match = raw.match(/^(\d{4})(\d{2})$/);
  if (match) return apply(match[1], match[2]);

  if (/^\d{4}$/.test(raw)) return '';
  const parsed = dayjs(raw);
  return parsed.isValid() ? parsed.format('YYYY-MM') : '';
}

/** Excel 日期/文本统一转为 YYYY-MM；无法识别时保留原值，交给校验提示 */
export function normalizeMonthCell(value: unknown): string {
  return parseMonthText(value) || cleanText(value);
}

function normalizeAcademicYear(value: unknown): string {
  return cleanText(value).replace(/学年$/, '').trim();
}

function splitTypes(value: unknown): FundingDifficultyType[] {
  const raw = cleanText(value);
  if (!raw) return [];
  return [...new Set(raw.split(/[、,，;；/]/).map((v) => v.trim()).filter(Boolean))] as FundingDifficultyType[];
}

/** 生成导入模板：「认定名单」数据表 + 「填写说明」说明表 */
export async function buildFundingTemplateWorkbook(): Promise<XLSX.WorkBook> {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const year = currentAcademicYear();
  const range = academicYearRange(year);
  const dataWs = XLSX.utils.aoa_to_sheet([
    [...FUNDING_TEMPLATE_HEADERS],
    [
      '2026999901', year, '困难', '低保家庭、突发严重困难',
      range.validFrom, range.validFrom, range.validTo,
      '示例行：正式导入前请删除本行', '农村低保家庭，父亲因病丧失劳动能力',
    ],
    [
      '2026999902', year, '特别困难', '孤儿',
      range.validFrom, range.validFrom, range.validTo,
      '示例行：选填列可留空', '',
    ],
  ]);
  dataWs['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, dataWs, '认定名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...HEADER_GUIDE,
    ['说明', '——', '请勿修改第一行列标题；仅「认定名单」工作表会被导入'],
    ['说明', '——', '同一学生同一学年已有有效认定时，导入将更新该记录；已取消记录会重新建立认定'],
    ['说明', '——', '本表内学号重复的行将被判为失败；失败明细可导出修正后重新上传'],
  ]);
  guideWs['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');
  return wb;
}

export async function downloadFundingTemplate(): Promise<void> {
  const XLSX = await loadXLSX();
  XLSX.writeFile(await buildFundingTemplateWorkbook(), '困难生认定导入模板.xlsx');
}

/** 解析上传文件，返回带 Excel 行号的原始行（校验由 validateFundingRows 统一完成） */
export async function parseFundingExcel(file: File): Promise<FundingImportRow[]> {
  const XLSX = await loadXLSX();
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('认定名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => cleanText(h));
  const indexOf = (name: string) => header.indexOf(name);
  const missing = FUNDING_TEMPLATE_HEADERS.filter(
    (name) => ['学号', '认定学年', '困难等级'].includes(name) && indexOf(name) < 0,
  );
  if (missing.length > 0) {
    throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);
  }

  const rows: FundingImportRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const arr = aoa[i] as unknown[];
    const get = (name: string) => {
      const index = indexOf(name);
      return index < 0 ? '' : arr[index];
    };
    const studentNo = cleanText(get('学号'));
    const name = cleanText(get('姓名'));
    if (!studentNo && !name) continue;
    rows.push({
      row: i + 1,
      studentNo,
      name,
      academicYear: normalizeAcademicYear(get('认定学年')),
      level: cleanText(get('困难等级')) as FundingLevel,
      difficultyTypes: splitTypes(get('困难类型')),
      identifiedAt: normalizeMonthCell(get('认定日期')) || undefined,
      validFrom: normalizeMonthCell(get('有效期起')) || undefined,
      validTo: normalizeMonthCell(get('有效期止')) || undefined,
      basis: cleanText(get('认定依据')) || undefined,
      remark: cleanText(get('备注')) || undefined,
    });
  }
  return rows;
}

function isAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

function isMonth(value?: string): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** 逐行校验：与后端规则一致；返回可提交行与失败明细 */
export function validateFundingRows(rows: FundingImportRow[]): {
  valid: FundingImportRow[];
  failures: FundingImportFailure[];
} {
  const seen = new Map<string, number>();
  const valid: FundingImportRow[] = [];
  const failures: FundingImportFailure[] = [];

  rows.forEach((row) => {
    const reasons: string[] = [];
    const studentNo = row.studentNo.trim();
    if (!studentNo) {
      reasons.push('学号为必填项');
    } else if (seen.has(studentNo)) {
      reasons.push(`学号与本表第 ${seen.get(studentNo)} 行重复`);
    }
    if (studentNo) seen.set(studentNo, row.row);

    if (!isAcademicYear(row.academicYear)) reasons.push('认定学年格式应为 YYYY-YYYY，如 2026-2027');
    if (!FUNDING_LEVELS.includes(row.level)) reasons.push(`困难等级只能填：${FUNDING_LEVELS.join('、')}`);
    const unknownTypes = (row.difficultyTypes ?? []).filter((t) => !FUNDING_DIFFICULTY_TYPES.includes(t));
    if (unknownTypes.length > 0) reasons.push(`困难类型不在可选范围：${unknownTypes.join('、')}`);

    if (!isMonth(row.identifiedAt)) reasons.push('认定日期格式应为 YYYY-MM');
    if (!isMonth(row.validFrom)) reasons.push('有效期起格式应为 YYYY-MM');
    if (!isMonth(row.validTo)) reasons.push('有效期止格式应为 YYYY-MM');
    if (row.validFrom && row.validTo && row.validFrom > row.validTo) {
      reasons.push('有效期止不能早于有效期起');
    }

    if (reasons.length > 0) {
      failures.push({
        row: row.row,
        studentNo,
        name: row.name ?? '',
        reason: reasons.join('；'),
      });
    } else {
      valid.push({ ...row, studentNo });
    }
  });

  return { valid, failures };
}

export async function exportFundingImportFailures(failures: FundingImportFailure[]): Promise<void> {
  const XLSX = await loadXLSX();
  const rows = failures.map((f) => [f.row, f.studentNo, f.name, f.reason]);
  const ws = XLSX.utils.aoa_to_sheet([['行号', '学号', '姓名', '失败原因'], ...rows]);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `困难生认定导入失败明细_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`);
}

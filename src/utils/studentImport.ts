import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import { GENDERS, STUDENT_STATUSES } from '@/constants';
import type { ParsedStudentRow, Student, StudentImportFailure } from '@/types';

import {
  cleanImportText,
  describeDateError,
  describePhoneError,
  formatPhoneNumber,
  normalizeDateInput,
  normalizePhoneInput,
  SUPPORTED_DATE_FORMATS,
} from './importNormalize';

/**
 * 学生名单 Excel 批量导入工具：
 * 模板生成（含填写说明与示例行）→ 文件解析 → 逐行校验 → 失败明细导出。
 * 校验规则与 api.importStudents 共用，浏览器端预览与导入端二次校验保持一致。
 *
 * 单元格清洗与日期/电话规范化统一由 importNormalize.ts 提供（解析与校验共用同一套逻辑）。
 */

/** 模板列，顺序与 Student 字段对应 */
export const TEMPLATE_HEADERS = [
  '学号',
  '姓名',
  '性别',
  '年级',
  '专业',
  '班级',
  '手机号',
  '宿舍',
  '政治面貌',
  '生源地',
  '学籍状态',
  '班内职务',
  '备注',
  '入学时间',
  '班主任',
  '辅导员',
  '父亲姓名',
  '父亲电话',
  '母亲姓名',
  '母亲电话',
] as const;

const FIELD_GUIDE: [string, string, string][] = [
  ['学号', '必填', '全校唯一，不可与系统内已有学生或本表其他行重复，如 2026010101'],
  ['姓名', '必填', '学生真实姓名'],
  ['性别', '必填', '只能填：男 或 女'],
  ['年级', '必填', '格式为「YYYY级」，如 2026级'],
  ['专业', '选填', '如 计算机应用技术；不做取值校验，可留空或填写任意专业名称'],
  ['班级', '必填', '如 计应2601'],
  ['手机号', '必填', '11位手机号（以1开头）或带区号的座机号；允许空格、连字符等分隔写法，如 183 1485 0022、183-1485-0022、0571-88886666'],
  ['宿舍', '选填', '如 学生公寓5-602'],
  ['政治面貌', '选填', '如 共青团员、中共预备党员、群众'],
  ['生源地', '选填', '如 浙江杭州'],
  ['学籍状态', '选填', '只能填：在读、休学、退学；留空默认为「在读」'],
  ['班内职务', '选填', '如 班长、学习委员'],
  ['备注', '选填', '家庭情况、重点关注事项等'],
  ['入学时间', '必填', `多种写法均可，导入时统一转换为 YYYY-MM-DD：${SUPPORTED_DATE_FORMATS.join('；')}；也可直接使用 Excel 日期单元格`],
  ['班主任', '选填', '学生所在班级的班主任姓名'],
  ['辅导员', '选填', '留空默认为当前辅导员（王老师）'],
  ['父亲姓名', '选填', '父亲姓名'],
  ['父亲电话', '选填', '11位手机号（以1开头）或带区号的座机号，允许空格/连字符分隔'],
  ['母亲姓名', '选填', '母亲姓名'],
  ['母亲电话', '选填', '11位手机号（以1开头）或带区号的座机号，允许空格/连字符分隔'],
];

const EXAMPLE_ROWS: (string | undefined)[][] = [
  [
    '2026010199',
    '张三丰',
    '男',
    '2026级',
    '计算机应用技术',
    '计应2601',
    '13800001111',
    '学生公寓5-603',
    '共青团员',
    '浙江杭州',
    '在读',
    '学习委员',
    '示例行：正式导入前请删除本表所有示例行',
    '2026-09-01',
    '罗海燕',
    '王老师',
    '张大山',
    '13800001001',
    '李秀芳',
    '13900001002',
  ],
  [
    '2026010200',
    '李四喜',
    '女',
    '2026级',
    '',
    '电商2601',
    '13900002222',
    '',
    '群众',
    '浙江宁波',
    '',
    '',
    '示例行：选填列可留空，学籍状态留空默认为在读',
    '2026-09-01',
    '唐志强',
    '',
    '',
    '',
    '',
    '',
  ],
];

/** 生成导入模板工作簿：「学生名单」数据表 + 「填写说明」说明表 */
export function buildStudentTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const dataWs = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS], ...EXAMPLE_ROWS]);
  dataWs['!cols'] = [
    { wch: 13 },
    { wch: 10 },
    { wch: 6 },
    { wch: 9 },
    { wch: 18 },
    { wch: 11 },
    { wch: 13 },
    { wch: 15 },
    { wch: 13 },
    { wch: 11 },
    { wch: 9 },
    { wch: 11 },
    { wch: 40 },
    { wch: 13 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 13 },
    { wch: 10 },
    { wch: 13 },
  ];
  XLSX.utils.book_append_sheet(wb, dataWs, '学生名单');

  const guideWs = XLSX.utils.aoa_to_sheet([
    ['列名', '是否必填', '填写说明'],
    ...FIELD_GUIDE,
    ['说明', '——', '请勿修改第一行的列标题，也不要增删列；仅「学生名单」工作表会被导入'],
    ['说明', '——', '导入为追加方式：只新增通过校验的行，不会覆盖或删除系统内已有学生'],
    ['说明', '——', '学号与系统内已有学生重复、或本表内重复的行将被判为失败；失败明细可导出修正后重新上传'],
  ]);
  guideWs['!cols'] = [{ wch: 11 }, { wch: 9 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideWs, '填写说明');

  return wb;
}

/** 浏览器端触发下载学生名单导入模板 */
export function downloadStudentTemplate(): void {
  XLSX.writeFile(buildStudentTemplateWorkbook(), '学生名单导入模板.xlsx');
}

/** 解析上传的学生名单 Excel（自动定位「学生名单」工作表，按列标题取值，跳过空行） */
export async function parseStudentExcel(file: File): Promise<ParsedStudentRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => n.includes('学生名单')) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const ws = wb.Sheets[sheetName];

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  if (aoa.length < 2) throw new Error('没有解析到数据行，请检查文件内容');

  const header = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim());
  const indexOf = (colName: string) => header.indexOf(colName);
  const missing = ['学号', '姓名'].filter((colName) => indexOf(colName) < 0);
  if (missing.length > 0) {
    throw new Error(`缺少必需的列：${missing.join('、')}，请使用标准模板填写`);
  }

  const rows: ParsedStudentRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const arr = aoa[i] as unknown[];
    // 所有单元格走统一清洗：全角数字转半角、去零宽字符、空白折叠、去首尾空白
    const get = (colName: string) => {
      const k = indexOf(colName);
      return k < 0 ? '' : cleanImportText(arr[k]);
    };
    const studentNo = get('学号');
    const name = get('姓名');
    if (!studentNo && !name) continue; // 整行空白，跳过

    const statusRaw = get('学籍状态') as Student['status'];
    rows.push({
      row: i + 1,
      data: {
        studentNo,
        name,
        gender: get('性别') as Student['gender'],
        grade: get('年级'),
        major: get('专业'),
        className: get('班级'),
        phone: get('手机号'),
        dorm: get('宿舍') || undefined,
        politicalStatus: get('政治面貌') || undefined,
        origin: get('生源地') || undefined,
        status: (STUDENT_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : '在读',
        position: get('班内职务') || undefined,
        remark: get('备注') || undefined,
        // 原样保留（仅清洗空白），日期与号码的规范化统一放到 validateStudentRows，
        // 这样校验失败时仍能回显用户实际填写的原始值
        enrollDate: get('入学时间'),
        headTeacher: get('班主任') || undefined,
        counselor: get('辅导员') || undefined,
        fatherName: get('父亲姓名') || undefined,
        fatherPhone: get('父亲电话') || undefined,
        motherName: get('母亲姓名') || undefined,
        motherPhone: get('母亲电话') || undefined,
      },
    });
  }
  return rows;
}

/**
 * 逐行校验学生数据：
 * 必填项、格式（性别/年级/手机号/日期/学籍状态）、学号在系统与本表内的重复、
 * 班级名与班级管理字典的匹配（classKeys 缺省时跳过该项，由服务端兜底）。
 * 「专业」为自由文本列，不参与校验（列可缺省、可留空，也不限制取值范围）。
 *
 * 手机号/家长电话：先清洗空格（含全角空格、制表符）、连字符、括号等分隔字符，再按
 * 手机号（1 开头 11 位）或座机号（0 开头 10-12 位）规则判定，通过后以纯数字形式入库。
 * 入学时间：识别 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、YYYYMMDD、YYYY年M月D日、
 * 带时分秒的 ISO 日期时间等写法，统一规范化为 YYYY-MM-DD 后入库。
 * 两者失败时均在提示中回显原始输入值（见 importNormalize.describe*Error）。
 *
 * @param classKeys 班级字典键集合（`${grade}|${className}`），调用侧由 GET /classes/options 构建
 */
export function validateStudentRows(
  rows: ParsedStudentRow[],
  existingNos: Iterable<string>,
  classKeys?: ReadonlySet<string>,
): { valid: ParsedStudentRow[]; failures: StudentImportFailure[] } {
  const existingSet = new Set(existingNos);
  const fileSeenRow = new Map<string, number>(); // 学号 → 本表首次出现的行号
  const valid: ParsedStudentRow[] = [];
  const failures: StudentImportFailure[] = [];

  rows.forEach(({ row, data: rawData }) => {
    // 先做规范化：日期/电话走 importNormalize 统一清洗（空格、全角空格、连字符、多种日期写法），
    // 学籍状态留空默认「在读」、辅导员留空默认当前辅导员；再逐项校验
    const phone = normalizePhoneInput(rawData.phone);
    const fatherPhone = normalizePhoneInput(rawData.fatherPhone);
    const motherPhone = normalizePhoneInput(rawData.motherPhone);
    const enrollDate = normalizeDateInput(rawData.enrollDate);

    const data = {
      ...rawData,
      status: (rawData.status || '在读') as Student['status'],
      counselor: rawData.counselor || '王老师',
      // 规范化成功则入库标准化值；失败则原样保留，便于失败明细导出后对照修正
      phone: phone.ok ? formatPhoneNumber(phone) : rawData.phone,
      fatherPhone: fatherPhone.ok ? formatPhoneNumber(fatherPhone) : rawData.fatherPhone,
      motherPhone: motherPhone.ok ? formatPhoneNumber(motherPhone) : rawData.motherPhone,
      enrollDate: enrollDate.ok ? enrollDate.value : rawData.enrollDate,
    };
    const reasons: string[] = [];
    const { studentNo, name } = data;

    if (!studentNo) {
      reasons.push('学号为必填项');
    } else if (existingSet.has(studentNo)) {
      reasons.push('学号已存在于系统中，不可重复导入');
    } else if (fileSeenRow.has(studentNo)) {
      reasons.push(`学号与本表第 ${fileSeenRow.get(studentNo)} 行重复`);
    }
    if (studentNo) fileSeenRow.set(studentNo, row);

    if (!name) reasons.push('姓名为必填项');

    if (!data.gender) reasons.push('性别为必填项');
    else if (!(GENDERS as readonly string[]).includes(data.gender)) reasons.push('性别只能填：男 或 女');

    if (!data.grade) reasons.push('年级为必填项');
    else if (!/^\d{4}级$/.test(data.grade)) reasons.push('年级格式应为「YYYY级」，如 2026级');

    if (!data.className) reasons.push('班级为必填项');
    else if (classKeys && !classKeys.has(`${data.grade}|${data.className}`)) {
      reasons.push(`班级名未匹配到班级字典（${data.grade} ${data.className}），请先在「班级管理」中创建该班级`);
    }

    // 手机号：清洗分隔符后判定；错误提示回显原始输入
    if (!phone.ok) reasons.push(describePhoneError(phone, '手机号'));

    if (data.status && !(STUDENT_STATUSES as readonly string[]).includes(data.status)) {
      reasons.push('学籍状态只能填：在读、休学、退学');
    }

    // 家长电话为选填：留空不校验，填了则同样清洗后判定
    if (fatherPhone.raw !== '' && !fatherPhone.ok) {
      reasons.push(describePhoneError(fatherPhone, '父亲电话'));
    }

    if (motherPhone.raw !== '' && !motherPhone.ok) {
      reasons.push(describePhoneError(motherPhone, '母亲电话'));
    }

    // 入学时间：支持多种写法，统一规范化为 YYYY-MM-DD；无法识别时说明原始值与期望格式
    if (!enrollDate.ok) reasons.push(describeDateError(enrollDate, '入学时间'));

    if (reasons.length > 0) {
      failures.push({ row, studentNo: studentNo || '—', name: name || '—', reason: reasons.join('；'), data });
    } else {
      valid.push({ row, data });
    }
  });

  return { valid, failures };
}

/** 导出失败明细（保留模板全部列 + 失败原因列），修正后可直接重新上传 */
export function exportImportFailures(failures: StudentImportFailure[]): void {
  const aoa: unknown[][] = [[...TEMPLATE_HEADERS, '失败原因']];
  failures.forEach(({ data, studentNo, name, reason }) => {
    // 校验失败记录均携带原始行数据；兜底对象保证极端情况下导出不报错
    const d = (data ?? { studentNo, name }) as Omit<Student, 'id'>;
    aoa.push([
      d.studentNo ?? studentNo,
      d.name ?? name,
      d.gender ?? '',
      d.grade ?? '',
      d.major ?? '',
      d.className ?? '',
      d.phone ?? '',
      d.dorm ?? '',
      d.politicalStatus ?? '',
      d.origin ?? '',
      d.status ?? '',
      d.position ?? '',
      d.remark ?? '',
      d.enrollDate ?? '',
      d.headTeacher ?? '',
      d.counselor ?? '',
      d.fatherName ?? '',
      d.fatherPhone ?? '',
      d.motherName ?? '',
      d.motherPhone ?? '',
      reason,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [...TEMPLATE_HEADERS.map(() => ({ wch: 14 })), { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败明细');
  XLSX.writeFile(wb, `导入失败明细-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
}

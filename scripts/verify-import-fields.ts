/**
 * 学生名单导入「字段清洗」专项验证：多格式入学时间 + 带分隔符的电话号码。
 * 覆盖：清洗函数单测 → 日期/电话规范化表驱动用例 → 逐行校验集成 → Excel 端到端（解析→校验）。
 * 运行：npm run verify:import:fields
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as XLSX from 'xlsx';

import {
  cleanImportText,
  describeDateError,
  describePhoneError,
  normalizeDateInput,
  normalizePhoneInput,
} from '../src/utils/importNormalize';
import { parseStudentExcel, TEMPLATE_HEADERS, validateStudentRows } from '../src/utils/studentImport';

let passed = 0;

/** 1. 基础清洗：全角数字、全角空格、制表符、NBSP、零宽字符、换行 */
function verifyCleanText(): void {
  const cases: [string, string, string][] = [
    ['半角空格', '  138 0000 1111  ', '138 0000 1111'],
    ['全角空格折叠', '183\u30001485\u30000022', '183 1485 0022'],
    ['制表符折叠', '183\t1485\t0022', '183 1485 0022'],
    ['NBSP 折叠', '183\u00A01485\u00A00022', '183 1485 0022'],
    ['全角数字转半角', '１３８００００１１１１', '13800001111'],
    ['零宽字符剔除', '张\u200B三\uFEFF丰', '张三丰'],
    ['换行折叠', '计应\r\n2601', '计应 2601'],
  ];

  for (const [name, input, expected] of cases) {
    assert.strictEqual(cleanImportText(input), expected, `清洗失败：${name}`);
    passed += 1;
  }
}

/** 2. 入学时间：多格式识别与规范化 */
function verifyDateParsing(): void {
  const okCases: [string, string][] = [
    ['2026-09-01', '2026-09-01'], // 既有标准格式，必须保持不变
    ['2026/09/01', '2026-09-01'], // 斜杠分隔
    ['2026/9/1', '2026-09-01'], // 单位数月日
    ['2026.09.01', '2026-09-01'], // 点分隔
    ['2026.9.1', '2026-09-01'],
    ['20260901', '2026-09-01'], // 无分隔符
    ['2026年9月1日', '2026-09-01'], // 中文写法
    ['2026年09月01日', '2026-09-01'],
    ['2026年9月1', '2026-09-01'], // 省略「日」
    ['2026-09-01T08:00:00', '2026-09-01'], // ISO（带 T）
    ['2026-09-01 08:00:00', '2026-09-01'], // ISO（空格分隔时间）
    ['2026-09-01T00:00:00.000Z', '2026-09-01'], // 带毫秒与时区
    ['2026/09/01 08:30', '2026-09-01'], // 斜杠 + 时分
    ['  2026-09-01  ', '2026-09-01'], // 首尾空白
    ['２０２６-０９-０１', '2026-09-01'], // 全角数字
    ['2026－09－01', '2026-09-01'], // 全角连字符
    ['2024-02-29', '2024-02-29'], // 闰年 2 月 29 日
  ];

  for (const [input, expected] of okCases) {
    const r = normalizeDateInput(input);
    assert.ok(r.ok, `日期应被识别：${JSON.stringify(input)}（实际错误：${r.error}）`);
    assert.strictEqual(r.value, expected, `日期规范化结果不符：${JSON.stringify(input)}`);
    // 幂等：规范化结果再次输入应保持稳定（解析端与校验端会重复调用）
    assert.strictEqual(normalizeDateInput(r.value).value, expected, `日期规范化不幂等：${JSON.stringify(input)}`);
    passed += 1;
  }

  const failCases: [string, 'empty' | 'invalid' | 'unparsable'][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['2026-02-30', 'invalid'], // 2 月没有 30 日
    ['2025-02-29', 'invalid'], // 平年 2 月 29 日
    ['2026-13-01', 'invalid'], // 月份越界
    ['2026-00-10', 'invalid'],
    ['2026.09.31', 'invalid'], // 9 月只有 30 天
    ['1899-09-01', 'invalid'], // 年份超出 1900-2999
    ['2026/9', 'unparsable'], // 缺日
    ['26-9-1', 'unparsable'], // 两位年份不支持
    ['2026-09-01-01', 'unparsable'], // 多余分段
    ['2026090', 'unparsable'], // 7 位
    ['abc', 'unparsable'],
  ];

  for (const [input, expected] of failCases) {
    const r = normalizeDateInput(input);
    assert.strictEqual(r.ok, false, `日期应判为无效：${JSON.stringify(input)}`);
    assert.strictEqual(r.error, expected, `失败原因不符：${JSON.stringify(input)}`);
    assert.strictEqual(r.value, '', '失败时不应输出规范化值');
    passed += 1;
  }

  // 错误提示必须具体：回显原始值 + 说明期望格式 / 无效原因
  const badFormatMsg = describeDateError(normalizeDateInput('2026/9'), '入学时间');
  assert.ok(badFormatMsg.includes('2026/9'), `日期提示应回显原始值，实际：${badFormatMsg}`);
  assert.ok(
    badFormatMsg.includes('YYYY-MM-DD') && badFormatMsg.includes('YYYY年M月D日'),
    `日期提示应列出支持格式，实际：${badFormatMsg}`,
  );
  assert.ok(badFormatMsg.includes('原始值'), `日期提示应说明原始值，实际：${badFormatMsg}`);

  const badValueMsg = describeDateError(normalizeDateInput('2026-02-30'), '入学时间');
  assert.ok(badValueMsg.includes('2026-02-30'), `日期提示应回显原始值，实际：${badValueMsg}`);
  assert.ok(badValueMsg.includes('不是有效日期'), `应区分「格式对但日期不存在」，实际：${badValueMsg}`);

  assert.strictEqual(describeDateError(normalizeDateInput(''), '入学时间'), '入学时间为必填项', '空值提示应保持必填语义');
  passed += 4;
}

/** 3. 电话：分隔符清洗 + 手机号/座机号校验 + 失败提示回显 */
function verifyPhoneParsing(): void {
  const okCases: [string, string, 'mobile' | 'landline'][] = [
    ['13800001111', '13800001111', 'mobile'], // 既有合法值，必须保持不变
    ['183 1485 0022', '18314850022', 'mobile'], // 半角空格
    ['183\u30001485\u30000022', '18314850022', 'mobile'], // 全角空格
    ['183\t1485\t0022', '18314850022', 'mobile'], // 制表符
    ['183-1485-0022', '18314850022', 'mobile'], // 连字符
    ['183–1485–0022', '18314850022', 'mobile'], // en dash
    ['183－1485－0022', '18314850022', 'mobile'], // 全角连字符
    [' 183 1485 0022 ', '18314850022', 'mobile'], // 首尾空白
    ['１８３ １４８５ ００２２', '18314850022', 'mobile'], // 全角数字 + 空格
    ['+86 183 1485 0022', '18314850022', 'mobile'], // 国家码
    ['0571-88886666', '057188886666', 'landline'], // 座机（连字符）
    ['(0571)88886666', '057188886666', 'landline'], // 座机（括号区号）
    ['0571 8888 6666', '057188886666', 'landline'], // 座机（空格分组）
  ];

  for (const [input, compact, kind] of okCases) {
    const r = normalizePhoneInput(input);
    assert.ok(r.ok, `号码应通过校验：${JSON.stringify(input)}（实际错误：${r.error}）`);
    assert.strictEqual(r.compact, compact, `号码清洗结果不符：${JSON.stringify(input)}`);
    assert.strictEqual(r.kind, kind, `号码类型识别不符：${JSON.stringify(input)}`);
    assert.strictEqual(normalizePhoneInput(compact).compact, compact, `号码清洗不幂等：${JSON.stringify(input)}`);
    passed += 1;
  }

  // 分机号：单独拆出，入库以「号码-分机」形式拼接
  const extResult = normalizePhoneInput('0571-8888 6666 转 123');
  assert.ok(extResult.ok, '带分机号的座机应通过校验');
  assert.strictEqual(extResult.compact, '057188886666');
  assert.strictEqual(extResult.extension, '123');
  passed += 1;

  const failCases: [string, 'empty' | 'blank' | 'format', string[]][] = [
    ['', 'empty', ['手机号为必填项', '原始值：空']],
    ['   ', 'empty', ['手机号为必填项', '原始值：空']],
    ['\u3000', 'empty', ['手机号为必填项', '原始值：空']],
    ['---', 'blank', ['手机号格式不正确', '「---」', '为空']],
    ['183 1485 002', 'format', ['「183 1485 002」', '1831485002', '共 10 位']],
    ['12345', 'format', ['「12345」', '共 5 位']],
    ['183 1485 0022 1', 'format', ['「183 1485 0022 1」', '共 12 位']],
  ];

  for (const [input, expectedError, mustContain] of failCases) {
    const r = normalizePhoneInput(input);
    assert.strictEqual(r.ok, false, `号码应判为无效：${JSON.stringify(input)}`);
    assert.strictEqual(r.error, expectedError, `失败原因不符：${JSON.stringify(input)}`);
    const msg = describePhoneError(r, '手机号');
    for (const piece of mustContain) {
      assert.ok(msg.includes(piece), `提示缺少「${piece}」，实际：${msg}`);
    }
    passed += 1;
  }

  // 选填的家长电话：留空不应产生错误提示
  assert.strictEqual(normalizePhoneInput(undefined).error, 'empty', '未填写的家长电话应识别为空值');
  passed += 1;
}

/** 4. 逐行校验集成：规范化入库 + 行号定位不变 */
function verifyRowValidation(): void {
  const mk = (row: number, data: Record<string, string>) => ({ row, data: data as never });
  const base = {
    gender: '男',
    grade: '2026级',
    major: '计算机应用技术',
    className: '计应2601',
    status: '在读',
  };

  const rows = [
    mk(2, { ...base, studentNo: '2026030101', name: '空格手机', phone: '183 1485 0022', enrollDate: '2026/9/1' }),
    mk(3, { ...base, studentNo: '2026030102', name: '中文日期', phone: '183-1485-0023', enrollDate: '2026年9月1日' }),
    mk(4, { ...base, studentNo: '2026030103', name: '紧凑日期', phone: '0571-88886666', enrollDate: '20260901' }),
    mk(5, { ...base, studentNo: '2026030104', name: 'ISO 日期', phone: '138 0000 1111', enrollDate: '2026-09-01T00:00:00.000Z' }),
    mk(6, { ...base, studentNo: '2026030105', name: '坏日期', phone: '13800001111', enrollDate: '2026-02-30' }),
    mk(7, { ...base, studentNo: '2026030106', name: '坏手机', phone: '183 1485 002', enrollDate: '2026-09-01' }),
    mk(8, { ...base, studentNo: '2026030107', name: '既有合法值', phone: '13800001111', enrollDate: '2026-09-01' }),
    mk(9, {
      ...base,
      studentNo: '2026030108',
      name: '坏家长电话',
      phone: '13800001112',
      fatherPhone: '139 0000 100',
      motherPhone: '139 0000 1001',
      enrollDate: '2026/09/01',
    }),
  ];

  const { valid, failures } = validateStudentRows(rows, ['2024010101']);

  assert.strictEqual(valid.length, 5, `应通过 5 行，实际 ${valid.length}`);
  assert.deepStrictEqual(
    valid.map((r) => r.data.enrollDate),
    ['2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01'],
    '所有合法日期写法都应统一规范化为 YYYY-MM-DD',
  );
  assert.deepStrictEqual(
    valid.map((r) => r.data.phone),
    ['18314850022', '18314850023', '057188886666', '13800001111', '13800001111'],
    '带分隔符的号码应清洗为纯数字后入库，既有合法值保持不变',
  );
  assert.deepStrictEqual(valid.map((r) => r.row), [2, 3, 4, 5, 8], '合法行号应保持不变');
  passed += 3;

  assert.strictEqual(failures.length, 3, `应失败 3 行，实际 ${failures.length}`);
  assert.deepStrictEqual(failures.map((f) => f.row), [6, 7, 9], '失败行号必须指向原始 Excel 行');

  const badDate = failures.find((f) => f.row === 6);
  assert.ok(badDate && badDate.reason.includes('2026-02-30'), `坏日期提示应回显原始值，实际：${badDate?.reason}`);
  assert.ok(badDate && badDate.reason.includes('不是有效日期'), '坏日期应提示「不是有效日期」');

  const badPhone = failures.find((f) => f.row === 7);
  assert.ok(badPhone && badPhone.reason.includes('183 1485 002'), `坏手机号提示应回显原始值，实际：${badPhone?.reason}`);
  assert.ok(badPhone && badPhone.reason.includes('共 10 位'), '坏手机号应说明清洗后位数');

  const badParentPhone = failures.find((f) => f.row === 9);
  assert.ok(badParentPhone && badParentPhone.reason.includes('父亲电话'), '应指出是父亲电话出错');
  assert.ok(badParentPhone && badParentPhone.reason.includes('139 0000 100'), '家长电话提示应回显原始值');
  assert.ok(badParentPhone && !badParentPhone.reason.includes('母亲电话'), '合法的母亲电话不应报错');
  passed += 4;

  // 失败明细里的原始值应保留用户填写形态，便于修正后重传
  assert.strictEqual(failures.find((f) => f.row === 6)?.data?.enrollDate, '2026-02-30', '失败行应保留原始日期文本');
  assert.strictEqual(failures.find((f) => f.row === 7)?.data?.phone, '183 1485 002', '失败行应保留原始号码文本');
  passed += 2;
}

/** 5. Excel 端到端：写文件 → 解析 → 校验（含行号与原始值保留） */
async function verifyEndToEnd(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-fields-'));

  type Header = (typeof TEMPLATE_HEADERS)[number];
  const rowValues = (overrides: Partial<Record<Header, string>>): string[] => {
    const baseRow: Record<string, string> = {
      学号: '',
      姓名: '',
      性别: '男',
      年级: '2026级',
      专业: '计算机应用技术',
      班级: '计应2601',
      手机号: '',
      宿舍: '学生公寓5-602',
      政治面貌: '共青团员',
      生源地: '浙江杭州',
      学籍状态: '在读',
      班内职务: '',
      备注: '',
      入学时间: '',
      班主任: '罗海燕',
      辅导员: '王老师',
      父亲姓名: '',
      父亲电话: '',
      母亲姓名: '',
      母亲电话: '',
    };
    const merged = { ...baseRow, ...overrides };
    return TEMPLATE_HEADERS.map((h) => merged[h] ?? '');
  };

  const aoa: string[][] = [
    [...TEMPLATE_HEADERS],
    rowValues({ 学号: '2026040101', 姓名: '甲', 手机号: '183 1485 0022', 入学时间: '2026/9/1' }),
    rowValues({ 学号: '2026040102', 姓名: '乙', 手机号: '183-1485-0023', 入学时间: '2026年9月1日' }),
    rowValues({ 学号: '2026040103', 姓名: '丙', 手机号: '0571 8888 6666', 入学时间: '2026.09.01' }),
    rowValues({ 学号: '2026040104', 姓名: '丁', 手机号: '183\t1485\t0024', 入学时间: '20260901' }),
    rowValues({ 学号: '2026040105', 姓名: '戊', 手机号: '183\u30001485\u30000025', 入学时间: '2026-09-01 08:00:00' }),
    rowValues({ 学号: '2026040106', 姓名: '己', 手机号: '13800001111', 入学时间: '2026-09-01' }),
    rowValues({ 学号: '2026040107', 姓名: '庚', 手机号: '183 1485 002', 入学时间: '2026-09-01' }),
    rowValues({ 学号: '2026040108', 姓名: '辛', 手机号: '13800001112', 入学时间: '2026/13/01' }),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生名单');
  const xlsxPath = path.join(tmp, 'fields.xlsx');
  XLSX.writeFile(wb, xlsxPath);

  const file = new File([fs.readFileSync(xlsxPath)], 'fields.xlsx');
  const parsedRows = await parseStudentExcel(file);
  assert.strictEqual(parsedRows.length, 8, `应解析出 8 行，实际 ${parsedRows.length}`);
  assert.deepStrictEqual(parsedRows.map((r) => r.row), [2, 3, 4, 5, 6, 7, 8, 9], '解析行号应与 Excel 行号一致');
  assert.strictEqual(
    parsedRows[0].data.phone,
    '183 1485 0022',
    '解析阶段应保留原始号码形态（含空格），供校验失败时回显',
  );
  assert.strictEqual(parsedRows[5].data.enrollDate, '2026-09-01', '标准日期解析后保持不变');
  passed += 3;

  const e2e = validateStudentRows(parsedRows, []);
  assert.strictEqual(e2e.valid.length, 6, `端到端应通过 6 行，实际 ${e2e.valid.length}`);
  assert.deepStrictEqual(
    e2e.valid.map((r) => r.data.enrollDate),
    ['2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01'],
    '端到端日期应全部规范化',
  );
  assert.deepStrictEqual(
    e2e.valid.map((r) => r.data.phone),
    ['18314850022', '18314850023', '057188886666', '18314850024', '18314850025', '13800001111'],
    '端到端号码应全部清洗为纯数字',
  );
  assert.deepStrictEqual(e2e.failures.map((f) => f.row), [8, 9], '端到端失败行号应指向原始 Excel 行');
  assert.ok(e2e.failures[0].reason.includes('183 1485 002'), '端到端失败提示应回显原始号码');
  assert.ok(e2e.failures[1].reason.includes('2026/13/01'), '端到端失败提示应回显原始日期');
  passed += 5;

  console.log('✅ 字段清洗专项验证全部通过');
  console.log(`   - 断言用例数：${passed}`);
  console.log(`   - 集成：${e2e.valid.length} 行通过、${e2e.failures.length} 行失败，行号与原表一致`);
}

async function main(): Promise<void> {
  verifyCleanText();
  verifyDateParsing();
  verifyPhoneParsing();
  verifyRowValidation();
  await verifyEndToEnd();
}

main().catch((err) => {
  console.error('❌ 字段清洗验证失败：', err);
  process.exit(1);
});

/**
 * 学生名单批量导入链路的 Node 端逻辑验证（开发辅助脚本，不参与应用构建）。
 * 运行：npm run verify:import
 * 说明：第 3 段会真正调用 POST /students/import，需要服务端在跑；
 *       默认跳过，设置 VERIFY_IMPORT_API=1 且服务已启动时才执行。
 *       字段级（多格式日期 / 带空格号码）的专项用例见 verify-import-fields.ts。
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as XLSX from 'xlsx';

import {
  buildStudentTemplateWorkbook,
  exportImportFailures,
  parseStudentExcel,
  validateStudentRows,
} from '../src/utils/studentImport';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-verify-'));

  /* 1. 模板生成 → 写文件 → 读回解析（往返一致） */
  const wb = buildStudentTemplateWorkbook();
  assert.ok(wb.SheetNames.includes('学生名单'), '模板应包含「学生名单」表');
  assert.ok(wb.SheetNames.includes('填写说明'), '模板应包含「填写说明」表');
  const templatePath = path.join(tmp, 'template.xlsx');
  XLSX.writeFile(wb, templatePath);

  const file = new File([fs.readFileSync(templatePath)], 'template.xlsx');
  const parsed = await parseStudentExcel(file);
  assert.strictEqual(parsed.length, 2, `模板应解析出 2 行示例数据，实际 ${parsed.length}`);
  assert.strictEqual(parsed[0].data.name, '张三丰');
  assert.strictEqual(parsed[1].row, 3, '第二行示例的 Excel 行号应为 3');

  /* 2. 校验：必填 / 格式 / 文件内重复 / 与系统重复 */
  const mk = (row: number, data: Record<string, string>) => ({ row, data: data as never });
  const rows = [
    mk(2, { studentNo: '2026010301', name: '测试一', gender: '男', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13800001001', status: '在读', enrollDate: '2026-09-01' }),
    mk(3, { studentNo: '2026010301', name: '测试一重复', gender: '男', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13800001002', status: '在读', enrollDate: '2026-09-01' }),
    mk(4, { studentNo: '2024010101', name: '撞库号', gender: '男', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '13800001003', status: '在读', enrollDate: '2024-09-12' }),
    mk(5, { studentNo: '2026010302', name: '', gender: '女', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13800001004', status: '在读', enrollDate: '2026-09-01' }),
    mk(6, { studentNo: '2026010303', name: '坏性别', gender: '未知', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13800001005', status: '在读', enrollDate: '2026-09-01' }),
    mk(7, { studentNo: '2026010304', name: '坏年级', gender: '男', grade: '26级', major: '计算机应用技术', className: '计应2601', phone: '13800001006', status: '在读', enrollDate: '2026-09-01' }),
    mk(8, { studentNo: '2026010305', name: '坏专业', gender: '男', grade: '2026级', major: '考古学', className: '计应2601', phone: '13800001007', status: '在读', enrollDate: '2026-09-01' }),
    mk(9, { studentNo: '2026010306', name: '坏手机', gender: '男', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '12345', status: '在读', enrollDate: '2026-09-01' }),
    mk(10, { studentNo: '2026010307', name: '坏日期', gender: '男', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13800001008', status: '在读', enrollDate: '2026-02-30' }),
    mk(11, { studentNo: '2026010308', name: '斜杠日期', gender: '女', grade: '2026级', major: '电子商务', className: '电商2601', phone: '13800001009', status: '', enrollDate: '2026/09/01' }),
    mk(12, { studentNo: '2026010309', name: '坏家长电话', gender: '女', grade: '2026级', major: '电子商务', className: '电商2601', phone: '13800001010', status: '在读', enrollDate: '2026-09-01', fatherName: '张父', fatherPhone: '12345', motherName: '李母', motherPhone: '13800001011' }),
    mk(13, { studentNo: '2026010310', name: '无专业', gender: '男', grade: '2026级', major: '', className: '计应2601', phone: '13800001012', status: '在读', enrollDate: '2026-09-01' }),
  ];
  const existingNos = ['2024010101', '2024010102'];
  const { valid, failures } = validateStudentRows(rows, existingNos);

  assert.strictEqual(valid.length, 4, `应通过 4 行，实际 ${valid.length}`);
  assert.strictEqual(valid[2].data.enrollDate, '2026-09-01', '斜杠日期应被规范化');
  assert.strictEqual(valid[2].data.status, '在读', '学籍状态留空应默认在读');
  assert.strictEqual(failures.length, 8, `应失败 8 行，实际 ${failures.length}`);
  assert.ok(failures.some((f) => f.reason.includes('学号与本表第 2 行重复')), '应识别文件内重复学号');
  assert.ok(failures.some((f) => f.reason.includes('学号已存在于系统中')), '应识别与系统重复学号');
  assert.ok(failures.some((f) => f.reason.includes('姓名为必填项')), '应校验姓名必填');
  assert.ok(failures.some((f) => f.reason.includes('性别只能填')), '应校验性别枚举');
  assert.ok(failures.some((f) => f.reason.includes('年级格式')), '应校验年级格式');
  assert.ok(failures.some((f) => f.reason.includes('手机号格式不正确')), '应校验手机号格式');
  assert.ok(failures.some((f) => f.reason.includes('入学时间') && f.reason.includes('不是有效日期')), '应校验日期有效性');
  assert.ok(failures.some((f) => f.reason.includes('父亲电话')), '应校验父亲电话格式（母亲电话合法不应报错）');
  /* 「专业」不参与校验：任意取值与留空均应通过，且失败原因中不得出现专业相关条目 */
  assert.ok(valid.some((r) => r.data.major === '考古学'), '专业为任意取值时应通过校验');
  assert.ok(valid.some((r) => r.data.major === ''), '专业留空时应通过校验');
  assert.ok(!failures.some((f) => f.reason.includes('专业')), '失败原因中不应再出现专业相关校验条目');

  /* 3. 导入：追加写入 + 以数据库为准二次查重，绝不覆盖已有数据 */
  /* 3. 导入：追加写入 + 以数据库为准二次查重，绝不覆盖已有数据
     —— 该段依赖真实服务端（POST /students/import），默认跳过，避免在纯逻辑验证时误报 */
  if (process.env.VERIFY_IMPORT_API !== '1') {
    console.log('⏭  跳过「服务端导入」验证（设置 VERIFY_IMPORT_API=1 且服务已启动时执行）');
  } else {
    const { getExistingStudentNos, importStudents } = await import('../src/api/student');
    const nosBefore = await getExistingStudentNos();

    const importRows = [
      ...valid,
      mk(99, { studentNo: '2024010101', name: '导入时撞库', gender: '男', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '13800001999', status: '在读', enrollDate: '2024-09-12' }),
    ];
    const result = await importStudents(importRows);
    assert.strictEqual(result.successCount, 4, `导入应成功 4 条，实际 ${result.successCount}`);
    assert.strictEqual(result.failures.length, 1, '导入时撞库号应被驳回');
    const nosAfter = await getExistingStudentNos();
    assert.strictEqual(nosAfter.length, nosBefore.length + 4, '学号总数应 +4');
    assert.ok(!nosBefore.includes('2026010301') && nosAfter.includes('2026010301'), '新学号已追加');
    assert.ok(nosAfter.includes('2026010305'), '专业为任意取值的行同样应导入成功');
    assert.ok(nosAfter.includes('2026010310'), '专业留空的行同样应导入成功');
    console.log(`   - 导入：成功 ${result.successCount} 条，撞库驳回 ${result.failures.length} 条`);
  }

  /* 4. 失败明细导出（写临时目录验证不抛错） */
  const cwd = process.cwd();
  process.chdir(tmp);
  exportImportFailures(failures);
  process.chdir(cwd);
  assert.ok(fs.readdirSync(tmp).some((f) => f.startsWith('导入失败明细-')), '失败明细应已写出');

  console.log('✅ 导入链路验证全部通过');
  console.log('   - 模板往返解析：2 行示例');
  console.log(`   - 校验：${valid.length} 行通过 / ${failures.length} 行按预期失败`);
  console.log('   - 专业：任意取值 / 留空均不校验，正常入库');
}

main().catch((err) => {
  console.error('❌ 验证失败：', err);
  process.exit(1);
});

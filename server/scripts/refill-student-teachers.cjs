#!/usr/bin/env node
/**
 * 学生名册责任人历史数据清洗 / 回填脚本（幂等，可重复执行）。
 *
 *   node --experimental-sqlite server/scripts/refill-student-teachers.cjs            # 体检：出报告 + 两份 CSV
 *   node --experimental-sqlite server/scripts/refill-student-teachers.cjs --apply     # 执行回填
 *   WORKBENCH_DATA_DIR=/path/to/data node …                                          # 指定数据目录
 *
 * 迁移步骤（建议顺序）：
 *   1) 数据管理 → 生成一次「恢复前快照」；
 *   2) 班级管理 → 教师名单：导入全部辅导员与班主任（本脚本不建账号，只做引用与回填）；
 *   3) 跑本脚本（不带 --apply），看报告与两份清单：
 *      - 差异清单：学生表旧文本 ≠ 派生值，确认无误后第 4 步落库；
 *      - 待补录清单：学生表里的责任人姓名在账号中查不到，需先补录教师或修正姓名；
 *   4) 跑本脚本 --apply，把 students.headTeacher / counselor 改写为派生值（无人则置 NULL）。
 *
 * 派生口径与运行时完全一致（lib/teacherSync.js）：按 classId 取 roleType 维度下的
 * 教师姓名，按 users.id 升序以「、」连接；无教师时为 NULL。
 *
 * 说明：脚本复用 lib/db 的同一连接与口径（含启动迁移），避免两份实现漂移；
 *      体检模式不会改动任何业务数据。
 */
const fs = require('fs');
const path = require('path');

const dbx = require('../lib/db');
const { DATA_DIR } = require('../lib/config');
const { allClassIds, derivedTeachersOfClass, refillStudentsByClass } = require('../lib/teacherSync');

const APPLY = process.argv.includes('--apply');
const OUT_DIR = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || DATA_DIR;

/** 文本清洗：去首尾空白、折叠内部连续空白（历史脏数据主要来源） */
function cleanText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`; // BOM：Excel 按 UTF-8 打开
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  /* ① 姓名 → 账号映射（识别「查无此人」的历史文本） */
  const nameToUser = new Map(
    dbx.all('SELECT id, displayName FROM users ORDER BY id')
      .map((u) => [cleanText(u.displayName), u]),
  );

  /* ② 逐班比对：旧文本 vs 派生值 */
  const classes = dbx.all(
    `SELECT c.id, c.name AS className, g.name AS gradeName FROM classes c
     JOIN grades g ON g.id = c.gradeId ORDER BY g.name DESC, c.name`,
  );

  const diffRows = [];
  const unknownNames = new Map();
  let unchanged = 0;

  for (const cls of classes) {
    const derived = derivedTeachersOfClass(cls.id);
    const students = dbx.all(
      'SELECT studentNo, name, counselor, headTeacher FROM students WHERE classId = ? ORDER BY studentNo',
      [cls.id],
    );
    for (const s of students) {
      for (const [field, derivedValue] of [['counselor', derived.counselor], ['headTeacher', derived.headTeacher]]) {
        const oldValue = cleanText(s[field]);
        const newValue = cleanText(derivedValue);
        if (oldValue === newValue) { unchanged += 1; continue; }
        diffRows.push([
          s.studentNo, s.name, `${cls.gradeName}·${cls.className}`,
          field === 'counselor' ? '辅导员' : '班主任',
          oldValue || '(空)', newValue || '(空·将置 NULL)',
        ]);
      }
      for (const [field, label] of [['counselor', '辅导员'], ['headTeacher', '班主任']]) {
        for (const raw of String(s[field] ?? '').split(/[、,，/;；]/)) {
          const n = cleanText(raw);
          if (!n || nameToUser.has(n)) continue;
          const hit = unknownNames.get(n) ?? { count: 0, classes: new Set(), label };
          hit.count += 1;
          hit.classes.add(`${cls.gradeName}·${cls.className}`);
          unknownNames.set(n, hit);
        }
      }
    }
  }

  /* ③ 报告与两份清单 */
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const diffFile = path.join(OUT_DIR, `责任人差异清单-${stamp}.csv`);
  const unknownFile = path.join(OUT_DIR, `待补录教师清单-${stamp}.csv`);
  fs.writeFileSync(diffFile, toCsv([['学号', '姓名', '班级', '字段', '当前值', '派生值'], ...diffRows]));
  const unknownRows = [...unknownNames.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, v]) => [name, v.label, v.count, [...v.classes].join(' ')]);
  fs.writeFileSync(unknownFile, toCsv([['姓名', '出现为', '涉及学生数', '涉及班级'], ...unknownRows]));

  console.log(`[refill] 班级 ${classes.length} 个；一致行 ${unchanged} 条；差异 ${diffRows.length} 条`);
  console.log(`[refill] 差异清单：${diffFile}`);
  console.log(`[refill] 待补录教师 ${unknownRows.length} 人：${unknownFile}`);
  if (unknownRows.length > 0) {
    console.log('[refill] ⚠️ 上述姓名在账号中不存在，请先在「班级管理 → 教师名单」导入后再回填，否则责任人会被置空。');
  }

  if (!APPLY) {
    console.log('[refill] 体检模式（未改动业务数据）。确认无误后追加 --apply 执行回填。');
    return;
  }

  /* ④ 回填（幂等：只更新有差异的行） */
  const result = refillStudentsByClass(allClassIds());
  console.log(`[refill] 已回填：涉及 ${result.classCount} 个班，更新 ${result.changedCount} 名学生。`);
}

main();

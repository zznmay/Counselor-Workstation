import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

import type { InterviewExportRecord } from '@/types';

/**
 * 心理访谈记录批量导出（浏览器端生成 Excel，与既有导出模式一致）：
 * 一个工作表承载全部记录（学生基本信息 + 访谈关键字段 + 按题目快照展开的动态问答列），
 * 另附「导出说明」工作表记录筛选条件与导出时间，便于存档核对。
 */

/** 「情况概述」有专属列（记录 summary 字段），动态题目列不再重复展开该题 */
const SUMMARY_KEY = 'summary';

interface ExportQuestion {
  key: string;
  text: string;
}

/** 汇总各记录题目快照中出现过的题目（按首次出现顺序去重；排除 summary 专属列） */
export function collectExportQuestions(rows: InterviewExportRecord[]): ExportQuestion[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const group of row.formGroups ?? []) {
      for (const q of group.questions ?? []) {
        if (q.key === SUMMARY_KEY || seen.has(q.key)) continue;
        seen.set(q.key, q.text);
      }
    }
  }
  return [...seen.entries()].map(([key, text]) => ({ key, text }));
}

/** 记录的评估前后等级展示（缺档以 — 占位，保证列对齐） */
function levelText(level: string | null | undefined): string {
  return level || '—';
}

/** 生成导出工作簿：「访谈记录」数据表 + 「导出说明」说明表 */
export function buildInterviewExportWorkbook(
  rows: InterviewExportRecord[],
  filterDesc: string[],
): XLSX.WorkBook {
  const questions = collectExportQuestions(rows);

  const headers = [
    '学生姓名',
    '学号',
    '班级',
    '年级',
    '当前关注等级',
    '所属学期',
    '访谈时间',
    '访谈教师',
    '评估前等级',
    '评估后等级',
    ...questions.map((q) => q.text.length > 40 ? `${q.text.slice(0, 40)}…` : q.text),
    '情况概述',
    '签字教师',
    '签字时间',
  ];

  const aoa: (string | number)[][] = [headers];
  for (const row of rows) {
    aoa.push([
      row.studentName,
      row.studentNo,
      row.className,
      row.grade,
      levelText(row.currentLevel),
      row.semesterLabel,
      row.interviewDate,
      row.interviewerName,
      levelText(row.levelBefore),
      levelText(row.levelAfter),
      ...questions.map((q) => row.answers?.[q.key] ?? ''),
      row.summary || (row.answers?.[SUMMARY_KEY] ?? ''),
      row.signatureName,
      row.signedAt,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 列宽：固定列按内容设宽，题目/概述列放宽保证长文本可读
  ws['!cols'] = [
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 22 },
    { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 11 },
    ...questions.map(() => ({ wch: 42 })),
    { wch: 60 }, { wch: 10 }, { wch: 19 },
  ];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: aoa.length - 1, c: headers.length - 1 },
  }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '访谈记录');

  const guideAoa: (string | number)[][] = [
    ['项目', '内容'],
    ['导出时间', dayjs().format('YYYY-MM-DD HH:mm:ss')],
    ['记录条数', `${rows.length} 条`],
    ['数据来源', '知行辅导员工作台 · 心理健康模块（未删除的正式访谈记录）'],
    ...filterDesc.map((d) => ['筛选条件', d]),
    ['说明', '「评估前/后等级」为填写该条记录时的档位快照；「当前关注等级」为学生现在的关注档位'],
    ['说明', '问答列按各记录填写时的记录单模板快照展开，不同模板的题目列可能互有留空'],
  ];
  const guideWs = XLSX.utils.aoa_to_sheet(guideAoa);
  guideWs['!cols'] = [{ wch: 12 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideWs, '导出说明');

  return wb;
}

/** 生成并触发浏览器下载；返回文件名（供完成态展示） */
export function downloadInterviewExport(rows: InterviewExportRecord[], filterDesc: string[]): string {
  const fileName = `心理访谈记录导出-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`;
  XLSX.writeFile(buildInterviewExportWorkbook(rows, filterDesc), fileName);
  return fileName;
}

/**
 * 批量导入共用的「输入清洗 + 字段规范化」层。
 *
 * 学生名单导入的两处入口都走这里，保证「解析 Excel」与「逐行校验」用的是同一套规则：
 *   - parseStudentExcel：每个单元格先做基础清洗（cleanImportText）
 *   - validateStudentRows：再对日期 / 电话字段做规范化（normalizeDateInput / normalizePhoneInput）
 *
 * 设计约束：
 *   1. 只做「识别与规范化」，不做业务必填/枚举判断 —— 错误提示由调用侧组装，行号定位不受影响；
 *   2. 合法输入必须幂等：规范化结果再喂回来，输出不变（便于解析端与校验端重复调用）；
 *   3. 失败时保留原始输入（raw），错误提示必须能回显用户实际填的内容。
 */

/* ==================== 一、基础文本清洗 ==================== */

/** 零宽字符与方向控制符（从网页/聊天工具复制粘贴、Excel 导出常见脏字符） */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

/** 各类空白：半角空格、全角空格（U+3000）、NBSP、制表符、换行等，统一折叠为单个半角空格 */
const WHITESPACE_RE = /[\s\u00A0\u3000\u2000-\u200A\u202F\u205F]+/g;

/** 全角数字 ０-９ → 半角 0-9（只转数字，不动中文标点与姓名内容） */
const FULLWIDTH_DIGIT_RE = /[\uFF10-\uFF19]/g;

/**
 * 基础清洗：全角数字转半角 → 去零宽字符 → 空白折叠为单空格 → 去首尾空白。
 * 所有导入字段（学号/姓名/备注/电话/日期……）共用此函数。
 */
export function cleanImportText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(FULLWIDTH_DIGIT_RE, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(ZERO_WIDTH_RE, '')
    .replace(WHITESPACE_RE, ' ')
    .trim();
}

/** 原始输入回显：只去首尾空白与零宽字符，保留内部空格/连字符，让用户一眼认出自己填的值 */
export function rawEcho(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(ZERO_WIDTH_RE, '').trim();
}

/** 提示语中的原始值展示（空值显式标注为「空」，避免出现「」这样的空引号） */
function quoteRaw(raw: string): string {
  return raw === '' ? '空' : `「${raw}」`;
}

/* ==================== 二、电话号码清洗与校验 ==================== */

/**
 * 号码分隔符：各类空白、全角空格、制表符、各类连字符（- ‐ ‑ ‒ – — ― − －）、
 * 括号（座机区号写法 (0571)88886666）。清洗后应只剩数字（可能带分机号）。
 */
const PHONE_SEPARATOR_RE = /[\s\u00A0\u3000\u2000-\u200A\u202F\u205F\u2010-\u2015\u2212\uFF0D\-()（）]/g;

/** 分机号写法：转 1234 / ext.1234 / x1234 / #1234 */
const PHONE_EXT_RE = /(?:转|ext\.?|x|#)\s*(\d{1,6})$/i;

/** 手机号：11 位、以 1 开头（沿用既有规则，不收紧号段以免影响历史数据） */
const MOBILE_RE = /^1\d{10}$/;

/** 座机号：区号以 0 开头 + 号码，去掉分隔符后共 10-12 位（如 057188886666 / 01088886666） */
const LANDLINE_RE = /^0\d{9,11}$/;

export type PhoneKind = 'mobile' | 'landline';

export interface PhoneParseResult {
  /** 原始输入（用于错误提示回显） */
  raw: string;
  /** 去掉空格/连字符等分隔符后的号码（不含分机号）；为空表示原值没有数字 */
  compact: string;
  /** 分机号，无则为空串 */
  extension: string;
  /** 识别出的号码类型，未识别为 null */
  kind: PhoneKind | null;
  ok: boolean;
  /** 失败原因：空值 / 只有分隔符没有数字 / 位数或号段不符 */
  error: 'empty' | 'blank' | 'format' | null;
}

/**
 * 电话号码清洗 + 规范化：
 * 先清洗掉空格（含全角空格、NBSP、制表符）、连字符、括号等分隔字符，再按手机号/座机号规则判定。
 * 兼容 +86 前缀（仅当其后的号码恰好是合法手机号时才剥离，避免误伤座机）。
 */
export function normalizePhoneInput(value: unknown): PhoneParseResult {
  const raw = rawEcho(value);

  // 先把空白整体去掉（含 183 1485 0022 这类分组写法），再单独拆出分机号
  let text = cleanImportText(value).replace(/\s+/g, '');
  let extension = '';
  const extMatch = text.match(PHONE_EXT_RE);
  if (extMatch && extMatch.index !== undefined) {
    extension = extMatch[1];
    text = text.slice(0, extMatch.index);
  }

  const compact = text.replace(PHONE_SEPARATOR_RE, '').replace(/^\+?86(?=1\d{10}$)/, '');

  if (raw === '') {
    return { raw, compact, extension, kind: null, ok: false, error: 'empty' };
  }
  if (compact === '') {
    return { raw, compact, extension, kind: null, ok: false, error: 'blank' };
  }

  const kind: PhoneKind | null = MOBILE_RE.test(compact)
    ? 'mobile'
    : LANDLINE_RE.test(compact)
      ? 'landline'
      : null;

  return { raw, compact, extension, kind, ok: kind !== null, error: kind ? null : 'format' };
}

/** 入库用号码字符串：号码 + （分机号以 - 连接） */
export function formatPhoneNumber(result: PhoneParseResult): string {
  return result.extension ? `${result.compact}-${result.extension}` : result.compact;
}

/** 号码错误提示：始终回显原始输入，并说明清洗后的形态与期望规则 */
export function describePhoneError(result: PhoneParseResult, label = '手机号'): string {
  const rawText = quoteRaw(result.raw);

  if (result.error === 'empty') {
    return `${label}为必填项（原始值：${rawText}）`;
  }
  if (result.error === 'blank') {
    return `${label}格式不正确：原始值${rawText}去掉空格、连字符等分隔符后为空，应为 11 位手机号（1 开头）或带区号的座机号（如 0571-88886666）`;
  }
  return `${label}格式不正确：原始值${rawText}去掉分隔符后为「${result.compact}」（共 ${result.compact.length} 位），应为 11 位手机号（1 开头）或带区号的座机号（如 0571-88886666）`;
}

/* ==================== 三、日期清洗与规范化 ==================== */

export type DateErrorReason = 'empty' | 'unparsable' | 'invalid';

export interface DateParseResult {
  /** 原始输入（用于错误提示回显） */
  raw: string;
  ok: boolean;
  /** 规范化后的 YYYY-MM-DD，失败时为空串 */
  value: string;
  error: DateErrorReason | null;
}

/** 支持的日期写法（模板「填写说明」用，带示例，便于填写者照抄） */
export const SUPPORTED_DATE_FORMATS = [
  'YYYY-MM-DD（2026-09-01）',
  'YYYY/MM/DD（2026/09/01）',
  'YYYY.MM.DD（2026.09.01）',
  'YYYYMMDD（20260901）',
  'YYYY年M月D日（2026年9月1日）',
  '带时分秒的 ISO 日期时间（2026-09-01T08:00:00 / 2026-09-01 08:00:00）',
] as const;

/** 错误提示用的紧凑格式清单（不带示例，避免校验结果表格里提示过长） */
export const DATE_FORMAT_HINT =
  'YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD、YYYYMMDD、YYYY年M月D日、带时分秒的 ISO 日期时间';

/**
 * 日期后允许跟的时间部分：ISO 的 T 分隔或空格后的 HH:mm(:ss)(.SSS)(Z / +08:00)。
 * 说明：清洗阶段已把所有空白去掉，因此「2026-09-01 08:00:00」到这里是「2026-09-0108:00:00」，
 * 时间部分需用 `[Tt]?` 兼容。
 */
const TRAILING_TIME = String.raw`(?:[Tt]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:[Zz]|[+-]\d{2}:?\d{2})?)?`;

const DATE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TRAILING_TIME}$`), // 2026-09-01 / 2026/9/1 / 2026.09.01
  new RegExp(String.raw`^(\d{4})年(\d{1,2})月(\d{1,2})日?${TRAILING_TIME}$`), // 2026年9月1日
  new RegExp(String.raw`^(\d{4})(\d{2})(\d{2})${TRAILING_TIME}$`), // 20260901
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 年月日是否为真实存在的日期（拦截 2026-02-30、2026-13-01 这类「格式对但日期不存在」的值） */
function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * 日期清洗 + 规范化：识别常见书写格式（含 Excel 日期单元格被格式化成字符串后的值），
 * 统一输出 YYYY-MM-DD；无法识别与「日期不存在」分别给出不同的失败原因，便于精确提示。
 */
export function normalizeDateInput(value: unknown): DateParseResult {
  const raw = rawEcho(value);
  if (raw === '') return { raw, ok: false, value: '', error: 'empty' };

  const text = cleanImportText(value)
    // 全角日期分隔符 → 半角
    .replace(/[－—–‐‑]/g, '-')
    .replace(/／/g, '/')
    .replace(/．/g, '.')
    .replace(/\s+/g, '');

  for (const re of DATE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!isValidYmd(year, month, day)) {
      return { raw, ok: false, value: '', error: 'invalid' };
    }
    return { raw, ok: true, value: `${year}-${pad2(month)}-${pad2(day)}`, error: null };
  }

  return { raw, ok: false, value: '', error: 'unparsable' };
}

/** 日期错误提示：区分「没填」「认不出」「日期不存在」，均回显原始值并说明期望格式 */
export function describeDateError(result: DateParseResult, label = '日期'): string {
  if (result.error === 'empty') return `${label}为必填项`;

  const rawText = quoteRaw(result.raw);
  if (result.error === 'invalid') {
    return `${label}${rawText}不是有效日期：年份需在 1900-2999 之间，月份 1-12，日期需符合当月实际天数`;
  }
  return `${label}无法识别：原始值${rawText}，支持的格式有 ${DATE_FORMAT_HINT}`;
}

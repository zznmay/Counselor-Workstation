/**
 * 心理访谈记录单模板（表 mentalInterviewTemplates）。
 *
 * 职责：
 * - 模板增删改查（写权限由路由层判定：管理员或心理健康主负责）；
 * - 按学生年级 + 当前关注等级解析生效模板（年级/等级精确匹配优先，其次「不限」模板，
 *   同分取最近编辑；无任何兼容模板时回退内置默认记录单）；
 * - 访谈 answers 的动态白名单校验（题目以模板为准，取代旧硬编码题单）。
 *
 * 解析规则（resolveFormModel）：
 *   1. 「适用年级包含学生年级」且「适用关注等级包含当前等级（或不限）」的模板中，
 *      按匹配精度（精确 2 分 / 不限 1 分）与最近编辑取一个；
 *   2. 库内无启用模板、或所有模板的范围均不含该生时，回退内置默认记录单。
 * 访谈记录落库时携带 templateId/templateVersion/formSnapshot，
 * 模板后续改题不影响历史记录的问答渲染与再编辑校验。
 */
const dbx = require('./db');
const { nowStr } = require('./audit');
const { DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, DEFAULT_FORM_GROUPS } = require('./interviewFormDefault');

/** 关注等级（展示顺序即紧急程度从高到低；末位「无需关注」为留档档位，不安排访谈）。
 *  单一事实源：routes/mental.js 与访谈评估选项均引用此处。 */
const LEVELS = ['密切关注', '重点关注', '日常关注', '一般关注', '无需关注'];

const MAX_GROUPS = 20;
const MAX_QUESTIONS_PER_GROUP = 30;
const KEY_RE = /^[A-Za-z0-9_]{1,64}$/;

/** 单题字数下限取值范围（非负整数；0 = 不限制，与历史题目缺省行为一致） */
const MIN_CHARS_MIN = 0;
const MIN_CHARS_MAX = 5000;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseJsonArray(raw) {
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function gradesOf(row) {
  return parseJsonArray(row?.grades).filter((g) => typeof g === 'string' && g.trim());
}

/** 适用关注等级（空数组 = 不限等级） */
function levelsOf(row) {
  return parseJsonArray(row?.levels).filter((l) => typeof l === 'string' && l.trim());
}

function groupsOf(row) {
  return parseJsonArray(row?.groups).filter((g) => g && typeof g === 'object');
}

/** 生成题目 key（同一模板内唯一；既有题目沿用原 key，保证历史答案不丢） */
function genKey() {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 规整分组结构（trim + 默认值 + key 补齐）；输出与前端 InterviewFormModel 同构。
 * min（字数下限）为可选字段：历史题目/快照缺失时补 0 —— 0 表示不做下限限制，
 * 保证旧模板与旧访谈记录快照在新代码下继续可用。
 */
function normalizeGroups(rawGroups) {
  const used = new Set();
  return rawGroups.map((g) => ({
    title: String(g?.title ?? '').trim(),
    questions: (Array.isArray(g?.questions) ? g.questions : []).map((q) => {
      let key = String(q?.key ?? '').trim();
      if (!KEY_RE.test(key) || used.has(key)) key = genKey();
      used.add(key);
      const placeholder = String(q?.placeholder ?? '').trim();
      const max = Number(q?.max) || 500;
      // 下限容错：非法/缺失一律视为 0（不限制），不因脏数据让历史记录无法渲染
      const rawMin = Number(q?.min);
      const min = Number.isInteger(rawMin) && rawMin >= MIN_CHARS_MIN && rawMin <= max
        ? rawMin
        : 0;
      return {
        key,
        text: String(q?.text ?? '').trim(),
        ...(placeholder ? { placeholder } : {}),
        min,
        max,
        rows: Number(q?.rows) || 3,
      };
    }),
  }));
}

/** 列表/CRUD 输出结构（含启用态、版本、引用数） */
function templateView(row) {
  const usageCount = row?.id
    ? (dbx.get(
      'SELECT COUNT(*) AS c FROM mentalInterviews WHERE templateId = ? AND deletedAt IS NULL',
      [row.id],
    )?.c ?? 0)
    : 0;
  return {
    id: row.id,
    name: row.name,
    grades: gradesOf(row),
    levels: levelsOf(row),
    groups: normalizeGroups(groupsOf(row)),
    enabled: !!row.enabled,
    version: row.version ?? 1,
    usageCount,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 访谈表单模型（前端渲染记录单用；不含管理字段） */
function formModel(row) {
  return {
    id: row?.id ?? null,
    name: row?.name ?? DEFAULT_TEMPLATE_NAME,
    grades: gradesOf(row),
    levels: levelsOf(row),
    groups: normalizeGroups(groupsOf(row)),
    version: row?.version ?? 1,
  };
}

/** 内置默认记录单（库内无启用模板时的兜底） */
function defaultFormModel() {
  return {
    id: null,
    name: DEFAULT_TEMPLATE_NAME,
    grades: [],
    levels: [],
    groups: normalizeGroups(DEFAULT_FORM_GROUPS),
    version: 1,
  };
}

/** 由分组快照构建模型（渲染历史记录问答用） */
function formModelFromGroups(groups) {
  return {
    id: null,
    name: DEFAULT_TEMPLATE_NAME,
    grades: [],
    levels: [],
    groups: normalizeGroups(groups ?? []),
    version: 1,
  };
}

/**
 * 校验模板入参并规整；返回 { name, grades, levels, groups }。
 * grades 空数组 = 全部年级适用（传入年级必须存在于年级字典）；
 * levels 空数组 = 不限关注等级（传入等级必须是合法档位）。
 */
function validateInput(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 50) throw fail('模板名称需为 1-50 个字');

  const grades = Array.isArray(body?.grades)
    ? [...new Set(body.grades.map((g) => String(g ?? '').trim()).filter(Boolean))]
    : [];
  if (grades.some((g) => g.length > 20)) throw fail('年级名称不可超过 20 个字');
  if (grades.length > 0) {
    const known = new Set(dbx.all('SELECT name FROM grades').map((r) => r.name));
    const unknown = grades.filter((g) => !known.has(g));
    if (unknown.length > 0) throw fail(`年级不存在：${unknown.join('、')}`);
  }

  const levels = Array.isArray(body?.levels)
    ? [...new Set(body.levels.map((l) => String(l ?? '').trim()).filter(Boolean))]
    : [];
  if (levels.some((l) => !LEVELS.includes(l))) {
    throw fail(`适用关注等级需为：${LEVELS.join('、')}`);
  }

  const rawGroups = Array.isArray(body?.groups) ? body.groups : [];
  if (rawGroups.length === 0) throw fail('至少需要一个题目分组');
  if (rawGroups.length > MAX_GROUPS) throw fail(`题目分组不可超过 ${MAX_GROUPS} 个`);

  const usedKeys = new Set();
  const groups = rawGroups.map((g, gi) => {
    const title = String(g?.title ?? '').trim();
    if (!title || title.length > 50) throw fail(`第 ${gi + 1} 个分组标题需为 1-50 个字`);
    const questions = Array.isArray(g?.questions) ? g.questions : [];
    if (questions.length === 0) throw fail(`分组「${title}」至少需要一道题`);
    if (questions.length > MAX_QUESTIONS_PER_GROUP) {
      throw fail(`分组「${title}」题目不可超过 ${MAX_QUESTIONS_PER_GROUP} 道`);
    }
    const qs = questions.map((q, qi) => {
      const text = String(q?.text ?? '').trim();
      if (!text || text.length > 500) throw fail(`「${title}」第 ${qi + 1} 题题干需为 1-500 个字`);
      const placeholder = String(q?.placeholder ?? '').trim();
      if (placeholder.length > 200) throw fail(`「${title}」第 ${qi + 1} 题提示语不可超过 200 字`);
      const max = Number(q?.max);
      if (!Number.isInteger(max) || max < 10 || max > 5000) {
        throw fail(`「${title}」第 ${qi + 1} 题字数上限需为 10-5000 的整数`);
      }
      // 字数下限：缺省 / 非整数 / 越界 → 视为未设置（0 = 不限制）；
      // 显式传了非法值则拒绝保存，避免模板里存下永远无法达成的题目。
      const rawMin = q?.min === undefined || q?.min === null || q?.min === '' ? 0 : Number(q.min);
      if (!Number.isInteger(rawMin) || rawMin < MIN_CHARS_MIN || rawMin > MIN_CHARS_MAX) {
        throw fail(`「${title}」第 ${qi + 1} 题字数下限需为 ${MIN_CHARS_MIN}-${MIN_CHARS_MAX} 的整数（0 表示不限制）`);
      }
      if (rawMin > max) {
        throw fail(`「${title}」第 ${qi + 1} 题字数下限（${rawMin}）不可超过字数上限（${max}）`);
      }
      const rows = Number(q?.rows);
      if (!Number.isInteger(rows) || rows < 1 || rows > 20) {
        throw fail(`「${title}」第 ${qi + 1} 题行数需为 1-20 的整数`);
      }
      let key = String(q?.key ?? '').trim();
      if (!KEY_RE.test(key) || usedKeys.has(key)) key = genKey();
      usedKeys.add(key);
      return { key, text, placeholder: placeholder || undefined, min: rawMin, max, rows };
    });
    return { title, questions: qs };
  });

  return { name, grades, levels, groups };
}

/**
 * 按模型校验 answers（逐题必填 + 字数上下限；白名单外 key 直接忽略）。
 * 字数统计与既有逻辑完全一致：先 trim 再取 length（不含首尾空白/换行），
 * 下限 0 表示不限制（历史题目未设置下限时行为不变）。
 */
function validateAnswers(model, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('访谈内容不完整');
  const answers = {};
  for (const group of model.groups) {
    for (const q of group.questions) {
      const v = String(raw[q.key] ?? '').trim();
      if (!v) throw fail(`请填写「${q.text.slice(0, 16)}…」`);
      if (v.length > q.max) throw fail(`「${q.text.slice(0, 16)}…」不可超过 ${q.max} 字`);
      if (q.min > 0 && v.length < q.min) {
        throw fail(`「${q.text.slice(0, 16)}…」不少于 ${q.min} 字（当前 ${v.length} 字），请补充后再提交`);
      }
      answers[q.key] = v;
    }
  }
  return answers;
}

/* ---------- 查询 ---------- */

function listTemplates() {
  return dbx.all('SELECT * FROM mentalInterviewTemplates ORDER BY updatedAt DESC, id').map(templateView);
}

function getTemplate(id) {
  const row = dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [String(id ?? '')]);
  if (!row) throw fail('模板不存在', 404);
  return templateView(row);
}

/**
 * 按学生年级 + 当前关注等级解析生效表单模型（见文件头规则）。
 * 匹配打分：年级/等级「明确命中」各 2 分、「不限」各 1 分、明确不含该生则排除；
 * 同分取最近更新的模板。无任何兼容模板时回退内置默认记录单
 * （默认种子模板年级/等级均不限，正常情况下恒有兜底）。
 */
function resolveFormModel(grade, level) {
  const rows = dbx.all(
    'SELECT * FROM mentalInterviewTemplates WHERE enabled = 1 ORDER BY updatedAt DESC, version DESC, id',
  );
  if (rows.length === 0) return defaultFormModel();
  const g = String(grade ?? '').trim();
  const lv = String(level ?? '').trim();
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const grades = gradesOf(row);
    const levels = levelsOf(row);
    const gradeScore = grades.length === 0 ? 1 : (g && grades.includes(g) ? 2 : 0);
    if (gradeScore === 0) continue;
    const levelScore = levels.length === 0 ? 1 : (lv && levels.includes(lv) ? 2 : 0);
    if (levelScore === 0) continue;
    const score = gradeScore + levelScore;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best ? formModel(best) : defaultFormModel();
}

/* ---------- 写操作（权限由路由层判定） ---------- */

function createTemplate(user, body) {
  const { name, grades, levels, groups } = validateInput(body);
  const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = nowStr();
  dbx.run(
    `INSERT INTO mentalInterviewTemplates
       (id, name, grades, levels, groups, enabled, version, createdBy, updatedBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    [id, name, JSON.stringify(grades), JSON.stringify(levels), JSON.stringify(groups), user?.displayName ?? '', user?.displayName ?? '', now, now],
  );
  return templateView(dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [id]));
}

function updateTemplate(user, id, body) {
  const row = dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [String(id ?? '')]);
  if (!row) throw fail('模板不存在', 404);
  const next = validateInput(body);

  const changed = row.name !== next.name
    || JSON.stringify(gradesOf(row)) !== JSON.stringify(next.grades)
    || JSON.stringify(levelsOf(row)) !== JSON.stringify(next.levels)
    || JSON.stringify(groupsOf(row)) !== JSON.stringify(next.groups);
  const version = changed ? (row.version ?? 1) + 1 : (row.version ?? 1);
  const enabled = body?.enabled === undefined ? !!row.enabled : !!body.enabled;

  dbx.run(
    `UPDATE mentalInterviewTemplates
       SET name = ?, grades = ?, levels = ?, groups = ?, enabled = ?, version = ?, updatedBy = ?, updatedAt = ?
     WHERE id = ?`,
    [
      next.name,
      JSON.stringify(next.grades),
      JSON.stringify(next.levels),
      JSON.stringify(next.groups),
      enabled ? 1 : 0,
      version,
      user?.displayName ?? '',
      nowStr(),
      row.id,
    ],
  );
  return templateView(dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [row.id]));
}

/** 删除模板；至少保留一个（否则访谈无单可填） */
function deleteTemplate(id) {
  const row = dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [String(id ?? '')]);
  if (!row) throw fail('模板不存在', 404);
  const count = dbx.get('SELECT COUNT(*) AS c FROM mentalInterviewTemplates').c;
  if (count <= 1) throw fail('至少需要保留一个访谈记录单模板，不能再删除');
  dbx.run('DELETE FROM mentalInterviewTemplates WHERE id = ?', [row.id]);
  return { ok: true, name: row.name };
}

module.exports = {
  LEVELS,
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TEMPLATE_NAME,
  MAX_GROUPS,
  MAX_QUESTIONS_PER_GROUP,
  MIN_CHARS_MIN,
  MIN_CHARS_MAX,
  genKey,
  normalizeGroups,
  gradesOf,
  levelsOf,
  groupsOf,
  templateView,
  formModel,
  formModelFromGroups,
  defaultFormModel,
  validateInput,
  validateAnswers,
  listTemplates,
  getTemplate,
  resolveFormModel,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};

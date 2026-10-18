/**
 * 心理访谈记录单模板（表 mentalInterviewTemplates）。
 *
 * 职责：
 * - 模板增删改查（写权限由路由层判定：管理员或心理健康主负责）；
 * - 按学生年级解析生效模板（年级精确匹配优先，其次「全部年级」模板，再按最近编辑）；
 * - 访谈 answers 的动态白名单校验（题目以模板为准，取代旧硬编码题单）。
 *
 * 解析规则（resolveFormModel）：
 *   1. 适用年级包含学生年级的模板中取最近编辑的一个；
 *   2. 否则取「全部年级适用（grades 为空）」中最近编辑的一个；
 *   3. 库内无启用模板时回退内置默认记录单（lib/interviewFormDefault.js）。
 * 访谈记录落库时携带 templateId/templateVersion/formSnapshot，
 * 模板后续改题不影响历史记录的问答渲染与再编辑校验。
 */
const dbx = require('./db');
const { nowStr } = require('./audit');
const { DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, DEFAULT_FORM_GROUPS } = require('./interviewFormDefault');

const MAX_GROUPS = 20;
const MAX_QUESTIONS_PER_GROUP = 30;
const KEY_RE = /^[A-Za-z0-9_]{1,64}$/;

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

function groupsOf(row) {
  return parseJsonArray(row?.groups).filter((g) => g && typeof g === 'object');
}

/** 生成题目 key（同一模板内唯一；既有题目沿用原 key，保证历史答案不丢） */
function genKey() {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 规整分组结构（trim + 默认值 + key 补齐）；输出与前端 InterviewFormModel 同构 */
function normalizeGroups(rawGroups) {
  const used = new Set();
  return rawGroups.map((g) => ({
    title: String(g?.title ?? '').trim(),
    questions: (Array.isArray(g?.questions) ? g.questions : []).map((q) => {
      let key = String(q?.key ?? '').trim();
      if (!KEY_RE.test(key) || used.has(key)) key = genKey();
      used.add(key);
      const placeholder = String(q?.placeholder ?? '').trim();
      return {
        key,
        text: String(q?.text ?? '').trim(),
        ...(placeholder ? { placeholder } : {}),
        max: Number(q?.max) || 500,
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
    groups: normalizeGroups(groups ?? []),
    version: 1,
  };
}

/**
 * 校验模板入参并规整；返回 { name, grades, groups }。
 * grades 空数组 = 全部年级适用；传入的年级必须存在于年级字典。
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
      const rows = Number(q?.rows);
      if (!Number.isInteger(rows) || rows < 1 || rows > 20) {
        throw fail(`「${title}」第 ${qi + 1} 题行数需为 1-20 的整数`);
      }
      let key = String(q?.key ?? '').trim();
      if (!KEY_RE.test(key) || usedKeys.has(key)) key = genKey();
      usedKeys.add(key);
      return { key, text, placeholder: placeholder || undefined, max, rows };
    });
    return { title, questions: qs };
  });

  return { name, grades, groups };
}

/** 按模型校验 answers（逐题必填 + 字数上限；白名单外 key 直接忽略） */
function validateAnswers(model, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('访谈内容不完整');
  const answers = {};
  for (const group of model.groups) {
    for (const q of group.questions) {
      const v = String(raw[q.key] ?? '').trim();
      if (!v) throw fail(`请填写「${q.text.slice(0, 16)}…」`);
      if (v.length > q.max) throw fail(`「${q.text.slice(0, 16)}…」不可超过 ${q.max} 字`);
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

/** 按年级解析生效表单模型（见文件头规则） */
function resolveFormModel(grade) {
  const rows = dbx.all(
    'SELECT * FROM mentalInterviewTemplates WHERE enabled = 1 ORDER BY updatedAt DESC, version DESC, id',
  );
  if (rows.length === 0) return defaultFormModel();
  const g = String(grade ?? '').trim();
  const specific = g ? rows.filter((r) => gradesOf(r).includes(g)) : [];
  const general = rows.filter((r) => gradesOf(r).length === 0);
  return formModel(specific[0] ?? general[0] ?? rows[0]);
}

/* ---------- 写操作（权限由路由层判定） ---------- */

function createTemplate(user, body) {
  const { name, grades, groups } = validateInput(body);
  const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = nowStr();
  dbx.run(
    `INSERT INTO mentalInterviewTemplates
       (id, name, grades, groups, enabled, version, createdBy, updatedBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    [id, name, JSON.stringify(grades), JSON.stringify(groups), user?.displayName ?? '', user?.displayName ?? '', now, now],
  );
  return templateView(dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [id]));
}

function updateTemplate(user, id, body) {
  const row = dbx.get('SELECT * FROM mentalInterviewTemplates WHERE id = ?', [String(id ?? '')]);
  if (!row) throw fail('模板不存在', 404);
  const next = validateInput(body);

  const changed = row.name !== next.name
    || JSON.stringify(gradesOf(row)) !== JSON.stringify(next.grades)
    || JSON.stringify(groupsOf(row)) !== JSON.stringify(next.groups);
  const version = changed ? (row.version ?? 1) + 1 : (row.version ?? 1);
  const enabled = body?.enabled === undefined ? !!row.enabled : !!body.enabled;

  dbx.run(
    `UPDATE mentalInterviewTemplates
       SET name = ?, grades = ?, groups = ?, enabled = ?, version = ?, updatedBy = ?, updatedAt = ?
     WHERE id = ?`,
    [
      next.name,
      JSON.stringify(next.grades),
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
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TEMPLATE_NAME,
  MAX_GROUPS,
  MAX_QUESTIONS_PER_GROUP,
  genKey,
  normalizeGroups,
  gradesOf,
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

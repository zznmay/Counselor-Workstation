/** SQLite 数据库：建表、迁移与种子数据（node:sqlite，零原生编译依赖） */
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const { DB_PATH, ensureDirs } = require('./config');
const { COUNSELOR_DEFAULT_KEYS, COUNSELOR_LEGACY_KEYS, HEAD_TEACHER_DEFAULT_KEYS } = require('./modules');
const SEED = require('./seed-data');

ensureDirs();

const db = new DatabaseSync(DB_PATH);
// WAL 模式：允许多教师并发读、写入串行化
db.prepare('PRAGMA journal_mode = WAL').get();
db.prepare('PRAGMA foreign_keys = ON').get();
// 备份/外部 sqlite 进程持锁时，写事务等待 5s 再报错，避免直接 SQLITE_BUSY
db.prepare('PRAGMA busy_timeout = 5000').get();

// 建表语句逐条执行（prepare().run() 支持 DDL）
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'counselor',
    passwordHash TEXT NOT NULL,
    mustChangePassword INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )`,
  /* 角色：users.role 存 roles.key；permissions 为模块 key 的 JSON 数组；
     ownerModules 为「主负责辅导员」模块 key 的 JSON 数组（该模块最高权限：全院数据 + 全部操作） */
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    isSystem INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    ownerModules TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    studentNo TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gender TEXT,
    grade TEXT,
    major TEXT,
    className TEXT,
    classId INTEGER,
    phone TEXT,
    dorm TEXT,
    politicalStatus TEXT,
    origin TEXT,
    status TEXT DEFAULT '在读',
    headTeacher TEXT,
    counselor TEXT,
    fatherName TEXT,
    fatherPhone TEXT,
    motherName TEXT,
    motherPhone TEXT,
    position TEXT,
    remark TEXT,
    enrollDate TEXT,
    ownerId INTEGER,
    createdBy TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS studentCounselors (
    studentId TEXT NOT NULL,
    userId INTEGER NOT NULL,
    PRIMARY KEY (studentId, userId)
  )`,
  `CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gradeId INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE (gradeId, name)
  )`,
  `CREATE TABLE IF NOT EXISTS classCounselors (
    classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (classId, userId)
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    talkTime TEXT,
    way TEXT,
    type TEXT,
    needFollowUp INTEGER DEFAULT 0,
    content TEXT,
    followUp TEXT,
    createdBy TEXT,
    createdAt TEXT
  )`,
  /* 心理健康：学生关注标记（1:1 档案）；level ∈ 密切关注/重点关注/日常关注/一般关注。
     学生删除时随 FK 级联清理（PRAGMA foreign_keys = ON） */
  `CREATE TABLE IF NOT EXISTS mentalHealth (
    studentId TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    note TEXT,
    updatedBy TEXT,
    updatedAt TEXT NOT NULL
  )`,
  /* 心理访谈：一般关注学生每学期至少 2 次，记录与纸质《心理访谈记录单》逐字段对齐。
     不设 studentId 外键：学生删除后访谈记录与等级轨迹仍需留档（与 conversations 同策略），
     姓名/班级/年级冗余快照，避免 JOIN 不到时审计信息丢失。 */
  `CREATE TABLE IF NOT EXISTS mentalInterviews (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    studentName TEXT NOT NULL,
    className TEXT,
    grade TEXT,
    semesterKey TEXT NOT NULL,
    semesterLabel TEXT NOT NULL,
    interviewDate TEXT NOT NULL,
    interviewerId INTEGER,
    interviewerName TEXT NOT NULL,
    levelBefore TEXT,
    levelAfter TEXT NOT NULL,
    answers TEXT NOT NULL,
    summary TEXT NOT NULL,
    signatureName TEXT NOT NULL,
    signedAt TEXT NOT NULL,
    formVersion INTEGER NOT NULL DEFAULT 1,
    clientRequestId TEXT NOT NULL UNIQUE,
    updatedBy TEXT,
    updatedAt TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mi_student_sem ON mentalInterviews(studentId, semesterKey)`,
  `CREATE INDEX IF NOT EXISTS idx_mi_sem_deleted ON mentalInterviews(semesterKey, deletedAt)`,
  /* 心理访谈记录单模板：表单内容（题目分组/题干/上限）由管理员或心理辅导员维护，
     grades 为适用年级名 JSON 数组（空数组 = 全部年级适用），
     levels 为适用关注等级 JSON 数组（空数组 = 不限等级）；groups 结构见
     lib/interviewTemplate.js（与前端 InterviewFormModel 同构）。 */
  `CREATE TABLE IF NOT EXISTS mentalInterviewTemplates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grades TEXT NOT NULL DEFAULT '[]',
    levels TEXT NOT NULL DEFAULT '[]',
    groups TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    createdBy TEXT,
    updatedBy TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  /* 关注等级变更审计：手工调整与访谈评估联动都落一条，永不删除 */
  `CREATE TABLE IF NOT EXISTS mentalLevelLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId TEXT NOT NULL,
    studentName TEXT NOT NULL,
    fromLevel TEXT,
    toLevel TEXT,
    source TEXT NOT NULL,
    refId TEXT,
    operatorId INTEGER,
    operatorName TEXT,
    note TEXT,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mll_student ON mentalLevelLogs(studentId, id DESC)`,
  /* 用户-角色 多对多：users.role 保留为「主角色」（集合含 admin 时主角色即 admin），
     本表为完整角色集合的唯一事实来源；账号删除时级联清理 */
  `CREATE TABLE IF NOT EXISTS userRoles (
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roleKey TEXT NOT NULL,
    PRIMARY KEY (userId, roleKey)
  )`,
  `CREATE TABLE IF NOT EXISTS warnings (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    type TEXT,
    level TEXT,
    reason TEXT,
    raisedAt TEXT,
    status TEXT DEFAULT '待处理',
    handleNote TEXT,
    handledAt TEXT,
    createdBy TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notices (
    id TEXT PRIMARY KEY,
    title TEXT,
    type TEXT,
    scope TEXT,
    content TEXT,
    status TEXT DEFAULT '草稿',
    pinned INTEGER DEFAULT 0,
    publishAt TEXT,
    createdAt TEXT,
    author TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    type TEXT,
    studentId TEXT NOT NULL,
    summary TEXT,
    detail TEXT,
    submittedAt TEXT,
    status TEXT DEFAULT '待审批',
    comment TEXT,
    approvedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT,
    type TEXT,
    priority TEXT,
    dueDate TEXT,
    dueTime TEXT,
    status TEXT DEFAULT '未完成',
    relatedStudent TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS templateCategories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS templateFiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    categoryId TEXT,
    format TEXT,
    size INTEGER DEFAULT 0,
    description TEXT,
    uploader TEXT,
    updatedAt TEXT,
    uploaded INTEGER DEFAULT 0,
    storedName TEXT,
    assetUrl TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS csScheduler (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT,
    updatedAt TEXT,
    updatedBy TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS accessLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    username TEXT,
    userId INTEGER,
    ip TEXT,
    method TEXT,
    path TEXT,
    action TEXT,
    status TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loginAttempts (
    username TEXT PRIMARY KEY,
    fails INTEGER DEFAULT 0,
    lockedUntil TEXT
  )`,
];
for (const sql of SCHEMA_STATEMENTS) {
  db.prepare(sql).run();
}

/** 老库升级：students.classId 列不存在时补加（新库建表语句已含该列，此处幂等跳过） */
const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
if (!studentCols.includes('classId')) {
  db.prepare('ALTER TABLE students ADD COLUMN classId INTEGER').run();
}

/** 老库升级：roles.ownerModules 列不存在时补加（新库建表语句已含该列，此处幂等跳过） */
const roleCols = db.prepare('PRAGMA table_info(roles)').all().map((c) => c.name);
if (!roleCols.includes('ownerModules')) {
  db.prepare("ALTER TABLE roles ADD COLUMN ownerModules TEXT NOT NULL DEFAULT '[]'").run();
}

/**
 * 老库升级：mentalInterviews 补加模板相关列（新库建表语句已含，此处幂等跳过）。
 * templateId/templateVersion/formSnapshot：记录填写时所用的记录单模板与题目快照，
 * 模板后续改题不影响历史记录的问答渲染。
 */
const interviewCols = db.prepare('PRAGMA table_info(mentalInterviews)').all().map((c) => c.name);
for (const [col, ddl] of [
  ['templateId', 'ALTER TABLE mentalInterviews ADD COLUMN templateId TEXT'],
  ['templateVersion', 'ALTER TABLE mentalInterviews ADD COLUMN templateVersion INTEGER'],
  ['formSnapshot', 'ALTER TABLE mentalInterviews ADD COLUMN formSnapshot TEXT'],
]) {
  if (!interviewCols.includes(col)) db.prepare(ddl).run();
}

/** 老库升级：mentalInterviewTemplates 补加适用关注等级列（新库建表语句已含，幂等跳过） */
const tplCols = db.prepare('PRAGMA table_info(mentalInterviewTemplates)').all().map((c) => c.name);
if (!tplCols.includes('levels')) {
  db.prepare("ALTER TABLE mentalInterviewTemplates ADD COLUMN levels TEXT NOT NULL DEFAULT '[]'").run();
}

/**
 * 内置角色（幂等）：admin 全量权限；counselor 默认可见业务模块；
 * headTeacher（班主任）仅心理健康 + 心理访谈（数据范围由用户管理里的带班班级决定）。
 * 已存在时不覆盖 —— 管理员对内置角色权限的调整在重启后保留。
 */
function ensureBuiltinRoles() {
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ins = db.prepare(
    `INSERT OR IGNORE INTO roles (key, name, description, isSystem, permissions, ownerModules, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run('admin', '系统管理员', '内置角色，拥有全部模块权限', 1, JSON.stringify(['*']), '[]', now(), now());
  ins.run('counselor', '辅导员', '内置角色，可访问日常业务模块', 1, JSON.stringify(COUNSELOR_DEFAULT_KEYS), '[]', now(), now());
  ins.run(
    'headTeacher',
    '班主任',
    '内置角色：查看所带班级心理健康 + 填写心理访谈（数据范围由带班班级决定）',
    1,
    JSON.stringify(HEAD_TEACHER_DEFAULT_KEYS),
    '[]',
    now(),
    now(),
  );
  // roles.name 有 UNIQUE 约束：若已存在同名「班主任」自定义角色，INSERT OR IGNORE 会静默失败
  if (!db.prepare("SELECT 1 FROM roles WHERE key = 'headTeacher'").get()) {
    console.warn('[db] 内置「班主任」角色创建失败：角色名「班主任」已被其他角色占用，请改名后重启服务端。');
  }

  // 老库无痕升级：counselor 权限仍为初始默认集（管理员未自定义过）时，补配后加模块。
  // 权限一经管理员调整则保持现状，由管理员在「角色管理」自行勾选新模块。
  const counselor = db.prepare("SELECT permissions FROM roles WHERE key = 'counselor'").get();
  if (counselor) {
    let perms = [];
    try { perms = JSON.parse(counselor.permissions ?? '[]'); } catch { perms = []; }
    const untouched = Array.isArray(perms)
      && perms.length === COUNSELOR_LEGACY_KEYS.length
      && COUNSELOR_LEGACY_KEYS.every((k) => perms.includes(k));
    if (untouched) {
      db.prepare("UPDATE roles SET permissions = ?, updatedAt = ? WHERE key = 'counselor'")
        .run(JSON.stringify(COUNSELOR_DEFAULT_KEYS), now());
      console.log('[db] 已为内置「辅导员」角色补配新增模块（心理健康）权限。');
    }
  }
}

/**
 * 学生班级归属回填（幂等）：
 * 将存量学生的 (grade, className) 组合生成年级/班级字典，并回填 classId。
 * 仅处理 classId IS NULL 且两个文本字段非空的行；年级/班级按名称 find-or-create，
 * 多次启动不会产生重复字典。文本为空/NULL 的行保持 classId 为 NULL。
 */
function ensureStudentClassBackfill() {
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const pending = db.prepare(
    `SELECT DISTINCT TRIM(grade) AS grade, TRIM(className) AS className FROM students
     WHERE classId IS NULL
       AND TRIM(COALESCE(grade, '')) <> ''
       AND TRIM(COALESCE(className, '')) <> ''`,
  ).all();
  if (pending.length === 0) return;

  const findGrade = db.prepare('SELECT id FROM grades WHERE name = ?');
  const insGrade = db.prepare('INSERT INTO grades (name, createdAt) VALUES (?, ?)');
  const findClass = db.prepare('SELECT id FROM classes WHERE gradeId = ? AND name = ?');
  const insClass = db.prepare('INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)');
  const link = db.prepare(
    'UPDATE students SET classId = ? WHERE classId IS NULL AND TRIM(grade) = ? AND TRIM(className) = ?',
  );

  let created = 0;
  for (const { grade, className } of pending) {
    let g = findGrade.get(grade);
    if (!g) g = { id: Number(insGrade.run(grade, now()).lastInsertRowid) };
    let c = findClass.get(g.id, className);
    if (!c) c = { id: Number(insClass.run(g.id, className, now()).lastInsertRowid) };
    link.run(c.id, grade, className);
    created += 1;
  }
  console.log(`[db] 学生班级归属回填完成：处理 ${created} 组（年级, 班级）组合。`);
}

/** 首次初始化：管理员 + 示例辅导员账号 + 示例业务数据 */
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const insUser = db.prepare(
    'INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const sampleHash = bcrypt.hashSync('Hzky@123456', 10);
  insUser.run('admin', '系统管理员', 'admin', bcrypt.hashSync('Admin@2026', 10), 1, now());

  const counselorUserIds = [];
  for (const [username, displayName] of SEED.counselors) {
    const info = insUser.run(username, displayName, 'counselor', sampleHash, 1, now());
    counselorUserIds.push(Number(info.lastInsertRowid));
  }

  const ownerOf = (i) => counselorUserIds[i % counselorUserIds.length];

  const insStudent = db.prepare(`INSERT INTO students
    (id, studentNo, name, gender, grade, major, className, phone, dorm, politicalStatus, origin, status,
     headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
     ownerId, createdBy, createdAt, updatedAt)
    VALUES (@id, @studentNo, @name, @gender, @grade, @major, @className, @phone, @dorm, @politicalStatus,
     @origin, @status, @headTeacher, @counselor, @fatherName, @fatherPhone, @motherName, @motherPhone,
     @position, @remark, @enrollDate, @ownerId, @createdBy, @createdAt, @updatedAt)`);
  SEED.students.forEach((s, i) => {
    const owner = ownerOf(i);
    insStudent.run({ ...s, ownerId: owner, createdBy: owner, createdAt: now(), updatedAt: now() });
  });

  const insConv = db.prepare(`INSERT INTO conversations
    (id, studentId, talkTime, way, type, needFollowUp, content, followUp, createdBy, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.conversations.forEach((c) => {
    insConv.run(
      c.id, c.studentId, c.talkTime, c.way, c.type, c.needFollowUp ? 1 : 0,
      c.content, c.followUp ?? null, counselorUserIds[0], c.talkTime,
    );
  });

  const insWarn = db.prepare(`INSERT INTO warnings
    (id, studentId, type, level, reason, raisedAt, status, handleNote, handledAt, createdBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.warnings.forEach((w) => {
    insWarn.run(w.id, w.studentId, w.type, w.level, w.reason, w.raisedAt, w.status, w.handleNote ?? null, w.handledAt ?? null, counselorUserIds[0]);
  });

  // 心理健康关注标记（学生 id 必须存在于 students，否则跳过）
  const insMh = db.prepare(
    'INSERT OR IGNORE INTO mentalHealth (studentId, level, note, updatedBy, updatedAt) VALUES (?, ?, ?, ?, ?)',
  );
  (SEED.mentalHealth ?? []).forEach((m) => {
    insMh.run(m.studentId, m.level, m.note ?? null, '系统管理员', now());
  });

  const insNotice = db.prepare(`INSERT INTO notices
    (id, title, type, scope, content, status, pinned, publishAt, createdAt, author)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.notices.forEach((n) => {
    insNotice.run(n.id, n.title, n.type, n.scope, n.content, n.status, n.pinned ? 1 : 0, n.publishAt ?? null, n.createdAt, n.author);
  });

  const insTodo = db.prepare(`INSERT INTO todos
    (id, title, type, priority, dueDate, dueTime, status, relatedStudent, note, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.todos.forEach((t) => {
    insTodo.run(t.id, t.title, t.type, t.priority, t.dueDate, t.dueTime ?? null, t.status, t.relatedStudent ?? null, t.note ?? null, t.createdAt);
  });

  const insApproval = db.prepare(`INSERT INTO approvals
    (id, type, studentId, summary, detail, submittedAt, status, comment, approvedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.approvals.forEach((a) => {
    insApproval.run(a.id, a.type, a.studentId, a.summary, a.detail ?? null, a.submittedAt, a.status, a.comment ?? null, a.approvedAt ?? null);
  });

  const insCat = db.prepare('INSERT INTO templateCategories (id, name) VALUES (?, ?)');
  SEED.templateCategories.forEach((c) => insCat.run(c.id, c.name));

  const insFile = db.prepare(`INSERT INTO templateFiles
    (id, name, categoryId, format, size, description, uploader, updatedAt, uploaded, storedName, assetUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`);
  SEED.templateFiles.forEach((f) => {
    insFile.run(f.id, f.name, f.categoryId, f.format, f.size, f.description ?? null, f.uploader, f.updatedAt, f.assetUrl ?? null);
  });

  console.log('[db] 已完成首次初始化：管理员 admin 与示例数据已写入。');
}

ensureBuiltinRoles();
seed();
ensureStudentClassBackfill();
ensureUserRoleBackfill();
ensureMentalLevelBaselineLogs();
ensureDefaultInterviewTemplate();

/**
 * 心理访谈记录单默认模板（幂等）：库内没有任何模板时播种内置默认模板
 * （题目与纸质记录单逐字对齐，适用年级/关注等级 = 不限）。管理员后续的增改不受影响；
 * 默认模板被删除后不会重新播种（由模板管理保证至少保留一个）。
 */
function ensureDefaultInterviewTemplate() {
  const { DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, DEFAULT_FORM_GROUPS } = require('./interviewFormDefault');
  const exists = db.prepare('SELECT 1 FROM mentalInterviewTemplates LIMIT 1').get();
  if (exists) return;
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  db.prepare(
    `INSERT INTO mentalInterviewTemplates
       (id, name, grades, levels, groups, enabled, version, createdBy, updatedBy, createdAt, updatedAt)
     VALUES (?, ?, '[]', '[]', ?, 1, 1, '系统', '系统', ?, ?)`,
  ).run(DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_NAME, JSON.stringify(DEFAULT_FORM_GROUPS), now, now);
  console.log('[db] 心理访谈记录单默认模板已播种。');
}

/**
 * 用户角色集合回填（幂等）：多角色改造前 users.role 是唯一角色来源，
 * 将每个账号的主角色补写进 userRoles，保证旧数据升级后角色集合完整。
 */
function ensureUserRoleBackfill() {
  const rows = db.prepare(
    `SELECT u.id, u.role FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM userRoles ur WHERE ur.userId = u.id)`,
  ).all();
  if (rows.length === 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)');
  for (const r of rows) ins.run(r.id, r.role);
  console.log(`[db] 用户角色集合回填完成：${rows.length} 个账号。`);
}

/**
 * 关注等级基线日志（幂等）：升级前已有的关注标记没有变更历史，
 * 为其补一条 source='init' 的基线记录，保证审计时间线从升级时点起完整。
 * 仅处理「该学生一条日志都没有」的行，重启不会重复插入。
 */
function ensureMentalLevelBaselineLogs() {
  const rows = db.prepare(
    `SELECT mh.studentId, mh.level, mh.updatedBy, mh.updatedAt, s.name AS studentName
     FROM mentalHealth mh
     LEFT JOIN students s ON s.id = mh.studentId
     WHERE NOT EXISTS (SELECT 1 FROM mentalLevelLogs l WHERE l.studentId = mh.studentId)`,
  ).all();
  if (rows.length === 0) return;
  const ins = db.prepare(
    `INSERT INTO mentalLevelLogs
       (studentId, studentName, fromLevel, toLevel, source, refId, operatorId, operatorName, note, createdAt)
     VALUES (?, ?, NULL, ?, 'init', NULL, NULL, ?, ?, ?)`,
  );
  for (const r of rows) {
    ins.run(
      r.studentId,
      r.studentName ?? '（已删除学生）',
      r.level,
      r.updatedBy ?? '系统',
      '系统升级初始化：记录升级前已有的关注等级',
      r.updatedAt ?? new Date().toISOString().slice(0, 16).replace('T', ' '),
    );
  }
  console.log(`[db] 心理健康等级日志基线回填完成：${rows.length} 名学生。`);
}

/** 统一参数规范化：undefined→null、Date→ISO 串，并做一次 JSON 往返消毒 */
function normalizeParams(params) {
  return JSON.parse(JSON.stringify(params ?? []));
}

/** 查询多行（参数化，防注入） */
function all(sql, params = []) {
  return db.prepare(sql).all(...normalizeParams(params));
}

/** 查询单行，无结果返回 null */
function get(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

/** 执行写语句，返回 { changes, lastInsertRowid } */
function run(sql, params = []) {
  return db.prepare(sql).run(...normalizeParams(params));
}

/**
 * 同步事务：BEGIN IMMEDIATE 立即取写锁，避免并发写升级为死锁。
 * 注意：回调内不得出现 await（node:sqlite 是同步 API，await 会让出事件循环破坏事务边界）。
 */
function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 无活动事务时忽略 */ }
    throw err;
  }
}

module.exports = { db, all, get, run, withTransaction };

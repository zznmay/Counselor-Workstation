/** SQLite 数据库：建表、迁移与种子数据（node:sqlite，零原生编译依赖） */
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const { DB_PATH, ensureDirs } = require('./config');
const {
  COUNSELOR_DEFAULT_KEYS,
  COUNSELOR_LEGACY_KEYS,
  COUNSELOR_DEFAULT_ACTIONS,
  HEAD_TEACHER_DEFAULT_KEYS,
  HEAD_TEACHER_DEFAULT_ACTIONS,
  COUNSELOR_DEFAULT_SCOPES,
} = require('./modules');
const SEED = require('./seed-data');
const demo = require('./demo');

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
    createdAt TEXT NOT NULL,
    /* 教师唯一来源改造：工号即 username（不再另设 employeeNo）；
       mobile 为导入模板「手机号」落点，teacherSource 标记档案来源通道（import/manual） */
    mobile TEXT,
    teacherSource TEXT
  )`,
  /* 角色：users.role 存 roles.key；permissions 为模块 key 的 JSON 数组；
     ownerModules 为「主负责辅导员」模块 key 的 JSON 数组（该模块最高权限：全院数据 + 全部操作）；
     actions 为操作权限键的 JSON 数组（`module:*` 或 `module:<actionKey>` 精确键）；
     dataScopes 为 `{moduleKey: 'all'|'managed'}` 的 JSON 对象（未配置模块默认带班）；
     disabled=1 的角色停止贡献一切授权（不删除用户分配关系） */
  `CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    isSystem INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    ownerModules TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    dataScopes TEXT NOT NULL DEFAULT '{}',
    disabled INTEGER NOT NULL DEFAULT 0,
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
    statusChangedAt TEXT,
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
  /* 班级-人员-身份 三维关联：roleType = counselor（辅导员）| headTeacher（班主任）。
     教师数据的唯一来源（班级管理录入工号 + 同步用户管理建号）；历史库由 lib/teacherSourceMigrate.js 升级。 */
  `CREATE TABLE IF NOT EXISTS classCounselors (
    classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roleType TEXT NOT NULL DEFAULT 'counselor' CHECK (roleType IN ('counselor', 'headTeacher')),
    createdAt TEXT,
    PRIMARY KEY (classId, userId, roleType)
  )`,
  /* 班级待同步人员：班级导入/表单录入的工号未匹配到在职账号时先落此表（不授任何权限），
     「同步用户管理」一键建号并写入 classCounselors 后删除对应行；本表永远只存"尚未落地"的人。 */
  `CREATE TABLE IF NOT EXISTS classPendingStaff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    employeeNo TEXT NOT NULL,
    displayName TEXT NOT NULL,
    roleType TEXT NOT NULL DEFAULT 'counselor' CHECK (roleType IN ('counselor', 'headTeacher')),
    source TEXT NOT NULL DEFAULT 'import',
    createdAt TEXT NOT NULL,
    UNIQUE (classId, employeeNo, roleType)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cps_employee ON classPendingStaff(employeeNo)`,
  `CREATE INDEX IF NOT EXISTS idx_cps_class_role ON classPendingStaff(classId, roleType)`,
  /* 注意：classCounselors 的索引（idx_cc_user / idx_cc_role）不在此处创建。
     老库的该表仍是二维结构（无 roleType 列），若在迁移前建索引会抛
     "no such column: roleType" 导致启动崩溃（云端既有实例已复现）。
     索引统一由 lib/teacherSourceMigrate.js 在表结构升级完成后创建，
     「已升级」与「需重建」两条路径均已覆盖。 */
  /* 教师批量导入批次：预览态暂存待确认数据，确认后落结果；clientRequestId 唯一保证重复提交幂等 */
  `CREATE TABLE IF NOT EXISTS teacherImportBatches (
    id TEXT PRIMARY KEY,
    clientRequestId TEXT UNIQUE,
    operator TEXT,
    traceId TEXT,
    status TEXT NOT NULL,
    rowCount INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    result TEXT,
    createdAt TEXT NOT NULL,
    completedAt TEXT
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
  /* 寝室管理：学生宿舍分配（学号唯一，一名学生一条分配记录）。
     宿舍楼与房间号分列存储，「宿舍楼+房间号」为学生名册的唯一展示口径；
     学生删除时由 routes/students.js 同步清理，避免留下孤儿分配。 */
  `CREATE TABLE IF NOT EXISTS dormitories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentNo TEXT NOT NULL UNIQUE,
    building TEXT NOT NULL,
    room TEXT NOT NULL,
    updatedBy TEXT,
    updatedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dorm_building ON dormitories(building)`,
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
    createdAt TEXT,
    createdBy INTEGER
  )`,
  /* 资助管理：困难生认定档案。按学年留档，学生逻辑关联（不建外键），
     同一学生同一学年最多一条「待复核/已认定」有效记录（部分唯一索引见下）。 */
  `CREATE TABLE IF NOT EXISTS fundingIdentifications (
    id TEXT PRIMARY KEY,
    studentId TEXT NOT NULL,
    academicYear TEXT NOT NULL,
    level TEXT NOT NULL,
    difficultyTypes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT '已认定',
    identifiedAt TEXT,
    validFrom TEXT,
    validTo TEXT,
    basis TEXT,
    familySize INTEGER,
    annualIncome REAL,
    perCapitaIncome REAL,
    remark TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    previousId TEXT,
    createdBy INTEGER,
    createdAt TEXT NOT NULL,
    updatedBy INTEGER,
    updatedAt TEXT NOT NULL,
    cancelledAt TEXT,
    cancelReason TEXT
  )`,
  /* 资助管理：认定变更记录（新增、编辑、调级、复核、取消、结转、导入） */
  `CREATE TABLE IF NOT EXISTS fundingIdentificationLogs (
    id TEXT PRIMARY KEY,
    identificationId TEXT NOT NULL,
    studentId TEXT NOT NULL,
    action TEXT NOT NULL,
    fromStatus TEXT,
    toStatus TEXT,
    fromLevel TEXT,
    toLevel TEXT,
    reason TEXT,
    operatorId INTEGER,
    operatorName TEXT,
    createdAt TEXT NOT NULL
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
  /* 数据管理：数据包（备份 / 恢复前快照 / 迁移包 / 上传包）的元信息。
     实际包体落盘于 data/backups/<fileName>，本表只存索引与校验信息，
     便于列表查询、分页排序与下载，不重复存整包。 */
  `CREATE TABLE IF NOT EXISTS dataBundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    note TEXT,
    fileName TEXT NOT NULL UNIQUE,
    sizeBytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL,
    schemaVersion INTEGER NOT NULL DEFAULT 1,
    counts TEXT NOT NULL DEFAULT '{}',
    createdBy TEXT,
    createdAt TEXT NOT NULL
  )`,
  /* 数据管理：键值配置（自动备份策略等业务配置）。value 存 JSON 字符串，
     仅管理员可写；不参与数据包导出，避免恢复时被旧配置覆盖。 */
  `CREATE TABLE IF NOT EXISTS dataSettings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT,
    updatedBy TEXT
  )`,
  /* 数据管理：操作日志（备份/恢复/上传/删除/配置变更），环形保留最近 500 条 */
  `CREATE TABLE IF NOT EXISTS dataOplog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    summary TEXT
  )`,
];
for (const sql of SCHEMA_STATEMENTS) {
  db.prepare(sql).run();
}

/**
 * 老库升级：教师唯一来源改造（幂等）——users 补 mobile/teacherSource，
 * classCounselors 升级为 (classId, userId, roleType) 三维关联，历史行一律视为辅导员。
 * 失败时向上抛出，启动即中止（宁可不可启动，也不在半迁移状态下写数据）。
 */
const teacherSourceMigrate = require('./teacherSourceMigrate');
const teacherMigration = teacherSourceMigrate.migrate(db);
if (teacherMigration.usersColumns.length > 0 || teacherMigration.classCounselorsRebuilt) {
  console.log(
    `[db] 教师唯一来源改造：users 补列 ${teacherMigration.usersColumns.join('、') || '（无）'}，` +
    `classCounselors ${teacherMigration.classCounselorsRebuilt ? '已升级为三维关联（历史行＝辅导员）' : '已是三维关联'}。`,
  );
}

/** 老库升级：students.classId 列不存在时补加（新库建表语句已含该列，此处幂等跳过） */
const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
if (!studentCols.includes('classId')) {
  db.prepare('ALTER TABLE students ADD COLUMN classId INTEGER').run();
}
/** 老库升级：学籍异动办理时间（非在读状态必填） */
if (!studentCols.includes('statusChangedAt')) {
  db.prepare('ALTER TABLE students ADD COLUMN statusChangedAt TEXT').run();
}

/** 老库升级：roles.ownerModules 列不存在时补加（新库建表语句已含该列，此处幂等跳过） */
const roleCols = db.prepare('PRAGMA table_info(roles)').all().map((c) => c.name);
if (!roleCols.includes('ownerModules')) {
  db.prepare("ALTER TABLE roles ADD COLUMN ownerModules TEXT NOT NULL DEFAULT '[]'").run();
}

/**
 * 老库升级：roles 补加操作权限/数据范围/停用状态三列（新库建表语句已含，幂等跳过）。
 * 回填仅在列首次补加时执行一次，保证与升级前的运行时行为逐点一致：
 * - actions：按存量模块权限回填 `module:*`（模块可访问 = 该模块全部操作，升级前口径）；
 * - dataScopes：内置「辅导员」回填默认范围（名册/寝室全量，其余带班，对应原 rosterScope 放行）；
 *   其他角色不写非默认值（缺省即带班，与原敏感口径一致）。
 */
const actionsColNew = !roleCols.includes('actions');
const dataScopesColNew = !roleCols.includes('dataScopes');
if (actionsColNew) {
  db.prepare("ALTER TABLE roles ADD COLUMN actions TEXT NOT NULL DEFAULT '[]'").run();
}
if (dataScopesColNew) {
  db.prepare("ALTER TABLE roles ADD COLUMN dataScopes TEXT NOT NULL DEFAULT '{}'").run();
}
if (!roleCols.includes('disabled')) {
  db.prepare('ALTER TABLE roles ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0').run();
}
if (actionsColNew || dataScopesColNew) {
  const backfill = db.prepare('UPDATE roles SET actions = ?, dataScopes = ? WHERE id = ?');
  for (const role of db.prepare('SELECT id, key, permissions FROM roles').all()) {
    let perms = [];
    try { perms = JSON.parse(role.permissions ?? '[]'); } catch { perms = []; }
    // admin（permissions=['*']）由解析层短路为全部权限，无需回填操作键，跳过通配避免产生 `*:*` 脏键
    const actions = JSON.stringify((Array.isArray(perms) ? perms : []).filter((k) => k !== '*').map((k) => `${k}:*`));
    const scopes = role.key === 'counselor' ? JSON.stringify(COUNSELOR_DEFAULT_SCOPES) : '{}';
    backfill.run(actions, scopes, role.id);
  }
  console.log('[db] 角色操作权限与数据范围列已补加并按存量权限回填（模块可访问=全部操作，辅导员名册/寝室全量）。');
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
 * 老库升级：todos 补加创建人列（新库建表语句已含，幂等跳过）。
 * 待办自此按创建人严格隔离：列表/详情/编辑/删除均只允许本人（routes/todos.js）。
 * 历史「全员共享」数据没有创建人，统一归属系统管理员（username='admin'，取不到则取最早用户），
 * 避免升级后历史待办对所有账号同时不可见；管理员可在界面复核后自行删除或重建。
 */
const todoCols = db.prepare('PRAGMA table_info(todos)').all().map((c) => c.name);
if (!todoCols.includes('createdBy')) {
  db.prepare('ALTER TABLE todos ADD COLUMN createdBy INTEGER').run();
  const owner = db.prepare("SELECT id FROM users WHERE username = 'admin' ORDER BY id LIMIT 1").get()
    ?? db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (owner) {
    const moved = db.prepare('UPDATE todos SET createdBy = ? WHERE createdBy IS NULL').run(owner.id);
    console.log(`[db] 历史共享待办已归属管理员（user ${owner.id}）：${moved.changes} 条。`);
  }
}

/**
 * 查询索引：必须在老库补列（students.classId / todos.createdBy）之后创建，
 * 否则旧库会因「no such column」在启动阶段崩溃。
 * 逐条 try/catch：极老库若缺少某列，只跳过对应索引，不阻断启动。
 */
const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_students_class ON students(classId)',
  'CREATE INDEX IF NOT EXISTS idx_students_status ON students(status)',
  'CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade)',
  'CREATE INDEX IF NOT EXISTS idx_conv_student_time ON conversations(studentId, talkTime DESC)',
  'CREATE INDEX IF NOT EXISTS idx_conv_talktime ON conversations(talkTime)',
  'CREATE INDEX IF NOT EXISTS idx_warn_student ON warnings(studentId)',
  'CREATE INDEX IF NOT EXISTS idx_warn_status_time ON warnings(status, raisedAt DESC)',
  "CREATE INDEX IF NOT EXISTS idx_warn_active_time ON warnings(raisedAt DESC) WHERE status != '已解除'",
  'CREATE INDEX IF NOT EXISTS idx_appr_student ON approvals(studentId)',
  'CREATE INDEX IF NOT EXISTS idx_appr_status_time ON approvals(status, submittedAt DESC)',
  "CREATE INDEX IF NOT EXISTS idx_appr_pending_time ON approvals(submittedAt DESC) WHERE status = '待审批'",
  'CREATE INDEX IF NOT EXISTS idx_todos_owner_status_due ON todos(createdBy, status, dueDate)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_active_unique
     ON fundingIdentifications(studentId, academicYear)
     WHERE status IN ('待复核', '已认定')`,
  'CREATE INDEX IF NOT EXISTS idx_funding_year_status ON fundingIdentifications(academicYear, status)',
  'CREATE INDEX IF NOT EXISTS idx_funding_year_level ON fundingIdentifications(academicYear, level)',
  'CREATE INDEX IF NOT EXISTS idx_funding_student ON fundingIdentifications(studentId)',
  'CREATE INDEX IF NOT EXISTS idx_funding_validto ON fundingIdentifications(validTo)',
  'CREATE INDEX IF NOT EXISTS idx_funding_log_profile ON fundingIdentificationLogs(identificationId, createdAt DESC)',
  'CREATE INDEX IF NOT EXISTS idx_funding_log_student ON fundingIdentificationLogs(studentId, createdAt DESC)',
  'CREATE INDEX IF NOT EXISTS idx_tpl_category ON templateFiles(categoryId)',
  'CREATE INDEX IF NOT EXISTS idx_mh_level ON mentalHealth(level)',
  'CREATE INDEX IF NOT EXISTS idx_sc_user ON studentCounselors(userId)',
];
for (const sql of INDEX_STATEMENTS) {
  try {
    db.prepare(sql).run();
  } catch (e) {
    console.warn(`[db] 索引创建跳过（${sql.match(/idx_[a-z_]+/)?.[0] ?? 'unknown'}）：${e && e.message}`);
  }
}

/**
 * 内置角色（幂等）：admin 全量权限；counselor 默认可见业务模块；
 * headTeacher（班主任）仅心理健康 + 心理访谈（数据范围由用户管理里的带班班级决定）。
 * 已存在时不覆盖 —— 管理员对内置角色权限的调整在重启后保留。
 */
function ensureBuiltinRoles() {
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const ins = db.prepare(
    `INSERT OR IGNORE INTO roles (key, name, description, isSystem, permissions, ownerModules, actions, dataScopes, disabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  ins.run('admin', '系统管理员', '内置角色，拥有全部模块权限', 1, JSON.stringify(['*']), '[]', '["*"]', '{}', now(), now());
  ins.run(
    'counselor',
    '辅导员',
    '内置角色，可访问日常业务模块（名册/寝室全量数据，其余按带班）',
    1,
    JSON.stringify(COUNSELOR_DEFAULT_KEYS),
    '[]',
    JSON.stringify(COUNSELOR_DEFAULT_ACTIONS),
    JSON.stringify(COUNSELOR_DEFAULT_SCOPES),
    now(),
    now(),
  );
  ins.run(
    'headTeacher',
    '班主任',
    '内置角色：查看所带班级心理健康 + 填写心理访谈（数据范围由带班班级决定）',
    1,
    JSON.stringify(HEAD_TEACHER_DEFAULT_KEYS),
    '[]',
    JSON.stringify(HEAD_TEACHER_DEFAULT_ACTIONS),
    '{}',
    now(),
    now(),
  );
  // roles.name 有 UNIQUE 约束：若已存在同名「班主任」自定义角色，INSERT OR IGNORE 会静默失败
  if (!db.prepare("SELECT 1 FROM roles WHERE key = 'headTeacher'").get()) {
    console.warn('[db] 内置「班主任」角色创建失败：角色名「班主任」已被其他角色占用，请改名后重启服务端。');
  }

  // 老库无痕升级：counselor 权限仍为初始默认集（管理员未自定义过）时，补配后加模块。
  // 判定「未自定义」需同时满足：模块集合仍等于初始默认集，且操作权限全是 `module:*` 通配
  // （从未做过逐操作收窄）。补配时模块与操作权限一并升级；数据范围保持现状不覆盖。
  // 权限一经管理员调整则保持现状，由管理员在「角色管理」自行勾选新模块。
  const counselor = db.prepare("SELECT permissions, actions FROM roles WHERE key = 'counselor'").get();
  if (counselor) {
    let perms = [];
    let actions = [];
    try { perms = JSON.parse(counselor.permissions ?? '[]'); } catch { perms = []; }
    try { actions = JSON.parse(counselor.actions ?? '[]'); } catch { actions = []; }
    const untouched = Array.isArray(perms)
      && perms.length === COUNSELOR_LEGACY_KEYS.length
      && COUNSELOR_LEGACY_KEYS.every((k) => perms.includes(k))
      && Array.isArray(actions)
      && actions.length > 0
      && actions.every((a) => typeof a === 'string' && a.endsWith(':*'));
    if (untouched) {
      db.prepare("UPDATE roles SET permissions = ?, actions = ?, updatedAt = ? WHERE key = 'counselor'")
        .run(JSON.stringify(COUNSELOR_DEFAULT_KEYS), JSON.stringify(COUNSELOR_DEFAULT_ACTIONS), now());
      console.log(`[db] 已为内置「辅导员」角色补配新增模块（${COUNSELOR_DEFAULT_KEYS.filter((k) => !COUNSELOR_LEGACY_KEYS.includes(k)).join('、')}）权限。`);
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

/**
 * 寝室管理数据回填（幂等）：寝室管理上线前 students.dorm 是自由文本（如「荷园B512」），
 * 上线后以「宿舍楼 + 房间号」两列为准。此处为「有宿舍文本、但无寝室记录」的学生补一条分配：
 * 首个数字之前的部分为宿舍楼，其后为房间号（荷园B512 → 荷园B / 512；无数字时整串归入宿舍楼）。
 * 已有寝室记录的行不覆盖 —— 寝室管理是宿舍数据的唯一来源。
 */
function ensureDormitoryBackfill() {
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rows = db.prepare(
    `SELECT s.studentNo, TRIM(s.dorm) AS dorm FROM students s
     WHERE TRIM(COALESCE(s.dorm, '')) <> ''
       AND TRIM(COALESCE(s.studentNo, '')) <> ''
       AND NOT EXISTS (SELECT 1 FROM dormitories d WHERE d.studentNo = s.studentNo)`,
  ).all();
  if (rows.length === 0) return;

  const ins = db.prepare(
    `INSERT OR IGNORE INTO dormitories (studentNo, building, room, updatedBy, updatedAt, createdAt)
     VALUES (?, ?, ?, '系统', ?, ?)`,
  );
  let created = 0;
  for (const r of rows) {
    const m = String(r.dorm).match(/^(\D*)(\d.*)$/);
    const building = (m ? m[1] : String(r.dorm)).trim().slice(0, 20);
    const room = (m ? m[2] : '').trim().slice(0, 20);
    ins.run(r.studentNo, building, room, now(), now());
    created += 1;
  }
  console.log(`[db] 寝室管理数据回填完成：${created} 名学生（由历史宿舍文本拆分）。`);
}

/**
 * 种子数据模式（环境变量 WORKBENCH_SEED）：
 *   demo  （默认）首次启动写入完整示例数据：8 个示例辅导员账号 + 24 名示例学生及其谈话/预警/
 *         通知/待办/审批/模板/心理健康关注标记，供本地开发与演示使用。
 *   empty （生产）仅创建管理员 admin 一个账号，不写入任何示例账号与示例业务数据；
 *         其余账号、学生与业务数据一律由管理员在后台按真实情况录入。
 * 取值缺省或非 empty 时一律按 demo 处理，保证既有开发与部署行为完全不变。
 * 叠加 WORKBENCH_DEMO=1（体验部署）时：demo 种子照常写入，但种子管理员口令随机化并禁用，
 * 访客仅可通过 /auth/demo-login 进入（见 lib/demo.js）。
 */
function seedMode() {
  const raw = String(process.env.WORKBENCH_SEED ?? 'demo').trim().toLowerCase();
  return raw === 'empty' ? 'empty' : raw === 'demo' ? 'demo' : 'demo';
}

/** 首次初始化：管理员 +（demo 模式）示例辅导员账号 +（demo 模式）示例业务数据 */
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const insUser = db.prepare(
    'INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insUser.run('admin', '系统管理员', 'admin', bcrypt.hashSync('Admin@2026', 10), 1, now());

  // 生产模式：到此为止 —— 不创建示例辅导员账号，不写入任何示例业务数据
  if (seedMode() === 'empty') {
    console.log('[db] WORKBENCH_SEED=empty：仅初始化管理员 admin，未写入任何示例账号与示例业务数据。');
    return;
  }

  // 演示模式（WORKBENCH_SEED=demo，仅供体验环境）：写入完整示例数据，
  // 但种子管理员口令随机化并禁用（体验站对外不可用 admin 登录）。
  const demoSeed = seedMode() === 'demo' && demo.isDemoMode();

  const sampleHash = bcrypt.hashSync('Hzky@123456', 10);

  const counselorUserIds = [];
  for (const [username, displayName] of SEED.counselors) {
    const info = insUser.run(username, displayName, 'counselor', sampleHash, 1, now());
    counselorUserIds.push(Number(info.lastInsertRowid));
  }
  if (demoSeed) {
    // 覆盖 admin：随机口令 + 禁用；演示数据对外只保留 demo-login 单一入口
    db.prepare('UPDATE users SET passwordHash = ?, mustChangePassword = 0, disabled = 1 WHERE username = ?')
      .run(bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10), 'admin');
    console.log('[db] 演示模式：种子管理员口令已随机化并禁用登录。');
  }

  const ownerOf = (i) => counselorUserIds[i % counselorUserIds.length];

  const insStudent = db.prepare(`INSERT INTO students
    (id, studentNo, name, gender, grade, major, className, phone, dorm, politicalStatus, origin, status, statusChangedAt,
     headTeacher, counselor, fatherName, fatherPhone, motherName, motherPhone, position, remark, enrollDate,
     ownerId, createdBy, createdAt, updatedAt)
    VALUES (@id, @studentNo, @name, @gender, @grade, @major, @className, @phone, @dorm, @politicalStatus,
     @origin, @status, @statusChangedAt, @headTeacher, @counselor, @fatherName, @fatherPhone, @motherName, @motherPhone,
     @position, @remark, @enrollDate, @ownerId, @createdBy, @createdAt, @updatedAt)`);
  SEED.students.forEach((s, i) => {
    const owner = ownerOf(i);
    insStudent.run({
      statusChangedAt: null,
      ...s,
      ownerId: owner,
      createdBy: owner,
      createdAt: now(),
      updatedAt: now(),
    });
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
    (id, title, type, priority, dueDate, dueTime, status, relatedStudent, note, createdAt, createdBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.todos.forEach((t) => {
    // 待办按创建人隔离：示例数据归属首位示例辅导员（与 conversations/warnings 同口径）
    insTodo.run(t.id, t.title, t.type, t.priority, t.dueDate, t.dueTime ?? null, t.status, t.relatedStudent ?? null, t.note ?? null, t.createdAt, counselorUserIds[0]);
  });

  const insApproval = db.prepare(`INSERT INTO approvals
    (id, type, studentId, summary, detail, submittedAt, status, comment, approvedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  SEED.approvals.forEach((a) => {
    insApproval.run(a.id, a.type, a.studentId, a.summary, a.detail ?? null, a.submittedAt, a.status, a.comment ?? null, a.approvedAt ?? null);
  });

  insertBuiltinTemplates();

  console.log('[db] 已完成首次初始化：管理员 admin 与示例数据已写入。');
}

/** 写入内置模板类别与内置模板（demo 首次初始化与生产模式引导共用同一份种子） */
function insertBuiltinTemplates() {
  const insCat = db.prepare('INSERT INTO templateCategories (id, name) VALUES (?, ?)');
  SEED.templateCategories.forEach((c) => insCat.run(c.id, c.name));

  const insFile = db.prepare(`INSERT INTO templateFiles
    (id, name, categoryId, format, size, description, uploader, updatedAt, uploaded, storedName, assetUrl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`);
  SEED.templateFiles.forEach((f) => {
    insFile.run(f.id, f.name, f.categoryId, f.format, f.size, f.description ?? null, f.uploader, f.updatedAt, f.assetUrl ?? null);
  });

  markBuiltinTemplateLibrarySeeded();
}

/** 内置模板库播种标记的键（存 dataSettings，标记「本库已播种过内置模板」） */
const BUILTIN_TEMPLATE_MARKER = 'builtinTemplateLibrarySeeded';

/** 是否已播种过内置模板库（播种后管理员自行清空，不应被自动复活） */
function isBuiltinTemplateLibrarySeeded() {
  return !!db.prepare('SELECT 1 FROM dataSettings WHERE key = ?').get(BUILTIN_TEMPLATE_MARKER);
}

/** 记录「内置模板库已播种」标记（幂等） */
function markBuiltinTemplateLibrarySeeded() {
  db.prepare(
    `INSERT INTO dataSettings (key, value, updatedAt, updatedBy)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run(BUILTIN_TEMPLATE_MARKER, '1', new Date().toISOString().slice(0, 16).replace('T', ' '), '系统');
}

/**
 * 内置模板库引导（幂等）：生产（empty）模式建库时不写任何示例数据，模板汇总库因此为空。
 * 触发条件：模板类别为空 且 本库尚未播种过内置模板 —— 满足即播种并写入标记。
 *
 * 之所以用「标记」而不是「用户数 ≤ 1」判断是否处于初始化阶段：学校一旦创建了
 * 自己的账号就说明已进入正式使用，此时若模板库仍为空仍需补齐内置模板；
 * 而管理员主动清空模板库后（标记已存在），重启也不会把模板写回来。
 */
function ensureBuiltinTemplateLibrary() {
  if (db.prepare('SELECT COUNT(*) AS c FROM templateCategories').get().c > 0) return;
  if (isBuiltinTemplateLibrarySeeded()) return;
  insertBuiltinTemplates();
  console.log('[db] 模板汇总库为空，已播种内置模板类别与模板（生产模式引导）。');
}

ensureBuiltinRoles();
seed();
ensureBuiltinTemplateLibrary();
ensureStudentClassBackfill();
ensureDormitoryBackfill();
ensureUserRoleBackfill();
ensureMentalLevelBaselineLogs();
ensureDefaultInterviewTemplate();
// 演示模式（WORKBENCH_DEMO=1）：建体验账号 + 全班带班 + 派生列兜底（详见 lib/demo.js）
demo.ensureDemoAccount({
  get: (sql, params) => db.prepare(sql).get(...(params ?? [])),
  all: (sql, params) => db.prepare(sql).all(...(params ?? [])),
  run: (sql, params) => db.prepare(sql).run(...(params ?? [])),
});

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

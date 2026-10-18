/** SQLite 数据库：建表、迁移与种子数据（node:sqlite，零原生编译依赖） */
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const { DB_PATH, ensureDirs } = require('./config');
const SEED = require('./seed-data');

ensureDirs();

const db = new DatabaseSync(DB_PATH);
// WAL 模式：允许多教师并发读、写入串行化
db.prepare('PRAGMA journal_mode = WAL').get();
db.prepare('PRAGMA foreign_keys = ON').get();

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

seed();
ensureStudentClassBackfill();

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

module.exports = { db, all, get, run };

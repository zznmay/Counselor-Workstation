/**
 * 老库升级回归：模拟「教师唯一来源改造上线前的旧数据库」——
 * classCounselors 仍为 (classId, userId) 二维结构、users 无 mobile/teacherSource、
 * students 无 classId、roles 无 ownerModules。要求 lib/db.js 首次加载时：
 *  1. 启动不崩溃（回归点：idx_cc_* 索引曾写在 SCHEMA_STATEMENTS 中、先于迁移执行，
 *     在旧库上抛 "no such column: roleType" 导致云端既有实例启动失败）；
 *  2. 各项老库升级全部生效（三维关联 + 历史行=counselor + 索引/列补齐）；
 *  3. 既有业务数据不丢失，学生宿舍文本按规则回填 dormitories。
 *
 * 运行方式：node --experimental-sqlite --test tests/*.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// —— 环境变量必须先于任何服务端模块加载（db.js 首次 require 即建库） ——
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-legacy-db-test-'));
process.env.WORKBENCH_DATA_DIR = DATA_DIR;
process.env.WORKBENCH_SEED = 'empty';

// 用旧结构预置 app.db（--experimental-sqlite 下 node:sqlite 可用）
const { DatabaseSync } = await import('node:sqlite');
const legacy = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
legacy.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'counselor',
    passwordHash TEXT NOT NULL,
    mustChangePassword INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    isSystem INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gradeId INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE (gradeId, name)
  );
  CREATE TABLE classCounselors (
    classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (classId, userId)
  );
  CREATE TABLE students (
    id TEXT PRIMARY KEY,
    studentNo TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    gender TEXT,
    grade TEXT,
    major TEXT,
    className TEXT,
    phone TEXT,
    dorm TEXT,
    politicalStatus TEXT,
    origin TEXT,
    status TEXT DEFAULT '在读',
    headTeacher TEXT,
    counselor TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);
// 旧库种子：一名教师、一个年级/班级、一条二维带班关系、一名带宿舍文本的学生
legacy.prepare(
  `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
   VALUES ('t_wang', '王老师', 'counselor', 'x', 0, 0, '2026-01-01 00:00')`,
).run();
legacy.prepare(`INSERT INTO grades (name, createdAt) VALUES ('2025级', '2026-01-01 00:00')`).run();
legacy.prepare(`INSERT INTO classes (gradeId, name, createdAt) VALUES (1, '软件2501', '2026-01-01 00:00')`).run();
legacy.prepare(`INSERT INTO classCounselors (classId, userId) VALUES (1, 1)`).run();
legacy.prepare(
  `INSERT INTO students (id, studentNo, name, dorm, createdAt, updatedAt)
   VALUES ('s1', '25010101', '张三', '荷园B512', '2026-01-01 00:00', '2026-01-01 00:00')`,
).run();
legacy.close();

const serverRequire = createRequire(path.join(HERE, '../server/index.js'));
const dbx = serverRequire('./lib/db');

test('老库（二维 classCounselors）加载 db.js 不崩溃并完成全部升级', () => {
  // 1. classCounselors 升级为三维关联，历史行保留且 roleType='counselor'
  const cols = dbx.all('PRAGMA table_info(classCounselors)').map((c) => c.name);
  assert.ok(cols.includes('roleType'), 'classCounselors 应含 roleType 列');
  assert.ok(cols.includes('createdAt'), 'classCounselors 应含 createdAt 列');
  const rel = dbx
    .all('SELECT classId, userId, roleType FROM classCounselors')
    .map((r) => ({ classId: r.classId, userId: r.userId, roleType: r.roleType }));
  assert.deepEqual(rel, [{ classId: 1, userId: 1, roleType: 'counselor' }]);

  // 2. 索引由迁移补齐（回归点：索引曾在 SCHEMA_STATEMENTS 中提前创建导致旧库启动崩溃）
  const indexes = dbx
    .all(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='classCounselors'`)
    .map((r) => r.name);
  assert.ok(indexes.includes('idx_cc_user'), '应存在 idx_cc_user 索引');
  assert.ok(indexes.includes('idx_cc_role'), '应存在 idx_cc_role 索引');

  // 3. users 补列
  const userCols = dbx.all('PRAGMA table_info(users)').map((c) => c.name);
  assert.ok(userCols.includes('mobile') && userCols.includes('teacherSource'), 'users 应补 mobile/teacherSource 列');

  // 4. students.classId / roles.ownerModules 补列
  const stuCols = dbx.all('PRAGMA table_info(students)').map((c) => c.name);
  assert.ok(stuCols.includes('classId'), 'students 应补 classId 列');
  const roleCols = dbx.all('PRAGMA table_info(roles)').map((c) => c.name);
  assert.ok(roleCols.includes('ownerModules'), 'roles 应补 ownerModules 列');

  // 5. 寝室文本回填：荷园B512 → 荷园B / 512
  const dorm = dbx.get('SELECT studentNo, building, room FROM dormitories');
  assert.ok(dorm, '应按 students.dorm 回填 dormitories');
  assert.equal(dorm.studentNo, '25010101');
  assert.equal(dorm.building, '荷园B');
  assert.equal(dorm.room, '512');
});

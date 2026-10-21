/**
 * 批量导入路由级测试脚手架：临时数据目录 + 隔离 SQLite + Express 测试服务。
 *
 * 关键点：server/lib/db.js 在「首次 require」时就按 WORKBENCH_DATA_DIR 初始化数据库单例，
 * 因此环境变量必须在任何服务端模块被加载之前设置 —— 本模块需作为测试文件的第一个 import。
 *
 * 运行方式（含 --experimental-sqlite，因服务端使用 node:sqlite）：
 *   node --experimental-sqlite --test tests/*.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 服务端入口，仅作模块解析锚点（不会被 require 执行） */
const SERVER_ENTRY = path.join(HERE, '../../server/index.js');

// —— 环境变量必须先于服务端模块加载 ——
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-import-test-'));
process.env.WORKBENCH_DATA_DIR = DATA_DIR;
// empty 模式：不写入任何演示数据，保证测试断言基线干净（仅建 admin 账号）
process.env.WORKBENCH_SEED = 'empty';

const serverRequire = createRequire(SERVER_ENTRY);
const express = serverRequire('express');
const dbx = serverRequire('./lib/db');
const auth = serverRequire('./lib/auth');
const studentsRoute = serverRequire('./routes/students');
const classesRoute = serverRequire('./routes/classes');
const dormitoriesRoute = serverRequire('./routes/dormitories');
const usersRoute = serverRequire('./routes/users');

export { dbx, DATA_DIR, studentsRoute, classesRoute, dormitoriesRoute, usersRoute };

/** 密码校验（bcrypt，与账号体系同口径） */
export function verifyPassword(password, hash) {
  return auth.verifyPassword(password, hash);
}

/** 与服务端 audit.nowStr 同口径的时间串 */
export function nowStr() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

/** 造年级 + 班级字典行（幂等），返回 { gradeId, classId } */
export function seedGradeAndClass(gradeName, className) {
  const g = dbx.get('SELECT id FROM grades WHERE name = ?', [gradeName])
    ?? { id: Number(dbx.run('INSERT INTO grades (name, createdAt) VALUES (?, ?)', [gradeName, nowStr()]).lastInsertRowid) };
  const c = dbx.get('SELECT id FROM classes WHERE gradeId = ? AND name = ?', [g.id, className])
    ?? { id: Number(dbx.run('INSERT INTO classes (gradeId, name, createdAt) VALUES (?, ?, ?)', [g.id, className, nowStr()]).lastInsertRowid) };
  return { gradeId: g.id, classId: c.id };
}

/** 造一名在职辅导员（角色 counselor），返回 userId */
export function seedCounselor(username, displayName) {
  const exist = dbx.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exist) return exist.id;
  const id = Number(dbx.run(
    `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
     VALUES (?, ?, 'counselor', 'not-used-in-import-test', 0, 0, ?)`,
    [username, displayName, nowStr()],
  ).lastInsertRowid);
  dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [id, 'counselor']);
  return id;
}

/** 造一名在职班主任（角色 headTeacher），返回 userId */
export function seedHeadTeacher(username, displayName) {
  const exist = dbx.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exist) return exist.id;
  const id = Number(dbx.run(
    `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
     VALUES (?, ?, 'headTeacher', 'not-used-in-import-test', 0, 0, ?)`,
    [username, displayName, nowStr()],
  ).lastInsertRowid);
  dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [id, 'headTeacher']);
  return id;
}

/** 造一名停用账号（disabled=1，不授角色），返回 userId */
export function seedDisabledUser(username, displayName) {
  const exist = dbx.get('SELECT id FROM users WHERE username = ?', [username]);
  if (exist) return exist.id;
  return Number(dbx.run(
    `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
     VALUES (?, ?, 'counselor', 'not-used-in-import-test', 0, 1, ?)`,
    [username, displayName, nowStr()],
  ).lastInsertRowid);
}

/** 直插一条待同步人员（幂等），返回行 id */
export function seedPendingStaff(classId, employeeNo, displayName, roleType = 'counselor', source = 'import') {
  const exist = dbx.get(
    'SELECT id FROM classPendingStaff WHERE classId = ? AND employeeNo = ? AND roleType = ?',
    [classId, employeeNo, roleType],
  );
  if (exist) return exist.id;
  return Number(dbx.run(
    `INSERT INTO classPendingStaff (classId, employeeNo, displayName, roleType, source, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [classId, employeeNo, displayName, roleType, source, nowStr()],
  ).lastInsertRowid);
}

/** 管理员请求头（Bearer 之外的自定义头 X-Auth-Token，服务端 authMiddleware 支持） */
export function adminHeaders() {
  const admin = dbx.get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) throw new Error('未找到管理员账号，請确认 WORKBENCH_SEED=empty 已生效');
  return { 'Content-Type': 'application/json', 'X-Auth-Token': auth.issueToken(admin) };
}

/**
 * 构建 Express 应用（路由自带鉴权与模块权限中间件）
 * @param mounts [[挂载路径, 路由]]，缺省挂载学生/班级两条导入路由
 */
export function createApp(mounts = [['/api/students', studentsRoute], ['/api/classes', classesRoute]]) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  for (const [path, route] of mounts) app.use(path, route);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || '服务内部错误' });
  });
  return app;
}

/** 启动测试服务（随机端口），返回 { base, close }；可传入自定义挂载 */
export async function startTestServer(mounts) {
  const app = createApp(mounts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** 以管理员身份发起 JSON 请求（method 缺省 POST） */
export async function requestJson(base, method, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: adminHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** 以管理员身份 POST JSON */
export async function postJson(base, urlPath, body) {
  return requestJson(base, 'POST', urlPath, body);
}

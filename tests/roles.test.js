import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import {
  conversationsRoute, dbx, fundingRoute, gradesRoute, headersOf, postJson,
  requestAs, requestJson, rolesRoute, seedGradeAndClass, startTestServer, studentsRoute, usersRoute,
} from './helpers/importServer.js';

/**
 * 角色与权限体系：模块—页面—操作 三级权限 + 数据范围（全量/带班）+ 角色启停用。
 * 覆盖：角色 CRUD 与标识/字段校验、操作级 403、数据范围切换、停用即时收回、
 * 权限收窄静默裁剪、gated 页面（年级管理）守卫、内置角色播种与保护。
 */

const GRADE = '2099级';
const YEAR = '2099-2100';
/** 自定义只读角色标识（2-30 位小写字母） */
const ROLE_KEY = 'readonlytester';
/** 建号口令：每次运行随机生成（仅满足建号校验，登录鉴权走 X-Auth-Token 令牌） */
const TEST_PASSWORD = `T${Date.now().toString(36)}x${Math.random().toString(36).slice(2, 8)}`;

describe('角色与权限体系', () => {
  let base;
  let close;
  let classA;
  let classB;
  let stuA;
  let stuB;
  let roleId;

  before(async () => {
    ({ base, close } = await startTestServer([
      ['/api/roles', rolesRoute],
      ['/api/users', usersRoute],
      ['/api/students', studentsRoute],
      ['/api/conversations', conversationsRoute],
      ['/api/funding', fundingRoute],
      ['/api/grades', gradesRoute],
    ]));

    classA = seedGradeAndClass(GRADE, '角色测试一班').classId;
    classB = seedGradeAndClass(GRADE, '角色测试二班').classId;
    stuA = 'stu-role-a';
    stuB = 'stu-role-b';
    dbx.run(
      'INSERT INTO students (id, studentNo, name, classId, className) VALUES (?, ?, ?, ?, ?)',
      [stuA, 'S900001', '范围学生甲', classA, '角色测试一班'],
    );
    dbx.run(
      'INSERT INTO students (id, studentNo, name, classId, className) VALUES (?, ?, ?, ?, ?)',
      [stuB, 'S900002', '范围学生乙', classB, '角色测试二班'],
    );

    // 自定义只读角色：可见四个模块、无任何操作、默认带班范围
    const created = await postJson(base, '/api/roles', {
      name: '只读测试员',
      key: ROLE_KEY,
      description: '测试用只读角色',
      permissions: ['students', 'conversations', 'funding', 'classes'],
      actions: [],
      dataScopes: {},
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.key, ROLE_KEY, '自定义角色标识应按入参落库');
    roleId = created.body.id;

    // 测试用户：只读角色 + 带班一班
    const user = await postJson(base, '/api/users', {
      username: 'role_tester',
      displayName: '只读测试员',
      roleKeys: [ROLE_KEY],
      password: TEST_PASSWORD,
      classIds: [classA],
    });
    assert.equal(user.status, 200);
  });

  after(async () => {
    await close();
  });

  /* ==================== 角色维护：字段与校验 ==================== */

  it('R1 · 内置角色按新模型播种：辅导员通配操作 + 名册/寝室全量，班主任含访谈操作', () => {
    const counselor = dbx.get("SELECT * FROM roles WHERE key = 'counselor'");
    assert.ok(JSON.parse(counselor.actions).includes('students:*'));
    assert.ok(JSON.parse(counselor.actions).includes('funding:*'));
    assert.equal(JSON.parse(counselor.dataScopes).students, 'all');
    assert.equal(JSON.parse(counselor.dataScopes).dormitories, 'all');
    assert.equal(JSON.parse(counselor.dataScopes).conversations, 'managed');
    const headTeacher = dbx.get("SELECT * FROM roles WHERE key = 'headTeacher'");
    assert.ok(JSON.parse(headTeacher.actions).includes('mentalInterview:*'));
  });

  it('R2 · 角色标识校验：格式/保留字/唯一性；留空自动生成', async () => {
    const badFormat = await postJson(base, '/api/roles', { name: '格式错', key: 'Bad Key', permissions: [] });
    assert.equal(badFormat.status, 400);
    const reserved = await postJson(base, '/api/roles', { name: '保留字', key: 'admin', permissions: [] });
    assert.equal(reserved.status, 400);
    const dup = await postJson(base, '/api/roles', { name: '重复标识', key: ROLE_KEY, permissions: [] });
    assert.equal(dup.status, 400);
    const dupName = await postJson(base, '/api/roles', { name: '只读测试员', permissions: [] });
    assert.equal(dupName.status, 400);
    const auto = await postJson(base, '/api/roles', { name: '自动标识角色', permissions: ['todos'], actions: [] });
    assert.equal(auto.status, 200);
    assert.match(auto.body.key, /^role_/);
  });

  it('R3 · 操作/数据范围校验：操作所属模块须已勾选、范围仅限可配模块与合法取值', async () => {
    const orphan = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      actions: ['todos:create'], // todos 不在 permissions 内
    });
    assert.equal(orphan.status, 400);
    const badScopeModule = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      dataScopes: { todos: 'all' }, // todos 不支持数据范围
    });
    assert.equal(badScopeModule.status, 400);
    const badScopeValue = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      dataScopes: { students: 'everything' },
    });
    assert.equal(badScopeValue.status, 400);
    const badAction = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      actions: ['students:teleport'],
    });
    assert.equal(badAction.status, 400);
  });

  it('R4 · admin 角色不可修改；收窄 permissions 时未传的 actions/dataScopes 静默裁剪', async () => {
    const admin = dbx.get("SELECT id FROM roles WHERE key = 'admin'");
    const guard = await requestJson(base, 'PUT', `/api/roles/${admin.id}`, { name: '系统管理员' });
    assert.equal(guard.status, 400);

    const silent = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      permissions: ['students', 'conversations'],
    });
    assert.equal(silent.status, 200);
    assert.deepEqual(silent.body.actions, [], '未传 actions 且收窄 permissions 时按新权限裁剪');
    assert.deepEqual(silent.body.dataScopes, {}, '数据范围随模块收窄一并裁剪');
    // 恢复完整配置供后续用例使用
    const restore = await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      permissions: ['students', 'conversations', 'funding', 'classes'],
      actions: [],
      dataScopes: {},
    });
    assert.equal(restore.status, 200);
  });

  /* ==================== 操作权限（requireAction） ==================== */

  it('A1 · 只读角色：模块可访问但写操作 403；补 create 操作后放行；写操作仍按带班收口', async () => {
    const list = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, 'role_tester');
    assert.equal(list.status, 200, '模块权限放行列表访问');

    const denied = await requestAs(base, 'POST', '/api/conversations', { studentId: stuA }, 'role_tester');
    assert.equal(denied.status, 403, '无 conversations:create 操作应被拒');

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { actions: ['conversations:create'] });
    const allowed = await requestAs(base, 'POST', '/api/conversations', { studentId: stuA }, 'role_tester');
    assert.equal(allowed.status, 200, '补授权后新增谈话放行（带班内学生）');

    const stillDenied = await requestAs(base, 'POST', '/api/conversations', { studentId: stuB }, 'role_tester');
    assert.equal(stillDenied.status, 403, '写操作仍按带班收口（非本班学生），与查看范围解耦');
  });

  it('A2 · 通配 module:* 放开全部操作（新增操作自动继承）', async () => {
    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { actions: ['conversations:*'] });
    const again = await requestAs(base, 'POST', '/api/conversations', { studentId: stuA }, 'role_tester');
    assert.equal(again.status, 200);
    // 恢复为仅 create
    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { actions: ['conversations:create'] });
  });

  /* ==================== 数据范围（dataScopes） ==================== */

  it('D1 · 默认带班：学生列表仅本班；students 配置全量后全院可见；内置辅导员名册全量', async () => {
    const managed = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, 'role_tester');
    assert.equal(managed.status, 200);
    const managedIds = managed.body.list.map((s) => s.id);
    assert.ok(managedIds.includes(stuA));
    assert.ok(!managedIds.includes(stuB), '带班范围不应看到二班学生');

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { dataScopes: { students: 'all' } });
    const wide = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, 'role_tester');
    assert.ok(wide.body.list.some((s) => s.id === stuB), '全量范围应看到二班学生');

    // 内置辅导员：迁移口径 = 名册全量（与升级前 rosterScope 放行一致）
    dbx.run(
      `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
       VALUES ('counselor_probe', '辅导员探针', 'counselor', 'probe-only', 0, 0, '2026-01-01')`,
    );
    const probe = dbx.get("SELECT id FROM users WHERE username = 'counselor_probe'");
    dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [probe.id, 'counselor']);
    const counselorView = await requestAs(base, 'GET', '/api/students?page=1&pageSize=50', undefined, 'counselor_probe');
    assert.equal(counselorView.status, 200);
    assert.ok(counselorView.body.list.some((s) => s.id === stuB), '内置辅导员名册应全量（与升级前一致）');
  });

  it('D2 · 敏感口径（funding）：默认带班仅本班记录，配置全量后跨班可见', async () => {
    dbx.run(
      `INSERT INTO fundingIdentifications
       (id, studentId, academicYear, level, difficultyTypes, status, identifiedAt, validFrom, validTo, source, createdBy, createdAt, updatedAt, updatedBy)
       VALUES ('fi-role-1', ?, ?, '一般困难', '[]', '已认定', '2099-09', '2099-09', '2100-09', 'manual', 1, '2099-09-01', '2099-09-01', 1)`,
      [stuB, YEAR],
    );
    const managed = await requestAs(base, 'GET', `/api/funding/identifications?academicYear=${YEAR}`, undefined, 'role_tester');
    assert.equal(managed.status, 200);
    assert.equal(managed.body.total, 0, '带班范围不应看到二班学生的认定记录');

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { dataScopes: { funding: 'all' } });
    const wide = await requestAs(base, 'GET', `/api/funding/identifications?academicYear=${YEAR}`, undefined, 'role_tester');
    assert.equal(wide.body.total, 1, '全量范围应看到二班学生的认定记录');
  });

  /* ==================== gated 页面（年级管理） ==================== */

  it('P1 · 年级管理页：需 classes:page-grades + gradeCreate；未授权 403，授权后放行', async () => {
    const denied = await requestAs(base, 'POST', '/api/grades', { name: '2098级' }, 'role_tester');
    assert.equal(denied.status, 403, '无 gated 页面权限应被拒');

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, {
      actions: ['conversations:create', 'classes:page-grades', 'classes:gradeCreate'],
    });
    const allowed = await requestAs(base, 'POST', '/api/grades', { name: '2098级' }, 'role_tester');
    assert.equal(allowed.status, 200);
    const stillNoGradeEdit = await requestAs(base, 'PUT', `/api/grades/${allowed.body.id}`, { name: '2097级' }, 'role_tester');
    assert.equal(stillNoGradeEdit.status, 403, '页面可访问但未授 gradeEdit 操作仍应被拒');
  });

  /* ==================== 角色启停用 ==================== */

  it('S1 · 停用即时收回全部授权，重新启用即恢复（无需重登录，令牌不变）', async () => {
    const before = await requestAs(base, 'GET', '/api/students?page=1&pageSize=10', undefined, 'role_tester');
    assert.equal(before.status, 200);

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { disabled: true });
    const revoked = await requestAs(base, 'GET', '/api/students?page=1&pageSize=10', undefined, 'role_tester');
    assert.equal(revoked.status, 403, '停用角色后模块访问应立即被拒');

    const options = await requestAs(base, 'GET', '/api/roles/options', undefined, 'admin');
    const disabledOpt = options.body.find((r) => r.key === ROLE_KEY);
    assert.equal(disabledOpt.disabled, true, '角色下拉应带出停用标记');

    await requestJson(base, 'PUT', `/api/roles/${roleId}`, { disabled: false });
    const restored = await requestAs(base, 'GET', '/api/students?page=1&pageSize=10', undefined, 'role_tester');
    assert.equal(restored.status, 200, '重新启用后授权恢复');
  });

  it('S2 · admin 角色不可停用；有用户的自定义角色不可删除', async () => {
    const admin = dbx.get("SELECT id FROM roles WHERE key = 'admin'");
    const guard = await requestJson(base, 'PUT', `/api/roles/${admin.id}`, { disabled: true });
    assert.equal(guard.status, 400);
    const del = await requestJson(base, 'DELETE', `/api/roles/${roleId}`);
    assert.equal(del.status, 400, '仍有用户引用的角色应拒绝删除');
  });

  /* ==================== 会话下发（解析层） ==================== */

  it('M1 · actions 与 dataScopes 按多角色并集解析', async () => {
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const req = createRequire(fileURLToPath(new URL('../server/index.js', import.meta.url)));
    const { actionsOfUser, dataScopesOfUser } = req('./lib/permissions');
    const user = dbx.get("SELECT * FROM users WHERE username = 'role_tester'");
    const roleKeys = dbx.all('SELECT roleKey FROM userRoles WHERE userId = ?', [user.id]).map((r) => r.roleKey);
    const enriched = { ...user, roleKeys };
    assert.deepEqual(
      actionsOfUser(enriched).sort(),
      ['classes:gradeCreate', 'classes:page-grades', 'conversations:create'],
    );
    // D2 显式传入 dataScopes 后整体替换：仅 funding=all，其余回落默认带班
    assert.equal(dataScopesOfUser(enriched).funding, 'all');
    assert.equal(dataScopesOfUser(enriched).students, 'managed');
    assert.equal(dataScopesOfUser(enriched).conversations, 'managed');
  });

  it('M2 · roleKeysOfUserId 按用户过滤（防丢参回归：漏传 userId 会把所有会话角色清空）', async () => {
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const req = createRequire(fileURLToPath(new URL('../server/index.js', import.meta.url)));
    const { roleKeysOfUserId } = req('./lib/permissions');
    const tester = dbx.get("SELECT * FROM users WHERE username = 'role_tester'");
    const testerKeys = roleKeysOfUserId(tester.id);
    assert.ok(testerKeys.length > 0, '该用户已绑角色，roleKeys 不应为空');
    assert.ok(testerKeys.includes('counselor') || testerKeys.length > 0);
    // 不同用户互不串扰：admin 的角色集合不应混入测试用户的角色
    const admin = dbx.get("SELECT * FROM users WHERE username = 'admin'");
    const adminKeys = roleKeysOfUserId(admin.id);
    assert.deepEqual(adminKeys, ['admin']);
    assert.ok(!adminKeys.includes(testerKeys[0]) || testerKeys[0] === 'admin');
  });
});

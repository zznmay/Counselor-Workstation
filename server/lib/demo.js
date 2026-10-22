/**
 * 演示模式（WORKBENCH_DEMO=1 时启用，用于体验环境部署）：
 *   - GET /auth/demo-login 免登录发放演示账号令牌，访客打开链接即可直接进入；
 *   - 数据库全部为 seed-data.js 虚构示例数据，不含任何真实用户信息。
 *
 * 体验账号（demo）：角色集合 = 内置辅导员（counselor，全业务模块）+ 演示角色（demo，
 * 补齐班级管理等全部模块权限与主负责模块），并写入 classCounselors 全班带班，
 * 保证查看与写操作全部可体验。
 * 防护措施：
 *   - 种子 admin 密码随机化并禁用（disabled=1，db.js seed 内完成），
 *     杜绝通过默认口令登录管理员；
 *   - 系统管理（用户/角色/日志/数据管理）仅 admin 角色可访问，演示账号无 admin 角色，
 *     天然无法触达；账号管理相关写接口均要求管理员；
 *   - 每次请求即时校验（authMiddleware 实时读库）。
 */
const crypto = require('crypto');
const { MODULE_KEYS, OWNERABLE_MODULE_KEYS } = require('./modules');

const DEMO_USERNAME = 'demo';
const DEMO_DISPLAY_NAME = '演示辅导员';
/** 体验账号角色集合：内置辅导员 + 演示角色（全模块权限） */
const DEMO_ROLE_KEY = 'demo';
const DEMO_ROLES = ['counselor', DEMO_ROLE_KEY];

/** 演示模式开关（仅环境变量 WORKBENCH_DEMO=1 时开启） */
function isDemoMode() {
  return String(process.env.WORKBENCH_DEMO ?? '').trim() === '1';
}

/** 加盐随机口令（演示种子账号使用，不对外暴露） */
function randomPassword() {
  return `demo-${crypto.randomBytes(24).toString('hex')}`;
}

/** bcrypt 哈希（与 lib/auth 同算法；独立实现避免 auth→db→demo 环形依赖） */
function hashPassword(password) {
  return require('bcryptjs').hashSync(password, 10);
}

/**
 * 确保体验账号、演示角色与带班数据就绪（幂等，db.js 启动链尾调用一次）：
 *   - roles：内置角色之外的「演示角色」，权限 = 全部模块，主负责 = 全部可主负责模块；
 *   - users：role=counselor（主角色），mustChangePassword=0，不停用；
 *   - userRoles：逐角色写入；
 *   - classCounselors：对现有全部班级写辅导员带班行（缺班级时跳过，演示种子自带班级）；
 *   - students.classId 派生列兜底回填（与 lib/teacherSync 同口径，保证名册可见）。
 * @param {{get:Function, all:Function, run:Function}} dbx 参数化访问句柄（db.js 传入）
 */
function ensureDemoAccount(dbx) {
  if (!isDemoMode()) return;
  const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

  // 演示角色（先于 userRoles 写入，满足外键）：全部模块权限 + 全部可主负责模块
  dbx.run(
    `INSERT OR IGNORE INTO roles (key, name, description, isSystem, permissions, ownerModules, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      DEMO_ROLE_KEY,
      '演示角色',
      '体验环境专用：全部业务模块权限与主负责模块（不含系统管理）',
      JSON.stringify([...MODULE_KEYS]),
      JSON.stringify([...OWNERABLE_MODULE_KEYS]),
      now(), now(),
    ],
  );

  let user = dbx.get('SELECT * FROM users WHERE username = ?', [DEMO_USERNAME]);
  if (!user) {
    dbx.run(
      `INSERT INTO users (username, displayName, role, passwordHash, mustChangePassword, disabled, createdAt)
       VALUES (?, ?, 'counselor', ?, 0, 0, ?)`,
      [DEMO_USERNAME, DEMO_DISPLAY_NAME, hashPassword(randomPassword()), now()],
    );
    user = dbx.get('SELECT * FROM users WHERE username = ?', [DEMO_USERNAME]);
  } else if (user.disabled) {
    dbx.run('UPDATE users SET disabled = 0 WHERE id = ?', [user.id]);
    user = dbx.get('SELECT * FROM users WHERE username = ?', [DEMO_USERNAME]);
  }

  const uid = Number(user.id);
  for (const roleKey of DEMO_ROLES) {
    dbx.run('INSERT OR IGNORE INTO userRoles (userId, roleKey) VALUES (?, ?)', [uid, roleKey]);
  }

  // 带班：全部班级（演示库班级量级为个位数，直接全量写入）
  const classes = dbx.all('SELECT id FROM classes ORDER BY id');
  for (const c of classes) {
    dbx.run(
      'INSERT OR IGNORE INTO classCounselors (classId, userId, roleType, createdAt) VALUES (?, ?, ?, ?)',
      [Number(c.id), uid, 'counselor', now()],
    );
  }

  // 兜底回填 students.classId（班级名精确匹配；teacherSync 主链路之外的双保险）
  dbx.run(
    `UPDATE students SET classId = (SELECT id FROM classes WHERE name = students.className)
     WHERE (classId IS NULL OR classId = 0) AND className IN (SELECT name FROM classes)`,
  );

  console.log(`[demo] 体验账号 ${DEMO_USERNAME} 就绪：角色 ${DEMO_ROLES.join('+')}，带班 ${classes.length} 个班级。`);
}

module.exports = {
  DEMO_USERNAME,
  DEMO_DISPLAY_NAME,
  DEMO_ROLES,
  isDemoMode,
  ensureDemoAccount,
};

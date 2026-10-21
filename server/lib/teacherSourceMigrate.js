/**
 * 「教师唯一来源」改造的幂等迁移 / 回滚。
 *
 * 设计要点：
 * - 本模块**不 require lib/db.js**，而是接收一个 node:sqlite DatabaseSync 实例，
 *   这样 db.js 可以在启动早期调用它（避免循环依赖），scripts 也可另开连接单独执行。
 * - 迁移后的语义：classCounselors 由「人-班」二维升级为「人-班-身份」三维，
 *   主键 (classId, userId, roleType)；历史行一律迁移为 roleType='counselor'
 *   （历史上只有辅导员在走带班权限，错判为 headTeacher 会误收编辑权）。
 * - SQLite 不允许改主键，只能重建表；重建期间必须关闭外键约束（且不能在事务内切换）。
 *
 * 迁移/回滚均为「全量事务 + foreign_key_check」，失败即 ROLLBACK 并向上抛错。
 */

/** 身份枚举：与前端「辅导员 / 班主任」一一对应（库内沿用角色 key，避免再存一份中文） */
const ROLE_TYPE_COUNSELOR = 'counselor';
const ROLE_TYPE_HEAD_TEACHER = 'headTeacher';
const ROLE_TYPES = [ROLE_TYPE_COUNSELOR, ROLE_TYPE_HEAD_TEACHER];

const NEW_CC_TABLE = 'classCounselors__new';

const OLD_CC_DDL = `CREATE TABLE classCounselors (
  classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (classId, userId)
)`;

const NEW_CC_DDL = `CREATE TABLE ${NEW_CC_TABLE} (
  classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roleType TEXT NOT NULL DEFAULT '${ROLE_TYPE_COUNSELOR}'
    CHECK (roleType IN ('${ROLE_TYPE_COUNSELOR}', '${ROLE_TYPE_HEAD_TEACHER}')),
  createdAt TEXT,
  PRIMARY KEY (classId, userId, roleType)
)`;

const CC_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_cc_user ON classCounselors(userId, roleType)',
  'CREATE INDEX IF NOT EXISTS idx_cc_role ON classCounselors(roleType)',
];

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

/** users 表补列（mobile / teacherSource）；已存在则跳过 */
function ensureUsersColumns(db) {
  const cols = columnsOf(db, 'users');
  const added = [];
  if (!cols.includes('mobile')) {
    db.exec('ALTER TABLE users ADD COLUMN mobile TEXT');
    added.push('mobile');
  }
  if (!cols.includes('teacherSource')) {
    db.exec('ALTER TABLE users ADD COLUMN teacherSource TEXT');
    added.push('teacherSource');
  }
  return added;
}

/** classCounselors 升级为 (classId, userId, roleType) 三维关联；历史行 → counselor */
function ensureClassCounselorsRoleType(db) {
  const cols = columnsOf(db, 'classCounselors');
  if (cols.includes('roleType')) {
    for (const sql of CC_INDEXES) db.exec(sql);
    return false; // 已是新结构，幂等跳过
  }

  db.exec('PRAGMA foreign_keys = OFF'); // 必须在事务外
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(NEW_CC_DDL);
    db.exec(
      `INSERT INTO ${NEW_CC_TABLE} (classId, userId, roleType, createdAt)
       SELECT classId, userId, '${ROLE_TYPE_COUNSELOR}', NULL FROM classCounselors`,
    );
    db.exec('DROP TABLE classCounselors');
    db.exec(`ALTER TABLE ${NEW_CC_TABLE} RENAME TO classCounselors`);
    for (const sql of CC_INDEXES) db.exec(sql);
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) {
      throw new Error(`外键校验未通过（${broken.length} 行），已回滚迁移`);
    }
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * 正向迁移（幂等）：users 增列 + classCounselors 升级。
 * @returns {{ usersColumns: string[], classCounselorsRebuilt: boolean }}
 */
function migrate(db) {
  const usersColumns = ensureUsersColumns(db);
  const classCounselorsRebuilt = ensureClassCounselorsRoleType(db);
  return { usersColumns, classCounselorsRebuilt };
}

/**
 * 回滚（幂等）：把 classCounselors 还原为二维、移除 users 增列。
 * 同一 (班级, 人) 同时存在两种身份时，优先保留 counselor 行（与迁移语义对称）。
 * @returns {{ classCounselorsReverted: boolean, usersColumnsDropped: string[] }}
 */
function rollback(db) {
  const usersColumnsDropped = [];
  const cols = columnsOf(db, 'classCounselors');
  let classCounselorsReverted = false;

  if (cols.includes('roleType')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE ${NEW_CC_TABLE} (
        classId INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (classId, userId)
      )`);
      db.exec(
        `INSERT OR IGNORE INTO ${NEW_CC_TABLE} (classId, userId)
         SELECT classId, userId FROM classCounselors WHERE roleType = '${ROLE_TYPE_COUNSELOR}'`,
      );
      db.exec(
        `INSERT OR IGNORE INTO ${NEW_CC_TABLE} (classId, userId)
         SELECT classId, userId FROM classCounselors WHERE roleType = '${ROLE_TYPE_HEAD_TEACHER}'`,
      );
      db.exec('DROP TABLE classCounselors');
      db.exec(`ALTER TABLE ${NEW_CC_TABLE} RENAME TO classCounselors`);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length > 0) throw new Error(`外键校验未通过（${broken.length} 行），已回滚`);
      db.exec('COMMIT');
      classCounselorsReverted = true;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  const userCols = columnsOf(db, 'users');
  for (const col of ['teacherSource', 'mobile']) {
    if (!userCols.includes(col)) continue;
    try {
      db.exec(`ALTER TABLE users DROP COLUMN ${col}`);
      usersColumnsDropped.push(col);
    } catch (e) {
      // SQLite < 3.35 不支持 DROP COLUMN：记录后继续，不阻断整体回滚
      console.warn(`[teacherSource] DROP COLUMN users.${col} 失败：${e.message}`);
    }
  }

  return { classCounselorsReverted, usersColumnsDropped };
}

module.exports = {
  ROLE_TYPE_COUNSELOR,
  ROLE_TYPE_HEAD_TEACHER,
  ROLE_TYPES,
  OLD_CC_DDL,
  columnsOf,
  migrate,
  rollback,
};

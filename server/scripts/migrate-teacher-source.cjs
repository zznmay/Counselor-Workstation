#!/usr/bin/env node
/**
 * 教师唯一来源·结构迁移 / 回滚脚本（可重复执行，幂等）。
 *
 *   node --experimental-sqlite server/scripts/migrate-teacher-source.cjs            # 正向迁移
 *   node --experimental-sqlite server/scripts/migrate-teacher-source.cjs --rollback # 回滚到迁移前结构
 *   node --experimental-sqlite server/scripts/migrate-teacher-source.cjs --check    # 只检查不改库
 *
 * 迁移内容：
 *   1) users 补 mobile / teacherSource 两列；
 *   2) classCounselors 由 (classId, userId) 升级为 (classId, userId, roleType)，
 *      历史行一律视为 roleType='counselor'。
 * 回滚：classCounselors 还原为二维（同一班级同一人保留 counselor 行），移除 users 增列。
 *
 * ⚠️ 执行前请先用「数据管理」生成一次快照包；脚本自身也会在开始前做一次文件级备份（同目录 .bak）。
 * ⚠️ 服务端正在运行时不要执行本脚本（SQLite 单写者，且服务端启动已自动迁移）。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { migrate, rollback, columnsOf } = require('../lib/teacherSourceMigrate');
const { DB_PATH } = require('../lib/config');

const args = process.argv.slice(2);
const doRollback = args.includes('--rollback');
const checkOnly = args.includes('--check');

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const target = `${file}.bak-teacher-${new Date().toISOString().slice(0, 10)}`;
  fs.copyFileSync(file, target);
  return target;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[migrate] 未找到数据库文件：${DB_PATH}`);
    process.exit(1);
  }

  if (checkOnly) {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const cc = columnsOf(db, 'classCounselors');
    const users = columnsOf(db, 'users');
    db.close();
    console.log('[check] classCounselors 列：', cc.join(', '));
    console.log('[check] users 列：', users.join(', '));
    console.log('[check] roleType 已就绪：', cc.includes('roleType'));
    return;
  }

  console.log(`[migrate] 数据库：${DB_PATH}`);
  const backups = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].map(backupFile).filter(Boolean);
  backups.forEach((b) => console.log(`[migrate] 已备份：${path.basename(b)}`));

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    if (doRollback) {
      const out = rollback(db);
      console.log(
        `[rollback] classCounselors ${out.classCounselorsReverted ? '已还原为二维关联' : '本就是二维结构'}；` +
        `users 移除列：${out.usersColumnsDropped.join('、') || '（无）'}`,
      );
    } else {
      const out = migrate(db);
      console.log(
        `[migrate] users 新增列：${out.usersColumns.join('、') || '（已存在，跳过）'}；` +
        `classCounselors ${out.classCounselorsRebuilt ? '已升级为三维关联（历史行＝counselor）' : '已是三维关联，跳过'}`,
      );
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) {
      console.error(`[migrate] ⚠️ 外键校验存在 ${broken.length} 行异常，请检查数据`);
    } else {
      console.log('[migrate] 外键校验通过（0 行异常）');
    }
    console.log('[migrate] 完成。');
  } catch (e) {
    console.error(`[migrate] 失败并回滚：${e.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

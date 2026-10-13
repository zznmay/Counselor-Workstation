/** 每晚备份：SQLite 一致性快照（VACUUM INTO）+ 上传文件拷贝，保留最近 30 份 */
const fs = require('fs');
const path = require('path');

const { DATA_DIR, DB_PATH, UPLOAD_DIR, BACKUP_DIR } = require('../lib/config');
const db = require('../lib/db');

function run() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const target = path.join(BACKUP_DIR, stamp);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

  // 1. 数据库一致性快照
  const dbFile = path.join(target, 'app.db');
  db.prepare("VACUUM INTO ?").run(dbFile);

  // 2. 上传文件目录
  const uploadsTarget = path.join(target, 'uploads');
  if (fs.existsSync(UPLOAD_DIR)) fs.cpSync(UPLOAD_DIR, uploadsTarget, { recursive: true });

  // 3. 只保留最近 30 份
  const dirs = fs.readdirSync(BACKUP_DIR)
    .filter((name) => fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
    .sort();
  while (dirs.length > 30) {
    const oldest = dirs.shift();
    fs.rmSync(path.join(BACKUP_DIR, oldest), { recursive: true, force: true });
  }

  console.log(`[backup] 备份完成：${target}`);
  return target;
}

if (require.main === module) run();
module.exports = { run };

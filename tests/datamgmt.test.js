import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { dbx } from './helpers/importServer.js';

const serverRequire = createRequire(new URL('../server/index.js', import.meta.url));
const dm = serverRequire('./lib/datamgmt');
const zip = serverRequire('./lib/zip');
const { BACKUP_DIR } = serverRequire('./lib/config');

const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

test('ZIP 往返：bundle.json 与说明文件可被解包读取', () => {
  const buf = zip.createZip([
    { name: 'bundle.json', data: JSON.stringify({ tables: { students: [] } }) },
    { name: 'README.txt', data: '中文说明' },
  ]);
  assert.equal(zip.isZip(buf), true);
  const entries = zip.readZipEntries(buf);
  assert.deepEqual([...entries.keys()].sort(), ['README.txt', 'bundle.json']);
  assert.equal(JSON.parse(entries.get('bundle.json').toString('utf8')).tables.students.length, 0);
  assert.equal(entries.get('README.txt').toString('utf8'), '中文说明');
});

test('迁移包导出为 ZIP，上传后可完整恢复', () => {
  dbx.run(
    `INSERT INTO students (id, studentNo, name, grade, className, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['migrate-stu-1', 'MIGRATE001', '迁移测试学生', '2026级', '迁移一班', now(), now()],
  );

  const bundle = dm.createBackup({ kind: '迁移包', label: '自动化迁移测试', actor: 'tester' });
  assert.match(bundle.fileName, /\.zip$/);
  const raw = fs.readFileSync(path.join(BACKUP_DIR, bundle.fileName));
  assert.equal(zip.isZip(raw), true);

  const zipEntries = zip.readZipEntries(raw);
  assert.ok(zipEntries.has('bundle.json'));
  assert.ok(zipEntries.has('README.txt'));

  const parsed = dm.readBundleById(bundle.id);
  assert.equal(parsed.label, '自动化迁移测试');
  assert.equal(parsed.tables.students.length, 1);
  assert.equal(dm.verifyBundle(parsed).ok, true);

  dbx.run('DELETE FROM students WHERE id = ?', ['migrate-stu-1']);
  assert.equal(dbx.get('SELECT COUNT(*) AS c FROM students').c, 0);

  const out = dm.restore({ bundle: parsed, confirm: '恢复', actor: 'tester' });
  assert.ok(out.snapshotId > 0);
  const restored = dbx.get('SELECT * FROM students WHERE id = ?', ['migrate-stu-1']);
  assert.equal(restored.name, '迁移测试学生');

  const uploaded = dm.saveUploadedBundle({
    fileName: '迁移包.zip',
    contentBase64: raw.toString('base64'),
    actor: 'tester',
  });
  assert.equal(uploaded.kind, '上传包');
  const preview = dm.previewRestore(dm.readBundleById(uploaded.id));
  assert.equal(preview.ok, true);
  assert.equal(preview.checks[0].item, '数据包结构版本');
});

test('历史 JSON 备份仍可读取与恢复', () => {
  const bundle = dm.createBackup({ kind: '手动备份', label: '历史格式测试', actor: 'tester' });
  assert.match(bundle.fileName, /\.json$/);
  const parsed = dm.readBundleById(bundle.id);
  assert.equal(parsed.label, '历史格式测试');
  assert.equal(dm.verifyBundle(parsed).ok, true);
});

test('数据总览：每张数据卡片均使用中文名并带条数/体积/更新时间字段', () => {
  const overview = dm.overview();
  assert.ok(overview.tableStats.length >= 20);
  for (const item of overview.tableStats) {
    assert.match(item.name, /[\u4e00-\u9fa5]/, `表 ${item.table} 缺少中文名`);
    assert.equal(typeof item.count, 'number');
    assert.equal(typeof item.bytes, 'number');
    assert.ok('updatedAt' in item);
  }
  assert.ok(overview.settings && typeof overview.settings.count === 'number');
  assert.ok(overview.uploads && typeof overview.uploads.files === 'number');
});

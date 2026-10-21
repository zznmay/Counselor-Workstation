#!/usr/bin/env node
/**
 * 教师名单批量导入 CLI：走完整链路「上传 → 预览 → 确认」，直接打服务端 HTTP 接口。
 *
 *   node server/scripts/import-class-teachers.cjs ./teachers.csv
 *   node server/scripts/import-class-teachers.cjs ./teachers.csv --base=http://127.0.0.1:8443 --token=xxx
 *   node server/scripts/import-class-teachers.cjs ./teachers.csv --username=admin --password=xxx
 *   node server/scripts/import-class-teachers.cjs ./teachers.csv --strict      # 整批回滚模式（有失败行即全不写）
 *   node server/scripts/import-class-teachers.cjs ./teachers.csv --dry-run      # 只预览不确认
 *
 * 超时与批量约束（与服务端一致）：单次 ≤ 2000 行、文件 ≤ 5MB；确认请求超时 60s。
 * 幂等：脚本按文件内容的 sha256 前 16 位生成 clientRequestId，
 *       同一份文件重复执行不会重复建账号，而是回放首次结果（更新语义而非新增）。
 */
const fs = require('fs');
const crypto = require('crypto');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = opt('base', 'https://127.0.0.1:8443').replace(/\/$/, '');
const DRY_RUN = flag('dry-run');
const STRICT = flag('strict');

async function login() {
  const username = opt('username', 'admin');
  const password = opt('password');
  if (!password) throw new Error('需要 --password=xxx 或 --token=xxx');
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`登录失败：${body?.message ?? res.status}`);
  return body.token;
}

async function main() {
  if (!file) {
    console.error('用法：node import-class-teachers.cjs <teachers.csv> [--base=…] [--username=admin --password=…] [--token=…] [--dry-run] [--strict]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`文件不存在：${file}`);
    process.exit(1);
  }

  const token = opt('token') || await login();
  const headers = { 'X-Auth-Token': token };
  const traceId = `cli-${crypto.randomUUID()}`;
  const buf = fs.readFileSync(file);
  const clientRequestId = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

  /* ① 上传 + 预览 */
  const form = new FormData();
  form.append('file', new Blob([buf]), file.split('/').pop());
  const preview = await fetch(`${BASE}/api/classes/teachers/import/upload`, {
    method: 'POST',
    headers: { ...headers, 'X-Trace-Id': traceId },
    body: form,
  });
  const pv = await preview.json();
  if (!preview.ok) {
    console.error(`[preview] 失败（${pv.code ?? preview.status}）：${pv.message}`);
    if (pv.failures?.length) pv.failures.forEach((f) => console.error(`  第 ${f.row} 行 · ${f.field}：${f.reason}`));
    process.exit(1);
  }
  console.log(`[preview] batchId=${pv.batchId} 共 ${pv.total} 行：可导入 ${pv.validCount}，失败 ${pv.failures.length}`);
  pv.failures.forEach((f) => console.log(`  ✗ 第 ${f.row} 行 · ${f.field}：${f.reason}`));
  (pv.warnings ?? []).forEach((w) => console.log(`  ! 第 ${w.row} 行：${w.message}`));

  if (DRY_RUN) {
    console.log('[dry-run] 已按预览结果结束，未写入任何数据。');
    return;
  }
  if (pv.validCount === 0) {
    console.error('[confirm] 没有可导入的行，已终止。');
    process.exit(1);
  }

  /* ② 确认（幂等键 = 文件内容指纹） */
  const res = await fetch(`${BASE}/api/classes/teachers/import/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers, 'X-Trace-Id': traceId },
    body: JSON.stringify({
      batchId: pv.batchId,
      clientRequestId,
      mode: STRICT ? 'all-or-nothing' : 'partial',
    }),
    signal: AbortSignal.timeout(60000),
  });
  const out = await res.json();
  if (!res.ok) {
    console.error(`[confirm] 失败（${out.code ?? res.status}）：${out.message}`);
    (out.failures ?? []).forEach((f) => console.error(`  第 ${f.row} 行 · ${f.field}：${f.reason}`));
    process.exit(1);
  }
  console.log(
    `[confirm] 新增 ${out.insertedCount}、更新 ${out.updatedCount}、跳过 ${out.skippedCount}、` +
    `离职 ${out.disabledCount}，失败 ${out.failures.length}${out.idempotentReplay ? '（幂等回放，未重复写入）' : ''}`,
  );
  out.failures.forEach((f) => console.log(`  ✗ 第 ${f.row} 行 · ${f.field}：${f.reason}`));
  if (out.syncSummary) {
    const s = out.syncSummary;
    console.log(
      `[sync] 建号 ${s.createdUsers} · 授予角色 ${s.grantedRoles} · 回收角色 ${s.revokedRoles} · ` +
      `新增带班 ${s.linkedClasses} · 解除带班 ${s.unlinkedClasses} · 回填学生 ${s.refilledStudents} 名`,
    );
  }
  console.log(`[done] traceId=${out.traceId ?? traceId} batchId=${out.batchId}`);
}

main().catch((e) => {
  console.error(`[error] ${e.message}`);
  process.exit(1);
});

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { dbx, startTestServer } from './helpers/importServer.js';

/**
 * 登录鉴权：已移除「连续失败锁定账号」能力。
 * 覆盖：连错多次始终 401 且不出现 423、不再写入 loginAttempts、正确密码可登录、停用账号 403。
 */

const serverRequire = (await import('node:module')).createRequire(
  new URL('../server/index.js', import.meta.url).href,
);
const authRoute = serverRequire('./routes/auth');

async function login(base, username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /auth/login（无锁定）', () => {
  let base;
  let close;

  before(async () => {
    ({ base, close } = await startTestServer([['/api/auth', authRoute]]));
  });
  after(async () => {
    await close();
  });

  it('连续输错密码：始终 401，不会触发 423 锁定', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await login(base, 'admin', 'wrong-password');
      statuses.push(r.status);
      assert.equal(r.body.message, '用户名或密码错误', '错误提示不应再带「锁定」字眼');
    }
    assert.deepEqual([...new Set(statuses)], [401], `不应出现 423 锁定，实际：${statuses.join(',')}`);
  });

  it('失败不再写入 loginAttempts（表保持为空）', () => {
    assert.equal(dbx.get('SELECT COUNT(*) AS c FROM loginAttempts').c, 0);
  });

  it('连错之后正确密码仍可登录（锁定残留不影响）', async () => {
    const r = await login(base, 'admin', 'Admin@2026');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token, '应返回 token');
    assert.equal(r.body.user.username, 'admin');
  });

  it('停用账号：403 且提示联系管理员', async () => {
    dbx.run('UPDATE users SET disabled = 1 WHERE username = ?', ['admin']);
    try {
      const r = await login(base, 'admin', 'Admin@2026');
      assert.equal(r.status, 403);
      assert.equal(r.body.message, '账号已停用，请联系管理员');
    } finally {
      dbx.run('UPDATE users SET disabled = 0 WHERE username = ?', ['admin']);
    }
  });
});

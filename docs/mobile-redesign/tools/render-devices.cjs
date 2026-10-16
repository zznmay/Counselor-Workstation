/* 多设备截图（v3.1）。
   用法: NODE_PATH=<workspace>/node_modules node tools/render-devices.cjs
   注意：本仓库 package.json 为 "type":"module"，故本工具必须用 .cjs 后缀。 */
const { chromium } = require('/Users/zhouzhennan/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const path = require('path');
const F = 'file://' + encodeURI(path.resolve(__dirname, '..', 'prototype', 'login.html'));
const O = path.resolve(__dirname, '..', 'screenshots') + '/';

/* 前四档为常见机型，ref432 为参考图画布，s600 为「矮视口」压测 */
const DEVS = [
  [320, 568, 'd320'],
  [375, 667, 'd375'],
  [390, 844, 'd390'],
  [430, 932, 'd430'],
  [432, 768, 'ref432'],
  [375, 600, 'short600'],
];

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [w, h, n] of DEVS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(F, { waitUntil: 'load' });
    await p.waitForTimeout(400);
    await p.screenshot({ path: O + 'login-' + n + '.png' });
    const g = await p.evaluate(() => {
      const r = document.querySelector('.card').getBoundingClientRect();
      return {
        card: [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(1)),
        fs: getComputedStyle(document.documentElement).fontSize,
        scrollH: document.body.scrollHeight,
      };
    });
    console.log('shot %-9s %sx%s  card=%s  rootFS=%s  scrollH=%s', n, w, h, JSON.stringify(g.card), g.fs, g.scrollH);
    await p.close();
  }
  // 交互态：填入密码 + 显示密码 + 勾选协议
  const p2 = await b.newPage({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2 });
  await p2.goto(F, { waitUntil: 'load' });
  await p2.fill('#pwd', 'Hzky@123456');
  await p2.click('#eye');
  await p2.click('#agree');
  await p2.waitForTimeout(250);
  await p2.screenshot({ path: O + 'login-state-interactive.png' });
  console.log('shot interactive');
  await b.close();
})();

/* 渲染 login.html @432x768 DPR2，转储几何（CSS px）并做溢出/删除项自检。
   用法: NODE_PATH=<workspace>/node_modules node tools/render.cjs [out.png]
   注意：本仓库 package.json 为 "type":"module"，故本工具必须用 .cjs 后缀。 */
const PW = '/Users/zhouzhennan/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);
const path = require('path');

const PROTO = 'file://' + encodeURI(path.resolve(__dirname, '..', 'prototype', 'login.html'));
const OUT = process.argv[2] || '/tmp/ref-anal/render.png';

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2 });
  await p.goto(PROTO, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT });

  const geo = await p.evaluate(() => {
    const pick = (sel, name) => {
      const el = document.querySelector(sel);
      if (!el) return { name, missing: true };
      const r = el.getBoundingClientRect();
      return { name, x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const list = [
      ['.card', 'card'], ['.hero', 'hero'], ['.panel', 'panel'],
      ['.brand__mark', 'brandMark'], ['.brand__zx', 'zx'], ['.brand__zw', 'zw'],
      ['.hero__title', 'heroTitle'], ['.hero__sub', 'heroSub'],
      ['.panel__h2', 'h2'], ['.panel__sub', 'sub'],
      ['.field:nth-of-type(1)', 'field1'], ['.field:nth-of-type(2)', 'field2'],
      ['.btn', 'btn'], ['.agree', 'agree'], ['.agree input', 'checkbox'],
      // v3.1 已删除，期望全部 missing
      ['.links', 'links'], ['.divider', 'divider'], ['.socials', 'socials'],
      ['.soc__tile', 'tile'], ['.foot', 'foot'],
    ];
    const boxes = list.map(([s, n]) => pick(s, n));

    const card = document.querySelector('.card').getBoundingClientRect();
    const overflow = [];
    document.querySelectorAll('.panel *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > card.right + .6 || r.left < card.left - .6 || r.bottom > card.bottom + .6) {
        overflow.push((el.className || el.tagName) + ' @' + [r.left, r.top, r.right, r.bottom].map((v) => v.toFixed(1)).join(','));
      }
    });
    return {
      boxes,
      overflow,
      viewport: { w: innerWidth, h: innerHeight },
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    };
  });
  console.log(JSON.stringify(geo, null, 1));
  await b.close();
})();

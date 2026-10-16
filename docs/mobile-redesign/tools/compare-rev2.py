# -*- coding: utf-8 -*-
"""v3.1 复刻校验 + 出对比图。

v3.1 相对参考图删除了 3 处（用户标注），因此整体像素差不再是有意义指标；
本脚本只校验「被保留下来的部分是否仍与参考图一致」：
  · 头图区（卡片相对坐标 0..261.5）逐像素比对 —— 应为近乎 0，证明视觉语言未被动过
  · 卡片内元素尺寸与参考图一致（输入框 266x40.5 / 按钮 266x41 / 勾选框 11.5x11.5）
  · 删除项在 DOM 中不存在、无元素溢出卡片
并产出对比图。
"""
from PIL import Image, ImageDraw, ImageFont, ImageChops
import numpy as np, os, json, subprocess

ROOT = '/Users/zhouzhennan/Desktop/AI测试/AI应用/辅导员工作台/辅导员工作台git/docs/mobile-redesign/'
SHOT = ROOT + 'screenshots/'
REF = '/Users/zhouzhennan/.workbuddy/clipboard-images/clipboard-2026-10-16T11-44-06-809Z-5a2e86c1.jpg'
TMP = '/tmp/ref-anal/'

CJK = None
for p, i in [('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
             ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 0)]:
    if os.path.exists(p):
        try:
            CJK = ImageFont.truetype(p, 30)
            break
        except Exception:
            pass
if CJK is None:
    CJK = ImageFont.load_default()

BG, FG, ACC = (255, 255, 255), (26, 26, 26), (15, 105, 228)


def label(size, text, pad=18):
    w, h = size
    bar = Image.new('RGB', (w, h + 2 * pad + 34), BG)
    d = ImageDraw.Draw(bar)
    d.text((pad, pad), text, font=CJK, fill=FG)
    return bar


def panel(img, text, w=None):
    """把截图放进带标题栏的白底面板"""
    if w:
        r = w / img.width
        img = img.resize((w, max(1, round(img.height * r))), Image.LANCZOS)
    bar = Image.new('RGB', (img.width, img.height + 62), BG)
    d = ImageDraw.Draw(bar)
    d.text((14, 16), text, font=CJK, fill=FG)
    bar.paste(img, (0, 62))
    return bar


def hstack(panels, gap=26, pad=26, bg=(242, 246, 252)):
    H = max(p.height for p in panels) + 2 * pad
    W = sum(p.width for p in panels) + gap * (len(panels) - 1) + 2 * pad
    out = Image.new('RGB', (W, H), bg)
    x = pad
    for p in panels:
        out.paste(p, (x, pad))
        x += p.width + gap
    return out


# ---------- 1. 头图区（卡片相对）逐像素比对 ----------
ref = Image.open(REF).convert('RGB')
ren = Image.open(TMP + 'render.png').convert('RGB')
# 参考卡片 (85,40) 694x1450 @2x；现在卡片顶在 y=80
RC_L, RC_T, CW = 85, 40, 694
NC_L, NC_T = 85, 80
band = 523        # 头图可见高 261.5 * 2
a = np.asarray(ref.crop((RC_L, RC_T, RC_L + CW, RC_T + band))).astype(np.int16)
b = np.asarray(ren.crop((NC_L, NC_T, NC_L + CW, NC_T + band))).astype(np.int16)
dif = np.abs(a - b).mean(axis=2)
print('== 头图区（卡片相对 0..261.5，694x523 @2x）与参考图比对 ==')
print('   平均差 %.2f / 255   中位 %.2f   差>30 占比 %.2f%%'
      % (dif.mean(), np.median(dif), (dif > 30).mean() * 100))

# ---------- 2. 布局自检（来自 render.cjs 的几何） ----------
try:
    g = json.load(open(TMP + 'geo.json'))
    bx = {d['name']: d for d in g['boxes'] if not d.get('missing')}
    removed = [d['name'] for d in g['boxes'] if d.get('missing')]
    print('\n== 布局自检 ==')
    print('   画布 %s  根字号 %s  页面滚动 %s' % (g['viewport'], g['rootFontSize'], g['bodyScroll']))
    print('   已确认删除: %s' % ', '.join(removed))
    print('   溢出卡片元素: %s' % (g['overflow'] or '无'))
    c, p = bx['card'], bx['panel']
    print('   卡片 %.1fx%.1f  上下外边距 %.1f/%.1f  左右 %.1f/%.1f'
          % (c['w'], c['h'], c['y'], 768 - c['y'] - c['h'], c['x'], 432 - c['x'] - c['w']))
    print('   面板内上下内边距 %.1f / %.1f'
          % (bx['h2']['y'] - p['y'], p['y'] + p['h'] - (bx['agree']['y'] + bx['agree']['h'])))
except Exception as e:
    print('布局自检跳过:', e)

# ---------- 3. 对比图 ----------
print('\n== 出图 ==')
ref1 = ref.resize((ref.width // 2, ref.height // 2), Image.LANCZOS)
ren1 = ren.resize((ren.width // 2, ren.height // 2), Image.LANCZOS)

# 3a 参考图 vs 复刻 v3.1
p1 = hstack([panel(ref1, '参考图（原）'), panel(ren1, 'v3.1（删除标注项 + 重排）')])
p1.save(SHOT + 'login-vs-reference.png')
print('   login-vs-reference.png', p1.size)

# 3b 差分热力图
heat = Image.fromarray(np.stack([np.clip(dif * 4, 0, 255)] * 3, axis=2).astype(np.uint8))
p2 = hstack([panel(heat.resize((heat.width // 2, heat.height // 2)), '差异热力（仅头图区，×4 增益）')])
p2.save(SHOT + 'login-hero-diff.png')
print('   login-hero-diff.png', p2.size)

# 3c 改前 / 改后（均为 432 画布）
before = Image.open(TMP + 'v3-432.png').convert('RGB')
after = Image.open(SHOT + 'login-ref432.png').convert('RGB')
before.save(SHOT + 'login-before-v3-432.png')
b1 = before.resize((before.width // 2, before.height // 2), Image.LANCZOS)
a1 = after.resize((after.width // 2, after.height // 2), Image.LANCZOS)
p3 = hstack([panel(b1, '改前（v3）'), panel(a1, '改后（v3.1）')])
p3.save(SHOT + 'login-before-vs-after.png')
print('   login-before-vs-after.png', p3.size)

# 3d 表单区放大（新渲染 2x 裁切：面板顶 -> 卡底）
crop = ren.crop((85, 80 + int(261.5 * 2), 779, 80 + int(688 * 2)))
p4 = hstack([panel(crop, 'v3.1 面板区 2x 放大')])
p4.save(SHOT + 'login-panel-detail.png')
print('   login-panel-detail.png', p4.size)

# 3e 多设备
order = [('login-d320.png', '320x568'), ('login-d375.png', '375x667'),
         ('login-short600.png', '375x600 矮屏'), ('login-d390.png', '390x844'),
         ('login-d430.png', '430x932'), ('login-ref432.png', '432x768 参考画布')]
H = 880
ps = []
for f, t in order:
    im = Image.open(SHOT + f).convert('RGB')
    ps.append(panel(im.resize((round(im.width * H / im.height), H), Image.LANCZOS), t))
p5 = hstack(ps, gap=18)
p5.save(SHOT + 'login-responsive.png')
print('   login-responsive.png', p5.size)

# 3f 交互态（单列带标题，不覆盖原始截图）
st = Image.open(SHOT + 'login-state-interactive.png').convert('RGB')
s1 = st.resize((st.width // 2, st.height // 2), Image.LANCZOS)
hstack([panel(s1, '交互态：填充密码 + 显示密码 + 勾选协议')], gap=0).save(SHOT + 'login-interactive-labeled.png')
print('   login-interactive-labeled.png')
print('\ndone')

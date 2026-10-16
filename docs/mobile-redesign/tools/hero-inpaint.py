# -*- coding: utf-8 -*-
"""把 hero 里的文字抹掉（多尺度扩散修复），得到干净背景。"""
import numpy as np
from PIL import Image, ImageFilter

P = '/Users/zhouzhennan/.workbuddy/clipboard-images/clipboard-2026-10-16T11-44-06-809Z-5a2e86c1.jpg'
A = '/Users/zhouzhennan/Desktop/AI测试/AI应用/辅导员工作台/辅导员工作台git/docs/mobile-redesign/prototype/assets/'
O = '/Users/zhouzhennan/Desktop/AI测试/AI应用/辅导员工作台/辅导员工作台git/docs/mobile-redesign/ref-crops/'

HX0, HY0, HX1, HY1 = 85, 40, 779, 740
im = Image.open(P).convert('RGB').crop((HX0, HY0, HX1, HY1))
W, H = im.size
print('hero size', W, H, '-> logical', W/2, H/2)

img = np.asarray(im).astype(np.float64)

BOXES = [
    (114, 88, 408, 160),
    (126, 246, 396, 394),
    (126, 402, 386, 446),
]
mask = np.zeros((H, W), np.float64)
for x0, y0, x1, y1 in BOXES:
    mask[max(0, y0-HY0):y1-HY0, max(0, x0-HX0):x1-HX0] = 1.0
print('masked ratio %.1f%%' % (100*mask.mean()))

mimg = Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0))
w_full = np.clip(np.asarray(mimg).astype(np.float64)/255.0, 0, 1)

def down(a, f):
    h, wd = a.shape[:2]
    im2 = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize(
        (max(1, wd//f), max(1, h//f)), Image.BILINEAR)
    return np.asarray(im2).astype(np.float64)

levels, ws = [img.copy()], [w_full.copy()]
for _ in range(4):
    levels.append(down(levels[-1], 2))
    ws.append(down(ws[-1]*255, 2)/255.0)

u = levels[-1].copy()
m = ws[-1] > 0.02
for c in range(3):
    vals = u[..., c][~m]
    u[..., c][m] = float(np.median(vals)) if vals.size else 128.0

for lvl in range(len(levels)-2, -1, -1):
    h, wd = levels[lvl].shape[:2]
    u = np.asarray(Image.fromarray(np.clip(u, 0, 255).astype(np.uint8)).resize(
        (wd, h), Image.BILINEAR)).astype(np.float64)
    w = ws[lvl]
    base = levels[lvl]
    m = w > 0.02
    if not m.any():
        u = base.copy(); continue
    u[~m] = base[~m]
    iters = 80 if lvl > 0 else 600
    wc = w[..., None]
    mc = m[..., None]
    for _ in range(iters):
        nb = (np.roll(u, 1, 0) + np.roll(u, -1, 0) + np.roll(u, 1, 1) + np.roll(u, -1, 1)) / 4.0
        u = np.where(mc, wc*nb + (1-wc)*u, base)

out = Image.fromarray(np.clip(u, 0, 255).astype(np.uint8))
out.save(A + 'hero-clean.jpg', quality=94)
print('saved', A + 'hero-clean.jpg', out.size)
out.resize((out.width//2, out.height//2), Image.LANCZOS).save(O + 'z-hero-clean-preview.png')
print('preview ok')

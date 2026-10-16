# -*- coding: utf-8 -*-
"""参考图 vs 渲染图：逐元素测量比对 + 差分热力图。"""
import numpy as np
from PIL import Image

REF = '/Users/zhouzhennan/.workbuddy/clipboard-images/clipboard-2026-10-16T11-44-06-809Z-5a2e86c1.jpg'
REN = '/tmp/ref-anal/render.png'
O = '/Users/zhouzhennan/Desktop/AI测试/AI应用/辅导员工作台/辅导员工作台git/docs/mobile-redesign/'

def load(p):
    im = Image.open(p).convert('RGB')
    if im.size != (864, 1536):
        im = im.resize((864, 1536), Image.LANCZOS)
    return np.asarray(im).astype(np.int16)

def measures(a):
    dark = 255 - a.mean(axis=2)
    white = a.min(axis=2)
    out = {}
    def bbox(x0, x1, y0, y1, thr=25, kind='dark'):
        m = (dark[y0:y1, x0:x1] > thr) if kind == 'dark' else (white[y0:y1, x0:x1] > thr)
        ys, xs = np.where(m)
        if len(xs) == 0: return None
        return (x0+int(xs.min()), x0+int(xs.max()), y0+int(ys.min()), y0+int(ys.max()))
    def band(x0, x1, y0, y1, thr=9, minc=1):
        """返回行带列表"""
        m = (dark[y0:y1, x0:x1] > thr).sum(axis=1) >= minc
        res, cur = [], None
        for i, v in enumerate(m):
            if v and cur is None: cur = i
            elif not v and cur is not None: res.append((y0+cur, y0+i-1)); cur = None
        if cur is not None: res.append((y0+cur, y0+len(m)-1))
        return res

    # 白面板顶
    for y in range(520, 900):
        if white[y, 432] > 250 and a[y, 432].min() > 250: break
    out['panelTop'] = y
    # 卡片顶/左右
    blue = (a[..., 2] > 200) & (a[..., 0] < 175) & (a[..., 2] - a[..., 0] > 60)
    xs = np.where(blue[400])[0]
    out['cardL'] = int(xs.min()) if len(xs) else None
    out['cardR'] = int(xs.max()) if len(xs) else None
    ys = np.where(blue[:, 300])[0]
    out['cardT'] = int(ys.min()) if len(ys) else None
    # 卡片底（白 vs 外底）
    col = a[:, 432]
    ys = [y for y in range(1200, 1536) if col[y].min() > 245]
    out['cardB_white'] = max(ys) if ys else None

    for k, box in {
        'h2': (140, 620, 600, 680, 25),
        'sub2': (140, 620, 682, 730, 25),
        'links': (150, 720, 935, 980, 25),
        'agree': (150, 720, 1120, 1165, 25),
        'divider': (150, 720, 1190, 1225, 12),
        'label': (200, 700, 1336, 1378, 25),
        'foot1': (280, 600, 1408, 1442, 25),
        'foot2': (280, 600, 1443, 1478, 25),
        'heroBrand': (110, 440, 92, 160, 200),
    }.items():
        out[k] = bbox(box[0], box[1], box[2], box[3], box[4], 'dark' if k != 'heroBrand' else 'white')

    # 输入框1/2 行带
    bands = band(150, 720, 730, 945, 9)
    out['inputBands'] = bands[:3]
    # 输入框内 图标 / 文字 分列
    def colruns(y0, y1, x0, x1, thr=9, gap=6):
        m = (dark[y0:y1, x0:x1] > thr).any(axis=0)
        res, cur, last = [], None, None
        for i, v in enumerate(m):
            if v:
                if cur is None: cur = i
                last = i
            else:
                if cur is not None and i-last > gap: res.append((x0+cur, x0+last)); cur = None
        if cur is not None: res.append((x0+cur, x0+last))
        return res
    if out['inputBands']:
        y0, y1 = out['inputBands'][0]
        out['in1runs'] = colruns(y0+4, y1-4, 172, 700)
    if len(out['inputBands']) > 1:
        y0, y1 = out['inputBands'][1]
        out['in2runs'] = colruns(y0+4, y1-4, 172, 700)

    # 按钮
    bl = (a[..., 2] > 170) & (a[..., 2] - a[..., 0] > 70) & (a[..., 1] < 170)
    ys = np.where(bl[:, 300])[0]; ys = ys[(ys > 980) & (ys < 1120)]
    if len(ys):
        out['btnY'] = (int(ys.min()), int(ys.max()))
        xs = np.where(bl[(ys.min()+ys.max())//2])[0]
        out['btnX'] = (int(xs.min()), int(xs.max()))
        y0, y1 = int(ys.min()), int(ys.max())
        out['btnText'] = bbox(380, 490, y0+5, y1-5, 170, 'white')
        out['btnColor'] = tuple(int(v) for v in a[(y0+y1)//2, 250])
    # 社交块 & 标签
    m = (dark[1250:1336, 88:778] > 5).sum(axis=0)
    res, cur = [], None
    for i, v in enumerate(m):
        if v > 3 and cur is None: cur = i
        elif v <= 3 and cur is not None: res.append((88+cur, 88+i-1)); cur = None
    out['tiles'] = res
    # hero 文字
    wm = white > 200
    for k, (x0, x1, y0, y1) in {
        'heroT1': (110, 380, 245, 320), 'heroT2': (110, 380, 322, 392),
        'heroSubT': (110, 400, 400, 445),
    }.items():
        m2 = wm[y0:y1, x0:x1]
        ys2, xs2 = np.where(m2)
        out[k] = (x0+int(xs2.min()), x0+int(xs2.max()), y0+int(ys2.min()), y0+int(ys2.max())) if len(xs2) else None
    return out

ref = load(REF); ren = load(REN)
mr, mn = measures(ref), measures(ren)

keys = ['panelTop', 'cardL', 'cardR', 'cardT', 'cardB_white', 'h2', 'sub2', 'inputBands',
        'in1runs', 'in2runs', 'links', 'btnY', 'btnX', 'btnText', 'btnColor', 'agree',
        'divider', 'tiles', 'label', 'foot1', 'foot2', 'heroBrand', 'heroT1', 'heroT2', 'heroSubT']
def fmt(v):
    if isinstance(v, tuple) and len(v) == 3 and all(isinstance(x, int) for x in v):
        return '#%02X%02X%02X' % v
    return str(v)
for k in keys:
    print(f'{k:<12} REF {fmt(mr.get(k)):<42} REN {fmt(mn.get(k))}')

# 差分
diff = np.abs(ref - ren).mean(axis=2)
print('\n差分: 平均 %.2f  中位 %.2f  >30 的像素占比 %.2f%%' % (
    diff.mean(), np.median(diff), 100*(diff > 30).mean()))
hm = np.zeros((1536, 864, 3), np.uint8)
hm[..., 0] = np.clip(diff*3, 0, 255)
hm[..., 1] = np.clip(diff*0.6, 0, 120)
Image.fromarray(hm).resize((432, 768), Image.LANCZOS).save(O+'screenshots/diff-heat.png')

side = Image.new('RGB', (864+8, 768), 'white')
side.paste(Image.open(REF).resize((432, 768), Image.LANCZOS), (0, 0))
side.paste(Image.open(REN).resize((432, 768), Image.LANCZOS), (432+8, 0))
side.save(O+'screenshots/ref-vs-render.png')
print('saved diff-heat.png / ref-vs-render.png')

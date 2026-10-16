#!/usr/bin/env python3
"""WCAG 2.1 对比度计算（仅标准库，Python 3）。用法：python3 contrast.py #64718D #F7F9FF"""
import sys

def lum(hexstr):
    h = hexstr.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if (c := c / 255) <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def ratio(fg, bg):
    hi, lo = sorted((lum(fg), lum(bg)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(f'用法：python3 {sys.argv[0]} <前景色> <背景色>   例：#64718D #F7F9FF')
    r = ratio(sys.argv[1], sys.argv[2])
    print(f'{sys.argv[1]} on {sys.argv[2]} = {r:.2f}:1  {"PASS" if r >= 4.5 else "FAIL"}（正文需 ≥4.5:1，非文本 ≥3:1）')
